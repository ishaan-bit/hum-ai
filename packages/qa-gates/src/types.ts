/**
 * Shared shapes for the QA gates.
 *
 * Every gate produces zero or more `GateViolation`s. A violation is deliberately
 * actionable (ADR-aligned, requirement #6): it names the rule, the offending
 * file/package, the exact offending token, and the safe alternative — never a
 * cryptic message. The CLI renders these uniformly and exits non-zero when any
 * gate reports a violation.
 */

/** A single, actionable QA-gate failure. */
export interface GateViolation {
  /** Stable rule id, e.g. "no-camera-deps". */
  readonly gate: string;
  /** File or package the problem lives in (repo-relative where possible). */
  readonly where: string;
  /** The exact offending token/value, quoted back to the author. */
  readonly token: string;
  /** What is wrong, in one line. */
  readonly detail: string;
  /** The safe alternative / what to do instead. */
  readonly fix: string;
}

/** Result of running one gate. */
export interface GateResult {
  /** Stable gate id. */
  readonly gate: string;
  /** Short human description of what the gate enforces. */
  readonly description: string;
  readonly violations: readonly GateViolation[];
}

/** A gate is a pure function from a repo root to a result. */
export type Gate = (repoRoot: string) => GateResult;

/** Render a single violation as an actionable, multi-line block. */
export function formatViolation(v: GateViolation): string {
  return [
    `  ✖ [${v.gate}] ${v.where}`,
    `      offending: ${v.token}`,
    `      problem:   ${v.detail}`,
    `      fix:       ${v.fix}`,
  ].join("\n");
}
