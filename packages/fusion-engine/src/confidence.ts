import { clamp01, mean, type UnitInterval } from "@hum-ai/shared-types";
import type {
  AbstainReason,
  ConfidenceCaps,
  ConfidenceInputs,
  ConfidenceModel,
  ConfidenceReport,
} from "@hum-ai/affect-model-contracts";

/**
 * v1 confidence model. Confidence is EARNED, not decorative (ADR-0004):
 * a mean over six evidence signals, tempered by baseline maturity and
 * longitudinal trend, then clamped by hard caps. The percent form can never
 * exceed the cap, so e.g. a first hum can never report 90%+.
 */
export class ConfidenceModelV1 implements ConfidenceModel {
  compute(inputs: ConfidenceInputs, caps: ConfidenceCaps): ConfidenceReport {
    const evidence = mean([
      inputs.modelProbability,
      inputs.topClassMargin,
      inputs.captureQuality,
      inputs.domainMatch,
      inputs.modalityAgreement,
      1 - inputs.oodScore,
    ]);
    const maturityFactor = 0.6 + 0.4 * clamp01(inputs.calibrationMaturity);
    const trendFactor = 0.9 + 0.1 * clamp01(inputs.longitudinalTrendStrength);
    const rawConfidence = clamp01(evidence * maturityFactor * trendFactor);

    const confidence = Math.min(rawConfidence, caps.cap);
    const abstained = confidence < caps.abstainBelow;
    const abstainReason = abstained ? chooseAbstainReason(inputs, caps) : "none";

    return {
      rawConfidence,
      confidence,
      // Floor, not round: a fractional binding cap (e.g. 0.715) must never
      // round UP past appliedCap × 100 — the percent form provably cannot
      // exceed the cap (ADR-0004).
      confidencePercent: Math.floor(confidence * 100),
      appliedCap: caps.cap,
      capReason: caps.capReason,
      abstained,
      abstainReason,
    };
  }
}

function chooseAbstainReason(inputs: ConfidenceInputs, caps: ConfidenceCaps): AbstainReason {
  if (caps.capReason.toLowerCase().includes("first") && inputs.calibrationMaturity < 0.2) return "first_hum";
  if (inputs.captureQuality < 0.4) return "poor_capture_quality";
  if (inputs.domainMatch < 0.4) return "domain_mismatch";
  if (inputs.oodScore > 0.6) return "out_of_distribution";
  if (inputs.modalityAgreement < 0.4) return "modality_conflict";
  if (inputs.topClassMargin < 0.1) return "low_margin";
  if (inputs.calibrationMaturity < 0.3) return "insufficient_baseline";
  // This function is only called on the abstained path, so it must never return
  // the not-abstained sentinel "none". When no single signal tripped its
  // threshold but the AGGREGATE confidence still fell below the floor, report the
  // generic low-evidence reason rather than a self-contradictory "none".
  return "low_margin";
}

/**
 * Combine multiple candidate caps (e.g. the personalization-stage cap and the
 * capture-quality cap). The strictest cap wins; its reason is reported. The
 * abstention floor is the max of the inputs' floors (stricter abstention).
 */
export function combineCaps(
  parts: ReadonlyArray<{ cap: UnitInterval; reason: string; abstainBelow?: UnitInterval }>,
  defaultAbstainBelow = 0.45,
): ConfidenceCaps {
  if (parts.length === 0) return { cap: 1, capReason: "no cap", abstainBelow: defaultAbstainBelow };
  let binding = parts[0]!;
  let abstainBelow = parts[0]!.abstainBelow ?? defaultAbstainBelow;
  for (const p of parts) {
    if (p.cap < binding.cap) binding = p;
    abstainBelow = Math.max(abstainBelow, p.abstainBelow ?? defaultAbstainBelow);
  }
  return { cap: clamp01(binding.cap), capReason: binding.reason, abstainBelow };
}
