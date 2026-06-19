import { clamp, clamp01, median, type UnitInterval, type ValenceArousal } from "@hum-ai/shared-types";
import {
  AFFECT_STATE_HEADS,
  RISK_MARKER_HEADS,
  type AffectStateHead,
  type AffectStateScores,
  type MultiHeadAffectInference,
} from "@hum-ai/affect-model-contracts";
import type { StagePolicy } from "./ladder";

/**
 * THE PERSONALIZATION APPLY STEP — "from public priors to personal dominance".
 *
 * A first hum can only be read against population priors; this turns that prior
 * read into an INDIVIDUAL one by re-referencing it against the user's *own*
 * rolling baseline. The mechanism is deliberately conservative and honest:
 *
 *  - It reads the current hum's deviation from the user's baseline (z-deltas) and
 *    asks one question: *how usual is this hum for THIS person?* (`selfNormality`).
 *  - The more a hum matches the user's own usual, the more the read is pulled
 *    toward the user's neutral — so a naturally low/breathy/quiet hummer is no
 *    longer pathologized by a population prior that never met them; their normal
 *    reads as *their* normal.
 *  - The more a hum departs from the user's own baseline, the more the population
 *    prior is left intact — a genuine personal change is preserved, not smoothed
 *    away.
 *
 * Crucially, personalization NEVER manufactures affect or risk it cannot see: it
 * re-references and damps toward the user's neutral, it does not amplify a signal
 * beyond what the prior carries (amplifying personal deviations in a validated
 * direction is the job of the trained model, not this re-referencing layer).
 *
 * Influence grows mechanically up the ladder (`personalizationWeight`): 0 while
 * the baseline is inactive (priors must dominate cold start), then rising as the
 * evidence becomes increasingly the user's own. This is the mechanical
 * "dominance shift" the architecture describes — not rhetorical.
 */

/** Personal-evidence weight λ at each active rung (principled defaults; not yet tuned). */
export const PERSONAL_WEIGHT_BASELINE = 0.3; // 5–9 hums: re-reference against the personal baseline
export const PERSONAL_WEIGHT_FUSION = 0.55; // 10–19 hums: + personalized fusion / modality reliability
export const PERSONAL_WEIGHT_RELAPSE = 0.7; // 20+ hums: personal model dominates

/** Robust-σ scale at which a hum is considered "unusual for you" (selfNormality → 0). */
export const SELF_NORMALITY_TAU = 1.5;
/** Per-feature baseline coverage at/above which personalization is at full strength. */
export const MIN_SUPPORT_FOR_FULL = 8;

/**
 * λ — how strongly personal evidence overrides the population prior, derived from
 * the ladder gates so it can never desync from `stagePolicy`. Zero until the
 * personal baseline is active.
 */
export function personalizationWeight(policy: StagePolicy): UnitInterval {
  if (!policy.baselineActive) return 0;
  if (!policy.personalizedFusionActive) return PERSONAL_WEIGHT_BASELINE;
  if (!policy.relapseModelActive) return PERSONAL_WEIGHT_FUSION;
  return PERSONAL_WEIGHT_RELAPSE;
}

export interface PersonalDeviation {
  /** Robust aggregate |z-delta| across covered features (robust-σ units), [0,∞). */
  readonly magnitude: number;
  /** How close this hum is to the user's OWN usual, (0,1]; 1 = right on baseline. */
  readonly selfNormality: UnitInterval;
  /** Number of features that had a usable personal baseline to compare against. */
  readonly support: number;
}

/**
 * Summarize how far the current hum sits from the user's own baseline. Uses the
 * MEDIAN absolute z-delta (robust to a single wild feature) and maps it through a
 * decay to `selfNormality ∈ (0,1]`. No baseline support ⇒ `selfNormality = 1`
 * with `support = 0` (caller will see weight has nothing to act on).
 */
export function personalDeviation(
  zDeltas: Record<string, number>,
  tau = SELF_NORMALITY_TAU,
): PersonalDeviation {
  const mags: number[] = [];
  for (const z of Object.values(zDeltas)) if (Number.isFinite(z)) mags.push(Math.abs(z));
  if (mags.length === 0) return { magnitude: 0, selfNormality: 1, support: 0 };
  const magnitude = median(mags);
  const selfNormality = clamp01(Math.exp(-magnitude / Math.max(tau, 1e-6)));
  return { magnitude, selfNormality, support: mags.length };
}

export interface PersonalizationApplication {
  /** Whether the read was actually re-referenced (false ⇒ prior passed through). */
  readonly applied: boolean;
  /** λ from the ladder for this stage. */
  readonly weight: UnitInterval;
  /** Effective re-reference strength used = weight × coverage × selfNormality. */
  readonly pull: UnitInterval;
  readonly selfNormality: UnitInterval;
  readonly deviationMagnitude: number;
  readonly support: number;
  readonly stage: string;
  readonly note: string;
}

export interface ApplyPersonalizationOptions {
  /** Override λ (defaults to `personalizationWeight(policy)`). */
  readonly weight?: UnitInterval;
}

/** Risk-marker heads are damped exactly like any other non-neutral head — never selectively hidden. */
const STATE_HEAD_SET: ReadonlySet<string> = new Set(AFFECT_STATE_HEADS);
const RISK_MARKER_STATE_HEADS: ReadonlySet<AffectStateHead> = new Set(
  (RISK_MARKER_HEADS as readonly string[]).filter((h): h is AffectStateHead => STATE_HEAD_SET.has(h)),
);

/**
 * Re-reference a population-prior inference against the user's own baseline. The
 * prior's confidence, abstention, and longitudinal heads are left untouched (the
 * ladder owns confidence ceilings; the relapse engine owns the longitudinal
 * heads) — this step only individualizes the *read*: the dimensional point and
 * the affect-state scores.
 */
export function applyPersonalization(
  prior: MultiHeadAffectInference,
  zDeltas: Record<string, number>,
  policy: StagePolicy,
  opts: ApplyPersonalizationOptions = {},
): { inference: MultiHeadAffectInference; application: PersonalizationApplication } {
  const weight = opts.weight ?? personalizationWeight(policy);
  const dev = personalDeviation(zDeltas);

  const passthrough = (note: string): { inference: MultiHeadAffectInference; application: PersonalizationApplication } => ({
    inference: prior,
    application: {
      applied: false,
      weight,
      pull: 0,
      selfNormality: dev.selfNormality,
      deviationMagnitude: dev.magnitude,
      support: dev.support,
      stage: policy.stage,
      note,
    },
  });

  if (weight <= 0) return passthrough(`stage '${policy.stage}': population prior only — personalization inactive`);
  if (prior.abstained) return passthrough("read abstained — nothing trustworthy to personalize");
  if (dev.support === 0) return passthrough("no personal baseline coverage for this hum's features yet");

  // Thin per-feature coverage ⇒ we barely know this user; scale influence down.
  const coverage = clamp01(dev.support / MIN_SUPPORT_FOR_FULL);
  const pull = clamp01(weight * coverage * dev.selfNormality);

  if (pull <= 0) return passthrough("hum departs from your usual — population prior preserved");

  // 1. Dimensional: pull the V-A point toward the user's neutral (origin) by `pull`.
  const dimensional: ValenceArousal = {
    valence: clamp(prior.dimensional.valence * (1 - pull), -1, 1),
    arousal: clamp(prior.dimensional.arousal * (1 - pull), -1, 1),
  };

  // 2. States: raise `neutral_close_to_usual` toward selfNormality, mildly boost
  //    `calm_regulated`, and damp every other activation toward the user's neutral
  //    by `pull`. Risk markers are damped by the SAME factor as any other head —
  //    personalization re-references, it does not selectively suppress risk.
  const states = personalizeStates(prior.states, dev.selfNormality, pull);

  return {
    inference: { ...prior, dimensional, states },
    application: {
      applied: true,
      weight,
      pull,
      selfNormality: dev.selfNormality,
      deviationMagnitude: dev.magnitude,
      support: dev.support,
      stage: policy.stage,
      note: `re-referenced against your baseline (selfNormality ${dev.selfNormality.toFixed(2)}, pull ${pull.toFixed(2)})`,
    },
  };
}

function personalizeStates(prior: AffectStateScores, selfNormality: number, pull: number): AffectStateScores {
  const out = {} as AffectStateScores;
  for (const head of AFFECT_STATE_HEADS) {
    const v = prior[head];
    if (head === "neutral_close_to_usual") {
      // Toward "this looks like your usual", proportional to how usual it actually is.
      out[head] = clamp01(v + pull * Math.max(0, selfNormality - v));
    } else if (head === "calm_regulated") {
      out[head] = clamp01(v + 0.5 * pull * Math.max(0, selfNormality - v));
    } else {
      out[head] = clamp01(v * (1 - pull));
    }
  }
  return out;
}

/** Re-export for callers that need to identify which damped heads are risk markers. */
export { RISK_MARKER_STATE_HEADS };
