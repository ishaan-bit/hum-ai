import {
  assertNoRawAudioFields,
  clamp01,
  type IsoTimestamp,
  type ModelVersion,
  type UserId,
} from "@hum-ai/shared-types";
import type { RelapseReferenceKind, RelapseSample } from "@hum-ai/relapse-engine";
import { newUserProfile, type UserModelProfile } from "./profile";
import { ANCHOR_LONG_WINDOW } from "./dual-baseline";

/**
 * PERSONALIZATION STATE — the on-device, local-first carrier of everything the
 * personalization layer needs across hums.
 *
 * `UserModelProfile` is the DERIVED, sync-safe summary (baselines, reliabilities,
 * signatures). To keep building those summaries online we also retain a bounded
 * ring of derived FEATURE VALUES (what the dual baseline is computed from — "no
 * per-session history beyond what the rolling baseline retains", ADR-0003) and a
 * bounded ring of relapse-relevant summaries. Those two rings are LOCAL-ONLY and
 * never sync; only `syncableProfile(state)` ever leaves the device, and it runs
 * the raw-audio guard before returning.
 */
export interface PersonalizationState {
  readonly profile: UserModelProfile;
  /** Bounded per-feature derived-value history (≤ FEATURE_HISTORY_LIMIT). LOCAL-ONLY. */
  readonly featureWindows: Record<string, readonly number[]>;
  /** Bounded recent relapse-relevant summaries (≤ RELAPSE_HISTORY_LIMIT). LOCAL-ONLY. */
  readonly relapseHistory: readonly RelapseSample[];
  /** Count of eligible (quality-gated) hums ingested so far. */
  readonly eligibleHumCount: number;
  /**
   * Running count of consecutive eligible hums showing drift (the relapse engine's
   * "single hum must not trigger a relapse-drift signal" rule). Reset to 0 by a
   * non-drifting hum; held by an abstaining one. LOCAL-ONLY, derived.
   */
  readonly consecutiveDriftHums: number;
}

/** Retain exactly as much per-feature history as the anchored baseline summarizes. */
export const FEATURE_HISTORY_LIMIT = ANCHOR_LONG_WINDOW;
/** Bounded relapse summary ring — enough for 7d/30d windows and previous-state refs. */
export const RELAPSE_HISTORY_LIMIT = 64;

/** riskScore ≤ this ⇒ the hum is treated as stable/recovered. */
export const STABLE_RISK_MAX = 0.4;
/** riskScore ≥ this ⇒ the hum is treated as high-risk. */
export const HIGH_RISK_MIN = 0.6;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A fresh, empty personalization state for a brand-new user (population prior). */
export function newPersonalizationState(
  user_id: UserId,
  now: IsoTimestamp,
  model_version: ModelVersion,
): PersonalizationState {
  return {
    profile: newUserProfile(user_id, now, model_version),
    featureWindows: {},
    relapseHistory: [],
    eligibleHumCount: 0,
    consecutiveDriftHums: 0,
  };
}

/**
 * The ONLY part of the state allowed to sync: the derived `UserModelProfile`.
 * Feature windows and relapse history never leave the device.
 *
 * The raw-audio guard (`assertNoRawAudioFields`) runs over the FREE-FORM,
 * feature-keyed maps — the only place an arbitrary (and therefore possibly
 * raw-audio-like) key could appear. The modality/domain/intervention maps are
 * keyed by fixed safe enums (a modality named `audio` is a channel, not raw
 * audio), so they are not — and must not be — scanned by the name-based guard.
 */
export function syncableProfile(state: PersonalizationState): UserModelProfile {
  const p = state.profile;
  assertNoRawAudioFields({
    baseline_vector: p.baseline_vector,
    anchored_baseline_vector: p.anchored_baseline_vector,
    feature_distribution_summary: p.feature_distribution_summary,
    recovery_signature_vector: p.recovery_signature_vector,
    high_risk_signature_vector: p.high_risk_signature_vector,
  });
  return p;
}

/** Mean V-A / risk of the relapse samples within `days` before `endMs` (or undefined). */
function aggregateWindow(
  history: readonly RelapseSample[],
  endMs: number,
  days: number,
): RelapseSample | undefined {
  const startMs = endMs - days * DAY_MS;
  const within = history.filter((s) => {
    const t = Date.parse(s.capturedAt);
    return Number.isFinite(t) && t >= startMs && t < endMs;
  });
  if (within.length === 0) return undefined;
  let risk = 0;
  let valence = 0;
  let arousal = 0;
  for (const s of within) {
    risk += s.riskScore;
    valence += s.dimensional.valence;
    arousal += s.dimensional.arousal;
  }
  const n = within.length;
  return {
    capturedAt: within[within.length - 1]!.capturedAt,
    dimensional: { valence: valence / n, arousal: arousal / n },
    riskScore: clamp01(risk / n),
  };
}

/**
 * Build the four personal relapse references the relapse engine compares against,
 * from the user's bounded relapse history:
 *  - `previous_stable` / `previous_high_risk` — the most recent low-risk / high-risk hum.
 *  - `baseline_7d` / `baseline_30d` — the mean over the trailing 7-/30-day window.
 * References that have no supporting history are simply omitted (the engine then
 * abstains rather than guessing).
 */
export function buildRelapseReferences(
  history: readonly RelapseSample[],
  now: IsoTimestamp,
): Partial<Record<RelapseReferenceKind, RelapseSample>> {
  const refs: Partial<Record<RelapseReferenceKind, RelapseSample>> = {};
  for (let i = history.length - 1; i >= 0; i--) {
    const s = history[i]!;
    if (!refs.previous_stable && s.riskScore <= STABLE_RISK_MAX) refs.previous_stable = s;
    if (!refs.previous_high_risk && s.riskScore >= HIGH_RISK_MIN) refs.previous_high_risk = s;
    if (refs.previous_stable && refs.previous_high_risk) break;
  }
  const endMs = Date.parse(now);
  if (Number.isFinite(endMs)) {
    const b7 = aggregateWindow(history, endMs, 7);
    if (b7) refs.baseline_7d = b7;
    const b30 = aggregateWindow(history, endMs, 30);
    if (b30) refs.baseline_30d = b30;
  }
  return refs;
}
