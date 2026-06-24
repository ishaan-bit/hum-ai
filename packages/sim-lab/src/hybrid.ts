import type { AcousticFeatures } from "@hum-ai/audio-features";
import {
  acousticAffectAxes,
  resolveAxisRead,
  NATIVE_AXIS_NUDGE_CAP,
  type AffectAxisPrior,
  type AxisPrediction,
} from "@hum-ai/orchestrator";
import { refHum } from "./reference";

/**
 * HYBRID LAYER VALIDATION — the system is a HYBRID of a rule-based acoustic backbone
 * (`acousticAffectAxes`) and trained ML axis priors (signal-lab far-domain priors +
 * native on-device priors) fused under promotion gates. This module proves the fusion
 * CONTRACT holds, so adding ML never silently overrides the transparent read:
 *
 *  - an in-domain, gate-passed prior REFINES the read (nudges toward its lean) but the
 *    result stays strictly between the acoustic backbone and the prior's value, and the
 *    nudge weight is bounded by the cap (ADR-0005/0011) — it never overrides;
 *  - an OUT-OF-DOMAIN prior ABSTAINS (the read is the acoustic backbone, unchanged);
 *  - a gate-FAILED prior is HELD (read unchanged) — an unpromoted model can't steer.
 */

/** Build a deterministic stub `AffectAxisPrior` for the hybrid checks (no signal-lab needed). */
export function stubAxisPrior(
  axis: "valence" | "arousal",
  opts: {
    value: number;
    ood: number;
    inDomain: boolean;
    passedGate: boolean;
    nativeDomain?: boolean;
    balancedAccuracy?: number;
    confidence?: number;
  },
): AffectAxisPrior {
  const prediction: AxisPrediction = {
    value: opts.value,
    ood: opts.ood,
    inDomain: opts.inDomain,
    confidence: opts.confidence ?? (1 - opts.ood),
  };
  return {
    axis,
    balancedAccuracy: opts.balancedAccuracy ?? 0.8,
    passedGate: opts.passedGate,
    nativeDomain: opts.nativeDomain,
    predict: () => prediction,
  };
}

export interface HybridCase {
  readonly label: string;
  readonly acoustic: number;
  readonly refined: number;
  /** The prior's lean the read was (or was not) nudged toward. */
  readonly priorValue: number;
  /** Did the read move toward the prior at all? */
  readonly moved: boolean;
  /** Did the read stay strictly between the backbone and the prior (no override)? */
  readonly bounded: boolean;
  /** Was the read left exactly at the acoustic backbone (abstain / held)? */
  readonly unchanged: boolean;
}

const EPS = 1e-9;

/** Run the three hybrid regimes on the valence axis of a sample hum. */
export function runHybridLayers(sample: Partial<AcousticFeatures> = {}): {
  inDomainNative: HybridCase;
  outOfDomain: HybridCase;
  gateFailed: HybridCase;
} {
  const features = refHum(sample);
  const acoustic = acousticAffectAxes(features).valence;
  // A confident native prior leaning well away from the backbone, so a nudge is observable.
  const priorValue = acoustic >= 0 ? -0.85 : 0.85;

  const refinedWith = (prior: AffectAxisPrior): number =>
    resolveAxisRead(features, { valence: prior }).valence.value;

  const toward = (refined: number): boolean =>
    priorValue > acoustic ? refined > acoustic + EPS : refined < acoustic - EPS;
  const between = (refined: number): boolean => {
    const lo = Math.min(acoustic, priorValue);
    const hi = Math.max(acoustic, priorValue);
    return refined >= lo - EPS && refined <= hi + EPS && Math.abs(refined - priorValue) > EPS;
  };

  const inDomainNativeRefined = refinedWith(
    stubAxisPrior("valence", { value: priorValue, ood: 0.05, inDomain: true, passedGate: true, nativeDomain: true }),
  );
  const oodRefined = refinedWith(
    stubAxisPrior("valence", { value: priorValue, ood: 0.95, inDomain: false, passedGate: true, nativeDomain: true }),
  );
  const gateFailedRefined = refinedWith(
    stubAxisPrior("valence", { value: priorValue, ood: 0.05, inDomain: true, passedGate: false, nativeDomain: true }),
  );

  return {
    inDomainNative: {
      label: "in-domain native prior",
      acoustic,
      refined: inDomainNativeRefined,
      priorValue,
      moved: toward(inDomainNativeRefined),
      bounded: between(inDomainNativeRefined),
      unchanged: Math.abs(inDomainNativeRefined - acoustic) < EPS,
    },
    outOfDomain: {
      label: "out-of-domain prior",
      acoustic,
      refined: oodRefined,
      priorValue,
      moved: toward(oodRefined),
      bounded: between(oodRefined),
      unchanged: Math.abs(oodRefined - acoustic) < EPS,
    },
    gateFailed: {
      label: "gate-failed prior",
      acoustic,
      refined: gateFailedRefined,
      priorValue,
      moved: toward(gateFailedRefined),
      bounded: between(gateFailedRefined),
      unchanged: Math.abs(gateFailedRefined - acoustic) < EPS,
    },
  };
}

/** Upper bound on how far a single native prior may pull the read (the cap). */
export const MAX_NATIVE_NUDGE = NATIVE_AXIS_NUDGE_CAP;
