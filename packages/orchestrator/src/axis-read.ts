import { clamp, clamp01, mean, normalize, type UnitInterval, type ValenceArousal } from "@hum-ai/shared-types";
import type { AcousticFeatures } from "@hum-ai/audio-features";

/**
 * THE DIMENSIONAL AXIS READ — valence + arousal, from the FIRST hum.
 *
 * Direction (ADR-0003/0005, redo): the read LEADS with two coarse affect axes —
 * valence (subdued ↔ pleasant) and arousal (settled ↔ activated) — and they are
 * available immediately, not gated behind a multi-hum calibration. There is no
 * hum-validated affect model in existence, so the axes are produced two ways and
 * combined honestly:
 *
 *  1. A TRANSPARENT, on-domain ACOUSTIC mapping (`acousticAffectAxes`). Every value
 *     is a deterministic function of the hum's own DSP features (energy, brightness,
 *     pitch, clarity, stability). It is always meaningful on real audio and is the
 *     same honesty class as the existing `HumAcousticExpert` — a reflection of the
 *     hum's acoustic qualities, NOT a clinical or ground-truth affect label.
 *
 *  2. An optional TRAINED axis PRIOR per axis (`AffectAxisPrior`, e.g. signal-lab's
 *     gate-relevant valence/arousal LogRegs). These are far-domain (acted speech)
 *     and SATURATE on out-of-domain input, so each prior carries an OOD distance and
 *     ABSTAINS when the hum is outside its training domain (the common case). When it
 *     IS in-domain it nudges the acoustic axis toward its lean, weighted by its honest
 *     balanced accuracy. It never overrides the on-domain read — it refines it.
 *
 * The personal baseline later re-references this axis read toward the user's own
 * usual (silent progressive refinement) — see `applyPersonalization`.
 */

/** A trained axis prior's prediction for one hum (already OOD-aware). */
export interface AxisPrediction {
  /** Signed axis value in [-1,1] (negative = low/subdued pole, positive = high pole). */
  readonly value: number;
  /** OOD distance [0,1]: 0 = squarely in the training domain, 1 = far outside it. */
  readonly ood: UnitInterval;
  /** Whether the input is close enough to the training domain to be trusted at all. */
  readonly inDomain: boolean;
  /** Honest model self-confidence for THIS hum (margin × in-domain), [0,1]. */
  readonly confidence: UnitInterval;
}

/**
 * A trained coarse-axis PRIOR, injected through this contract so the orchestrator
 * never depends on signal-lab. The implementation (signal-lab `buildAffectAxisPrior`)
 * owns the model + standardizer and computes the OOD distance internally.
 */
export interface AffectAxisPrior {
  readonly axis: "valence" | "arousal";
  /** Honest balanced accuracy on the validation set — provenance only. */
  readonly balancedAccuracy: number;
  /** Whether this axis cleared its promotion gate (ADR-0005 far-domain, or ADR-0011 native). */
  readonly passedGate: boolean;
  /**
   * Whether this prior was trained on NATIVE hums (ADR-0011) rather than far-domain acted
   * speech. A native, in-domain prior is allowed a LARGER (but still bounded) nudge on the
   * read than a far-domain one — it is on-domain hum truth, not a penalized cold-start prior.
   * Omitted/false ⇒ far-domain (the conservative 0.5 cap applies).
   */
  readonly nativeDomain?: boolean;
  predict(features: AcousticFeatures): AxisPrediction;
}

export interface AffectAxisPriors {
  readonly valence?: AffectAxisPrior;
  readonly arousal?: AffectAxisPrior;
}

/** How a single axis value was arrived at (internal transparency; never synced raw). */
export interface AxisResolution {
  readonly axis: "valence" | "arousal";
  /** Final signed value in [-1,1] used in the read. */
  readonly value: number;
  /** The transparent acoustic-only value before any trained nudge. */
  readonly acousticValue: number;
  /** Honest confidence for this axis [0,1] (drives the qualitative band). */
  readonly confidence: UnitInterval;
  /**
   * Whether a trained prior contributed (in-domain + gate-passed), abstained (OOD),
   * was HELD because it failed/lacks its promotion gate (v3 — recorded for audit but
   * never steers the value or confidence), or was absent.
   */
  readonly trainedContribution: "in_domain" | "abstained_ood" | "held_failed_gate" | "absent";
  /** The trained prior's raw lean (provenance), when present. */
  readonly trainedValue: number | null;
  readonly trainedBalancedAccuracy: number | null;
  readonly trainedPassedGate: boolean | null;
  /**
   * Continuous OOD distance [0,1] of the trained prior for THIS hum (0 = squarely in its
   * training domain, 1 = far outside). `null` when no prior fired. Exposed for transparency
   * and to drive the evidence-proportional nudge fade — a near-boundary prior degrades
   * smoothly instead of an all-or-nothing cliff.
   */
  readonly oodDistance: number | null;
}

export interface AxisRead {
  readonly dimensional: ValenceArousal;
  readonly valence: AxisResolution;
  readonly arousal: AxisResolution;
  /**
   * How much real, clear signal this hum carried [0,1] — drives the overall read
   * confidence and abstention (a near-silent / unclear hum has ~0 signal strength).
   */
  readonly signalStrength: UnitInterval;
}

/** Max nudge weight for a far-domain (acted-speech) prior — refines, never overrides (ADR-0005). */
export const FAR_DOMAIN_AXIS_NUDGE_CAP = 0.5;
/** Max nudge weight for a NATIVE in-domain prior (ADR-0011) — leads more, still bounded < 1. */
export const NATIVE_AXIS_NUDGE_CAP = 0.75;
/** Decay rate of the evidence-proportional OOD nudge fade (exp(−λ·ood)); ≈50% fade at ood≈0.46. */
export const OOD_FADE_LAMBDA = 1.5;

/**
 * FIDELITY-DECOUPLING SNR window. Below `SNR_FIDELITY_LO` the fidelity-FRAGILE affect
 * cues are fully faded to neutral; at/above `SNR_FIDELITY_HI` they are fully trusted.
 * Extends the existing valence ⊥ fidelity contract to AROUSAL (see `acousticAffectAxes`).
 */
export const SNR_FIDELITY_LO = 3;
export const SNR_FIDELITY_HI = 10;

/**
 * PERCEPTUAL (log) LOUDNESS WINDOW for the arousal energy cue. Loudness perception is
 * logarithmic (dB), and the capture chain itself spreads energy geometrically, so a hum's
 * RMS is log-distributed: a *moderate* hum sits an order of magnitude above the noise floor
 * and an order below a shout. Normalizing that LINEARLY (the v8 behaviour, window 0.01–0.14)
 * placed a typical hum (signal RMS ≈ 0.03–0.06) at only ~0.18–0.38 of the cue — so an ordinary
 * hum read as near-silent and the whole arousal axis carried a large NEGATIVE offset (the v8
 * Hum Simulator measured the neutral reference hum at arousal ≈ −0.33, and even the max-energy
 * "energised" archetype never crossed 0). The fix maps loudness in LOG space, so a moderate
 * hum lands near the cue midpoint and the arousal zero-point sits where a neutral hum actually
 * reads. This is a units/scaling correction, not a score-widening — the endpoints are unchanged.
 */
export const AROUSAL_RMS_LO = 0.01;
export const AROUSAL_RMS_HI = 0.14;

/**
 * Sustained-hum activity centre. The extractor reports `activeFrameRatio` ≈ 0.7–0.97 for a
 * well-voiced sustained hum (the normal case) and drops only for genuinely choppy/broken
 * voicing. The v8 mapping centred on 0.85 with a tight ±0.5 scale, so a perfectly ordinary
 * 0.7–0.85-active hum was pushed BELOW neutral (adding to the arousal offset) and a slightly
 * gappy 0.5-active hum collapsed to 0. Re-centred on the real sustained baseline so a normal
 * hum reads ~neutral on activity (no offset) and only true choppiness pulls it down.
 */
export const ACTIVE_CENTRE = 0.7;
export const ACTIVE_SCALE = 0.6;

/** Map a possibly-null feature to a unit value, using `fallback` when not computable. */
function unit(value: number | null | undefined, low: number, high: number, fallback: number): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return normalize(value, low, high);
}

/**
 * Perceptual (log-domain) unit-normalize a strictly-positive magnitude feature (loudness).
 * Non-positive / non-finite input ⇒ 0 (silence). Clamped to [0,1].
 */
function logUnit(value: number, low: number, high: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return clamp01(normalize(Math.log(value), Math.log(low), Math.log(high)));
}

/**
 * TRANSPARENT acoustic → (valence, arousal). Deterministic, on-domain, always
 * meaningful on real audio. Not a trained or clinical model — a reflection of the
 * hum's acoustic qualities (the same posture as `HumAcousticExpert`).
 *
 *  - Arousal rises with energy, voiced activity, spectral brightness, and pitch height.
 *  - Valence rises with steadiness, smoothness, melodic warmth and an easy vibrato; falls
 *    with expressive instability. It is intentionally INDEPENDENT of capture fidelity
 *    (clarity / SNR / flatness / breathiness) — those reflect the mic and room, not the
 *    mood, and belong to signal strength + confidence, not to the affect read.
 *
 * v11 TRAIT-DECOUPLING. The purest IDENTITY cues (`FEATURE_KIND === "timbre"`: pitch + brightness
 * REGISTER) carry a large, fixed per-speaker+mic offset — a heavier/huskier voice sits low+dark and
 * a brighter voice high+bright regardless of mood. Reading their ABSOLUTE level as affect pins a
 * husky hummer "calm/low" and a bright one "activated/warm" on the very first hum (the cross-person
 * bias). So on the cold read those register cues are given the SMALLEST weights, and the read leads
 * on loudness (the strongest, most universal arousal cue) and on the STATE cues the person varies
 * hum-to-hum (melodic movement, spectral flux, steadiness). The residual per-person offset is then
 * removed as the personal baseline forms — by the within-user display re-reference (`display-read`),
 * the personalization re-reference, and models retrained on within-person standardized deviations
 * (`@hum-ai/audio-features` `FEATURE_KIND`, `signal-lab` `toFeatureVector(f, baseline)`). The
 * transparent absolute `acousticValue` is always preserved as provenance.
 */
export function acousticAffectAxes(f: AcousticFeatures): {
  valence: number;
  arousal: number;
  signalStrength: UnitInterval;
} {
  // --- FIDELITY DECOUPLING (valence ⊥ fidelity, extended to AROUSAL) ---
  // Broadband recording NOISE inflates spectralCentroid, spectralFlux, pitch-range, frame-activity
  // and meanRms, and depresses the voice-quality steadiness measures — so a NOISY capture can
  // manufacture arousal and shift valence. Recording quality belongs to signalStrength + confidence,
  // NEVER the affect read. v9 enforces that with ONE provably-safe mechanism instead of v8's
  // per-cue fade + noise-floor power subtraction (which, once the cue weights/windows were
  // recalibrated below, could push a near-neutral hum PAST neutral to the wrong pole when SNR and
  // the noise floor were decoupled — a contract violation the Hum Simulator + sim-lab both caught):
  //
  //   the whole acoustic read is blended TOWARD NEUTRAL (0.5 in 01-space) in proportion to capture
  //   fidelity. `affect01 = 0.5 + fidelity·(raw − 0.5)`. At high SNR (fidelity = 1) it is the
  //   IDENTITY, so a clean hum is unchanged; as SNR falls the read decays monotonically toward
  //   neutral and can NEVER cross to or past a pole. This subsumes the noise-floor de-noising: a
  //   quiet hum buried in noise has a low SNR, so its (noise-inflated) loudness reading is faded to
  //   neutral rather than allowed to read "loud/activated". Fidelity can only ever REMOVE affect,
  //   never add or invert it — the strongest possible form of the valence/arousal ⊥ fidelity contract.
  const fidelity = clamp01(normalize(f.signalToNoiseProxy, SNR_FIDELITY_LO, SNR_FIDELITY_HI));
  const fadeToNeutral = (raw01: number): number => 0.5 + fidelity * (raw01 - 0.5);

  // --- arousal: activation level ---
  // Loudness drives arousal more than any other cue, so its CALIBRATION sets the arousal
  // zero-point. Normalize it PERCEPTUALLY (log space) — see `AROUSAL_RMS_LO/HI` — so a moderate
  // hum lands near the cue midpoint instead of near-silent. This is the single biggest correction
  // to the v8 "arousal compressed entirely below 0" finding.
  const energyN = logUnit(f.meanRms, AROUSAL_RMS_LO, AROUSAL_RMS_HI);
  // `activeFrameRatio` is a sustained/choppy CONTINUITY cue centred on the real sustained-hum
  // baseline (`ACTIVE_CENTRE`); a normal hum sits ~neutral on it (no arousal offset) and only
  // genuine choppiness pulls it down.
  const activeN = clamp01(0.5 + (f.activeFrameRatio - ACTIVE_CENTRE) / ACTIVE_SCALE);
  // Windows are tightened to the extractor's REACHABLE range (a real hum's centroid tops out
  // ≈2200 Hz, frame-to-frame flux ≈0.17, not the 2600 / 0.30 the v8 windows assumed) so a
  // genuinely bright / animated hum can drive the cue to its high pole instead of capping ~0.5.
  const brightN = unit(f.spectralCentroidHz, 250, 2200, 0.3); // TIMBRE (identity) — brightness register
  const pitchN = unit(f.pitchMeanHz, 95, 260, 0.5); // TIMBRE (identity) — pitch register
  const pitchMoveN = unit(f.pitchRangeSemitones, 0.5, 8, 0.3); // STATE — melodic movement → more activated
  // STATE — frame-to-frame spectral change → more activated. The window is centred on the REACHABLE
  // flux range: a real sustained hum's flux runs ≈0.05 (the steadiest held tone) to ≈0.16 (a genuinely
  // animated, timbrally-roving hum); a MODERATE hum sits ≈0.09. The pre-correction window (0.01–0.22)
  // overshot both ends — its high pole (0.22) was unreachable, so even an animated hum only drove the
  // cue to ≈0.7, and a moderate hum (flux 0.09) landed at only ≈0.38, well BELOW the 0.5 midpoint.
  // Because flux carries the second-largest arousal weight (0.24), that single mis-window contributed
  // almost the entire negative arousal offset on an ordinary hum (≈−0.05 of the −0.05 neutral read) and
  // capped the high pole — so a gentle/steady hum read "quiet/subdued" and animation could not lift it.
  // Re-centring to the reachable range maps a moderate hum to the cue midpoint and lets an animated one
  // actually reach the high pole. This is a units/reachability calibration (same class as the log-loudness
  // and AROUSAL_RMS corrections), NOT a score-widening — the endpoints are the steadiest / most-animated
  // hums the extractor produces. Validated by the Hum Simulator distribution + cross-voice gates.
  const fluxN = unit(f.spectralFlux, 0.02, 0.17, 0.2); // STATE — more spectral change → more activated
  // v11 TRAIT-DECOUPLING of the FIRST-hum read. `brightN` (brightness register) and `pitchN` (pitch
  // register) are pure IDENTITY cues — a heavier/huskier voice sits dark+low and a brighter voice
  // sits bright+high regardless of mood — so reading them as arousal pins a husky hummer "calm" and a
  // bright one "activated" on hum #1 (the cross-person bias). They are therefore given the SMALLEST
  // weights here, and the read LEADS on loudness (the strongest, most universal arousal cue, identity
  // offset removed downstream by the within-user display re-reference) and on the STATE cues the person
  // controls hum-to-hum (spectral flux, melodic movement, voiced activity). vs v9: brightness 0.10→0.06,
  // pitch register 0.12→0.06; the freed weight goes to loudness (0.40→0.44, then →0.48 in v11.1), flux
  // (0.20→0.24, then →0.20 in v11.1), movement 0.08→0.10. Weights sum to 1; signs unchanged (all cues ↑
  // arousal), validated by sim-lab `calibration` and the cross-voice invariance probe (two voices, same
  // mood → reads cluster).
  // v11.1: flux weight trimmed 0.24→0.20 into LOUDNESS (0.44→0.48). Re-centring the flux window to the
  // reachable range (above) restored its zero-point + high-pole reach but also STEEPENED its slope, which
  // amplified the brightness→flux coupling the synth (and, to a degree, real voices) carries — so a brighter
  // voice's higher flux leaked into a higher arousal read across voices feeling the SAME mood, widening the
  // cross-voice arousal span past its trait-decoupling bound. Folding that weight into loudness — the single
  // most universal, identity-ROBUST arousal cue — keeps the zero-point fix while holding the cross-voice
  // invariance contract (validated by the Hum Simulator `cross-voice-invariance` gate). Weights still sum to 1.
  const arousalRaw = clamp01(
    0.48 * energyN + 0.1 * activeN + 0.06 * brightN + 0.06 * pitchN + 0.1 * pitchMoveN + 0.2 * fluxN,
  );
  const arousal01 = fadeToNeutral(arousalRaw);

  // --- valence: subdued / downbeat ↔ bright / pleasant ---
  // Valence MUST move with how the person actually hums this time, not with fixed qualities of
  // their voice or microphone. Two corrections live here:
  //
  //   (1) It deliberately does NOT key off capture FIDELITY (clarity, SNR, spectral flatness,
  //       breathiness): those measure the mic and room, not the mood. Folding them in made a
  //       clean mic always read "pleasant" and a noisy one "subdued" (a recording-condition
  //       OFFSET). Fidelity earns its keep in `signalStrength` + confidence below, and only fades
  //       the whole read toward neutral (above) — it never colours valence toward a pole.
  //
  //   (2) It can no longer be built ONLY from voice-quality/timbre features (stability,
  //       smoothness, vibrato regularity, agitation). Those are ~CONSTANT for a given
  //       person+mic, so a valence made only of them was pinned: the SAME person landed in one
  //       zone every hum no matter how they hummed (the "tense and wound-up every time" bug).
  //       So valence now LEADS on MOOD-VARIABLE prosody the person controls hum-to-hum —
  //       pitch HEIGHT and melodic MOVEMENT (a higher, more melodic hum reads brighter; a low,
  //       flat one reads more subdued) — classic affective-prosody correlates. Voice-quality
  //       still contributes a "settled/in-control" component, but no longer dominates.
  //
  // Weights sum to 1; all on-domain, never a clinical label.
  const smoothN = f.smoothnessScore === null ? 0.5 : clamp01(f.smoothnessScore);
  // Steadiness LEANS ON `amplitudeStability` (the responsive intensity-steadiness cue) and only
  // lightly on `pitchStability` — the Hum Simulator flagged `pitchStability` as NEAR-DEAD in the
  // hum domain (it sits ≈0.94 for almost every hum, low/high mood alike). Feeding it at half-weight
  // injected a near-CONSTANT positive offset that pinned valence above 0 and put the low pole out
  // of reach. Lean it 0.75/0.25 toward the cue that actually moves.
  const stabilityN = clamp01(0.75 * f.amplitudeStability + 0.25 * (f.pitchStability ?? 0.5));
  const vibratoN = f.vibratoRegularity === null ? 0.5 : clamp01(f.vibratoRegularity);
  const calmN = clamp01(1 - f.residualInstabilityScore); // settled (inverse of agitation)
  const pitchHeightN = unit(f.pitchMeanHz, 95, 260, 0.5); // TIMBRE (identity): pitch register
  const melodyN = unit(f.pitchRangeSemitones, 0.5, 8, 0.3); // STATE: melodic movement (semitones) → expressive
  // v11 TRAIT-DECOUPLING of the FIRST-hum valence read. Pitch HEIGHT is the single purest IDENTITY
  // cue — a heavier/huskier voice sits low and a brighter voice sits high no matter how they feel —
  // so keying valence on its ABSOLUTE level pins a husky hummer "low/flat" and a bright one "warm" on
  // hum #1 (the exact cross-person bias). It is therefore given the SMALLEST mood weight here, and the
  // read LEADS on melodic MOVEMENT (relative, in semitones — the person's own contour, not their
  // register) plus the within-hum voice-quality block (steadiness / smoothness / settledness), which
  // are honest mood cues from the first hum. The husky/bright OFFSET that remains is removed downstream
  // by the within-user display re-reference once a few hums exist. vs v9: pitch height 0.30→0.18; the
  // freed weight goes to melodic movement 0.28→0.32 and the voice-quality block 0.42→0.50. The earlier
  // v8→v9 lesson still holds — valence must NOT be built only from the near-constant voice-quality
  // features (that was the original "tense every time" pin), so MOVEMENT (which the person varies) still
  // leads the prosody half. Weights sum to 1; signs unchanged (all cues ↑ valence, agitation ↓ via
  // `calmN`), validated by sim-lab `calibration` + the new cross-voice invariance probe.
  const valenceRaw = clamp01(
    // mood-variable: melodic MOVEMENT leads (relative contour), pitch height de-weighted (identity) — 0.50
    0.18 * pitchHeightN + 0.32 * melodyN +
    // settled / in-control (within-hum voice-quality; honest mood from hum #1) — 0.50
    0.18 * stabilityN + 0.13 * smoothN + 0.07 * vibratoN + 0.12 * calmN,
  );
  const valence01 = fadeToNeutral(valenceRaw);

  // --- signal strength: how much clear, voiced, loud-enough audio we actually had ---
  const clarityN = clamp01(f.clarityScore);
  const loudN = unit(f.rmsEnergy, 0.006, 0.05, 0);
  const voicedN = clamp01(f.pitchCoverage ?? 0);
  const signalStrength = f.isSilent
    ? 0
    : clamp01(0.45 * loudN + 0.35 * voicedN + 0.2 * clarityN);

  return { valence: arousal01ToSigned(valence01), arousal: arousal01ToSigned(arousal01), signalStrength };
}

/** [0,1] → [-1,1]. */
function arousal01ToSigned(x: UnitInterval): number {
  return clamp(x * 2 - 1, -1, 1);
}

/**
 * Resolve ONE axis: start from the transparent acoustic value, then nudge toward a
 * trained prior's lean ONLY when that prior is in-domain. The nudge weight is the
 * prior's confidence × its honest balanced accuracy, and is bounded so the trained
 * far-domain prior can refine but never dominate the on-domain read.
 */
function resolveAxis(
  axis: "valence" | "arousal",
  acousticValue: number,
  signalStrength: UnitInterval,
  prior: AffectAxisPrior | undefined,
  features: AcousticFeatures,
): AxisResolution {
  // Base confidence: how much clear signal we had (the acoustic read earns confidence
  // from the hum itself, not from a multi-hum calibration count). Capped below the
  // "High evidence" band on its own — a clear signal with NO hum-validated model
  // agreement is honestly "Medium" at best; only an in-domain trained prior that
  // agrees can earn "High".
  let confidence = clamp01(0.2 + 0.48 * signalStrength);
  let value = acousticValue;
  let trainedContribution: AxisResolution["trainedContribution"] = "absent";
  let trainedValue: number | null = null;
  let trainedBalancedAccuracy: number | null = null;
  let trainedPassedGate: boolean | null = null;
  let oodDistance: number | null = null;

  if (prior) {
    const pred = prior.predict(features);
    trainedValue = pred.value;
    trainedBalancedAccuracy = prior.balancedAccuracy;
    trainedPassedGate = prior.passedGate;
    oodDistance = pred.ood;
    if (!pred.inDomain) {
      trainedContribution = "abstained_ood";
    } else if (!prior.passedGate) {
      // v3 GATE ENFORCEMENT: an in-domain prior that did NOT pass its promotion gate may
      // NOT steer the leading dimensional read or raise its confidence. Its lean is kept
      // in provenance (`trainedValue`/`oodDistance`/`trainedPassedGate`) for audit only —
      // the surfaced value stays the transparent acoustic backbone and confidence is
      // unchanged. This is conservative by construction: the prior loaders degrade a
      // missing/old manifest to `passedGate = false`, so an unverified prior lands here too.
      trainedContribution = "held_failed_gate";
    } else {
      trainedContribution = "in_domain";
      // Weight the nudge by the prior's self-confidence and its honest accuracy. A
      // far-domain prior is capped at 0.5 (refines, never overrides — ADR-0005); a
      // NATIVE in-domain prior (ADR-0011) earns a larger cap since it is on-domain hum
      // truth, but is still bounded below 1 so the transparent acoustic read remains the
      // backbone of every read. A smooth OOD FADE (exp(−λ·ood)) softens the nudge as the
      // hum nears the prior's domain boundary — evidence-proportional, not an on/off cliff.
      // The weight uses the prior's LEAN STRENGTH (|value|) × its accuracy × cap × the fade —
      // a SINGLE OOD decay (the fade). `pred.confidence` already folds in an OOD factor, so it
      // is kept OUT of the weight (to avoid double-discounting) and used only for the lift below.
      const cap = prior.nativeDomain ? NATIVE_AXIS_NUDGE_CAP : FAR_DOMAIN_AXIS_NUDGE_CAP;
      const fade = Math.exp(-OOD_FADE_LAMBDA * pred.ood);
      const w = clamp01(Math.abs(pred.value) * clamp01(prior.balancedAccuracy)) * cap * fade;
      value = clamp(acousticValue * (1 - w) + pred.value * w, -1, 1);
      // Signed confidence adjustment: an in-domain prior that AGREES with the acoustic read
      // lifts confidence; one that strongly DISAGREES (conflicting evidence) lowers it — the
      // read is genuinely more ambiguous when the backbone and the prior point apart. `agree`
      // is 1 at identical leans, 0.5 at a full-scale (|Δ|=1) split, 0 at opposite poles.
      const agree = 1 - Math.abs(acousticValue - pred.value) / 2;
      // Only a gate-PASSED, in-domain prior reaches here (v3), so the lift is the full 0.15;
      // disagreement still lowers it (agree − 0.5 < 0), agreement raises it.
      const lift = 0.15;
      confidence = clamp01(confidence + lift * pred.confidence * (agree - 0.5) * 2);
    }
  }

  return {
    axis,
    value,
    acousticValue,
    confidence,
    trainedContribution,
    trainedValue,
    trainedBalancedAccuracy,
    trainedPassedGate,
    oodDistance,
  };
}

/**
 * Produce the full dimensional axis read for one hum: the transparent acoustic
 * valence/arousal, optionally refined by in-domain trained priors, plus the honest
 * signal strength that downstream confidence + abstention use.
 */
export function resolveAxisRead(features: AcousticFeatures, priors?: AffectAxisPriors): AxisRead {
  const ac = acousticAffectAxes(features);
  const valence = resolveAxis("valence", ac.valence, ac.signalStrength, priors?.valence, features);
  const arousal = resolveAxis("arousal", ac.arousal, ac.signalStrength, priors?.arousal, features);
  return {
    dimensional: { valence: valence.value, arousal: arousal.value },
    valence,
    arousal,
    signalStrength: ac.signalStrength,
  };
}

/** Mean of the two axes' honest confidences (the read-level axis confidence). */
export function axisReadConfidence(read: AxisRead): UnitInterval {
  return clamp01(mean([read.valence.confidence, read.arousal.confidence]));
}
