import { clinicalLeakGate } from "./clinical-leak";
import { cameraDepsGate } from "./camera-deps";
import { confidenceCopyGate } from "./confidence-copy";
import { forbiddenFilesGate } from "./forbidden-files";
import type { Gate, GateResult } from "./types";

export * from "./types";
export * from "./git";
export * from "./clinical-leak";
export * from "./camera-deps";
export * from "./confidence-copy";
export * from "./forbidden-files";

/**
 * The full ordered set of QA gates. Adding a gate here wires it into both the
 * CLI (`npm run qa`) and the aggregate test.
 */
export const ALL_GATES: readonly Gate[] = [
  clinicalLeakGate,
  cameraDepsGate,
  confidenceCopyGate,
  forbiddenFilesGate,
];

/** Run every gate against a repo root and collect the results. */
export function runAllGates(repoRoot: string): GateResult[] {
  return ALL_GATES.map((gate) => gate(repoRoot));
}

/** Total number of violations across all gate results. */
export function totalViolations(results: readonly GateResult[]): number {
  return results.reduce((sum, r) => sum + r.violations.length, 0);
}
