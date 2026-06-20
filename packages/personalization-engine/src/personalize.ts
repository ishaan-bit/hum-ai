import { clamp, clamp01, median, type UnitInterval, type ValenceArousal } from "@hum-ai/shared-types";
import {
  AFFECT_STATE_HEADS,
  RISK_MARKER_HEADS,
  type AffectStateHead,
  type AffectStateScores,
  type MultiHeadAffectInference,
} from "@hum-ai/affect-model-contracts";
import type { StagePolicy } from "./ladder";
import type { BaselineVector } from "./profile";
import { personalDeviationV2, SELF_NORMALITY_TAU, type FeatureDeviation } from "./deviation";

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

/** Per-feature baseline coverage at/above which v1 personalization is at full strength. */
export const MIN_SUPPORT_FOR_FULL = 8;
/** Extra re-reference strength applied (× coverage) just after a detected regime shift. */
export const REGIME_ADAPTATION_BOOST = 0.12;

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
  // --- v2 (present when a personal-model context was supplied) ---
  /** Aggregate per-feature evidence that gated the re-reference strength, [0,1]. */
  readonly effectiveEvidence?: UnitInterval;
  /** Which features drove this hum's deviation from the user's usual (strongest first). */
  readonly topContributors?: readonly FeatureDeviation[];
  /** Direction of an active baseline-regime shift, if one was recently detected. */
  readonly regimeShift?: "up" | "down";
}

/** v2 personal-model context that upgrades the re-reference from plain z to salience-aware. */
export interface PersonalizationModelContext {
  /** Learned per-feature salience (informativeness × independence). */
  readonly salience?: Record<string, number>;
  /** Personal baseline (for per-feature evidence / shrinkage). */
  readonly baseline?: BaselineVector;
  /** Direction of an active regime shift ("none" ⇒ no boost). */
  readonly regimeShift?: "none" | "up" | "down";
  /** Override the post-shift adaptation boost. */
  readonly adaptationBoost?: number;
}

export interface ApplyPersonalizationOptions {
  /** Override λ (defaults to `personalizationWeight(policy)`). */
  readonly weight?: UnitInterval;
  /**
   * v2 personal-model context. When present, the re-reference uses the
   * salience/evidence-weighted deviation and regime-aware adaptation; when absent,
   * behaviour is identical to v1 (plain median-of-|z|).
   */
  readonly model?: PersonalizationModelContext;
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
  const model = opts.model;

  // v2 (model-aware) deviation when a personal-model context is supplied; else v1.
  let selfNormality: number;
  let magnitude: number;
  let support: number;
  let coverage: number;
  let effectiveEvidence: UnitInterval | undefined;
  let topContributors: readonly FeatureDeviation[] | undefined;
  if (model) {
    const dev = personalDeviationV2(zDeltas, { salience: model.salience, baseline: model.baseline });
    selfNormality = dev.selfNormality;
    magnitude = dev.magnitude;
    support = dev.support;
    coverage = dev.effectiveEvidence; // evidence-driven coverage (supersedes the count ratio)
    effectiveEvidence = dev.effectiveEvidence;
    topContributors = dev.topContributors;
  } else {
    const dev = personalDeviation(zDeltas);
    selfNormality = dev.selfNormality;
    magnitude = dev.magnitude;
    support = dev.support;
    // Thin per-feature coverage ⇒ we barely know this user; scale influence down.
    coverage = clamp01(support / MIN_SUPPORT_FOR_FULL);
  }

  const regimeShift = model?.regimeShift && model.regimeShift !== "none" ? model.regimeShift : undefined;

  const passthrough = (note: string): { inference: MultiHeadAffectInference; application: PersonalizationApplication } => ({
    inference: prior,
    application: {
      applied: false,
      weight,
      pull: 0,
      selfNormality,
      deviationMagnitude: magnitude,
      support,
      stage: policy.stage,
      note,
      effectiveEvidence,
      topContributors,
      regimeShift,
    },
  });

  if (weight <= 0) return passthrough(`stage '${policy.stage}': population prior only — personalization inactive`);
  if (prior.abstained) return passthrough("read abstained — nothing trustworthy to personalize");
  if (support === 0) return passthrough("no personal baseline coverage for this hum's features yet");

  let pull = clamp01(weight * coverage * selfNormality);
  // Regime-aware: just after a detected baseline shift, re-reference a touch more
  // firmly toward the (new) personal normal instead of fighting the change.
  if (regimeShift) pull = clamp01(pull + (model?.adaptationBoost ?? REGIME_ADAPTATION_BOOST) * coverage);

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
  const states = personalizeStates(prior.states, selfNormality, pull);

  const driverNote =
    topContributors && topContributors.length > 0
      ? ` [drivers: ${topContributors.map((c) => c.feature).join(", ")}]`
      : "";
  return {
    inference: { ...prior, dimensional, states },
    application: {
      applied: true,
      weight,
      pull,
      selfNormality,
      deviationMagnitude: magnitude,
      support,
      stage: policy.stage,
      note: `re-referenced against your baseline (selfNormality ${selfNormality.toFixed(2)}, pull ${pull.toFixed(2)}${
        regimeShift ? `, regime ${regimeShift}` : ""
      })${driverNote}`,
      effectiveEvidence,
      topContributors,
      regimeShift,
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
