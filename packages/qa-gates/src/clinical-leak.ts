import {
  AFFECT_HEADS,
  CLINICAL_RISK_MARKER_HEAD_IDS,
  ClinicalLeakError,
  assertNoClinicalLeak,
  neutralInference,
  toRecommendationView,
} from "@hum-ai/affect-model-contracts";
import { asModelVersion } from "@hum-ai/shared-types";
import type { GateResult, GateViolation } from "./types";

/**
 * GATE: no clinical-risk labels in the recommendation input / user-facing output
 * (ADR-0006).
 *
 * This is a RUNTIME gate that builds on the existing two-head architecture rather
 * than duplicating it:
 *
 *  1. Structural check — the sanitized `RecommendationView` produced by
 *     `toRecommendationView` carries ONLY abstracted band keys. We assert that no
 *     key of the produced view is a `CLINICAL_RISK_MARKER_HEAD_IDS` head id or its
 *     internal research label.
 *  2. Runtime defense — `assertNoClinicalLeak` (the existing last-line guard) must
 *     pass on a real projection. We exercise it here so a regression that pours a
 *     raw clinical label into the view trips during `npm run qa`, not only in unit
 *     tests buried in another package.
 *
 * Because the heads/markers are imported from `@hum-ai/affect-model-contracts`,
 * adding a new risk-marker head automatically tightens this gate.
 */

/** The set of forbidden keys: every clinical-risk head id AND its internal label. */
export function forbiddenClinicalKeys(): Set<string> {
  const forbidden = new Set<string>();
  for (const id of CLINICAL_RISK_MARKER_HEAD_IDS) {
    forbidden.add(id);
    forbidden.add(AFFECT_HEADS[id].internalLabel);
  }
  return forbidden;
}

/**
 * Pure structural check: does this object (a candidate recommendation view) carry
 * any forbidden clinical key, at any depth? Returns the offending keys. Exported
 * so tests can feed a synthetic leaky object without poisoning the real path.
 */
export function findClinicalLeakKeys(view: unknown): string[] {
  const forbidden = forbiddenClinicalKeys();
  const offenders: string[] = [];
  const visit = (value: unknown): void => {
    // Mirror assertNoClinicalLeak: a forbidden head id / internal label can leak
    // as a string VALUE, not only as a field name.
    if (typeof value === "string") {
      if (forbidden.has(value)) offenders.push(value);
      return;
    }
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.has(key)) offenders.push(key);
      visit(child);
    }
  };
  visit(view);
  return offenders;
}

/** GATE entry: runs the structural + runtime check on a real projection. */
export function clinicalLeakGate(repoRoot: string): GateResult {
  // `repoRoot` unused here — the gate is in-memory — but the signature is uniform
  // across gates so the CLI can drive them identically.
  void repoRoot;
  const violations: GateViolation[] = [];

  // Build a real, fully-populated inference (neutral inference zeroes all states,
  // so it is a faithful, non-leaky sample of the projection's output shape).
  const inf = neutralInference(asModelVersion("qa-gates-probe@0.0.0"));
  const view = toRecommendationView(inf);

  // 1. Structural: the produced view must contain no clinical key.
  const leakedKeys = findClinicalLeakKeys(view);
  for (const key of leakedKeys) {
    violations.push({
      gate: "no-clinical-leak:structural",
      where: "@hum-ai/affect-model-contracts toRecommendationView()",
      token: key,
      detail: `RecommendationView exposes clinical-risk key "${key}" to the recommendation engine`,
      fix: "Project clinical-risk heads into abstracted booleans at the toRecommendationView boundary; never expose raw head ids / internal labels (ADR-0006).",
    });
  }

  // 2. Runtime: the existing guard must accept the real projection.
  try {
    assertNoClinicalLeak(view);
  } catch (err) {
    const offending = err instanceof ClinicalLeakError ? err.offendingFields.join(", ") : String(err);
    violations.push({
      gate: "no-clinical-leak:runtime",
      where: "@hum-ai/affect-model-contracts assertNoClinicalLeak()",
      token: offending,
      detail: "assertNoClinicalLeak threw on the real recommendation projection — a clinical label is leaking",
      fix: "Remove the raw clinical field from the recommendation path; use the abstracted RecommendationView bands (ADR-0006).",
    });
  }

  return {
    gate: "no-clinical-leak",
    description:
      "RecommendationView carries only abstracted bands; no clinical-risk head id / internal label reaches the recommendation engine (ADR-0006).",
    violations,
  };
}
