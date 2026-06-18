import {
  EARLY_BASELINE_HUMS,
  isConfidenceCopySafe,
  userFacingConfidence,
  type ConfidenceLike,
} from "@hum-ai/safety-language";
import type { GateResult, GateViolation } from "./types";

/**
 * GATE: no raw confidence number in user-facing copy (ADR-0008).
 *
 * The model computes a calibrated numeric confidence for internal logic only.
 * Users must see qualitative language ("High evidence", "Based on N clean hums"),
 * never a raw percentage that reads as diagnostic accuracy.
 *
 * This gate reuses the existing `isConfidenceCopySafe` guard and exercises the
 * real `userFacingConfidence` projection across a sweep of internal confidence
 * values + maturities. If ANY produced user-facing string embeds a percentage,
 * the gate fails — catching a regression that pipes the internal number into copy.
 */

/** A representative sweep of internal confidence inputs. */
function probeInputs(): ReadonlyArray<{ c: ConfidenceLike; hums: number }> {
  const confidences = [0, 0.25, 0.5, 0.6, 0.75, 0.8, 0.87, 0.95, 1];
  const humCounts = [0, 1, EARLY_BASELINE_HUMS - 1, EARLY_BASELINE_HUMS, 12, 100];
  const inputs: { c: ConfidenceLike; hums: number }[] = [];
  for (const confidence of confidences) {
    for (const abstained of [false, true]) {
      for (const hums of humCounts) {
        inputs.push({ c: { confidence, abstained }, hums });
      }
    }
  }
  return inputs;
}

/** GATE entry: confidence copy stays qualitative across the input sweep. */
export function confidenceCopyGate(repoRoot: string): GateResult {
  void repoRoot;
  const violations: GateViolation[] = [];

  for (const { c, hums } of probeInputs()) {
    const ufc = userFacingConfidence(c, hums);
    // Every user-facing string field must pass the percent guard.
    const fields: ReadonlyArray<readonly [string, string]> = [
      ["signalClarity", ufc.signalClarity],
      ["basedOn", ufc.basedOn],
      ["summary", ufc.summary],
    ];
    for (const [fieldName, text] of fields) {
      if (!isConfidenceCopySafe(text)) {
        violations.push({
          gate: "no-raw-confidence-copy",
          where: `@hum-ai/safety-language userFacingConfidence().${fieldName}`,
          token: text,
          detail: `user-facing confidence copy embeds a raw percentage (input confidence=${c.confidence}, abstained=${c.abstained}, hums=${hums})`,
          fix: "Render qualitative evidence language only (High/Medium/Low evidence, 'Based on N clean hums'); never surface the raw numeric confidence (ADR-0008).",
        });
      }
    }
  }

  return {
    gate: "no-raw-confidence-copy",
    description:
      "User-facing confidence path stays qualitative — no raw percentage ever surfaced (ADR-0008).",
    violations,
  };
}
