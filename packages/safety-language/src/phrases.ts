/**
 * Safety language rules. Hum produces RISK MARKERS and SIGNALS, never
 * diagnoses. This package is the enforcement point: it defines the forbidden
 * phrases, the allowed replacements, and the separation between internal
 * research labels and user-facing copy. See CLAIMS_LADDER.md and ADR-0004.
 */

export interface ForbiddenPhrase {
  /** Case-insensitive matcher. */
  readonly pattern: RegExp;
  /** Why it is forbidden (shown to developers, not users). */
  readonly reason: string;
  /** A safe phrasing the author probably meant. */
  readonly suggestion: string;
}

/**
 * Forbidden in normal (non-regulatory) mode. These assert diagnosis, clinical
 * certainty, guaranteed outcomes, or regulatory status Hum does not have.
 */
export const FORBIDDEN_PHRASES: readonly ForbiddenPhrase[] = [
  { pattern: /\bdiagnos(is|e|ed|ing|tic)\b/i, reason: "implies clinical diagnosis", suggestion: "screening signal / risk marker" },
  { pattern: /\byou have (depression|anxiety|an anxiety disorder|a disorder|a condition)\b/i, reason: "diagnostic claim about the user", suggestion: "your hums show a {marker}-like pattern" },
  { pattern: /\bclinical(ly)? (certain|certainty|confirmed)\b/i, reason: "asserts clinical certainty", suggestion: "an early-warning pattern (non-clinical)" },
  { pattern: /\bclinically validated\b/i, reason: "Hum is not clinically validated", suggestion: "research-stage signal" },
  { pattern: /\b(guaranteed|guarantee[sd]?) (prevention|to prevent|recovery)\b/i, reason: "guarantees an outcome", suggestion: "may support / is associated with" },
  { pattern: /\bprevents? relapse\b/i, reason: "claims relapse prevention", suggestion: "relapse-risk drift signal / early-warning pattern" },
  { pattern: /\bmedical device\b/i, reason: "regulatory status Hum does not hold", suggestion: "reflective self-awareness tool" },
  { pattern: /\bFDA[- ]?cleared\b/i, reason: "regulatory status Hum does not hold", suggestion: "research-stage prototype" },
  { pattern: /\b(treats?|cures?|therap(y|eutic) for)\b/i, reason: "implies treatment of a condition", suggestion: "supports reflection / regulation" },
];

/**
 * Vocabulary the system MAY use. Keeping this explicit lets reviewers see the
 * sanctioned register at a glance.
 */
export const ALLOWED_TERMS: readonly string[] = [
  "anxiety-risk marker",
  "depressive-affect marker",
  "relapse-risk drift",
  "stress load",
  "emotional-state signal",
  "early-warning pattern",
  "screening signal",
  "risk marker",
  "recovery trend",
  "worsening trend",
];

export interface SafetyViolation {
  readonly phrase: string;
  readonly index: number;
  readonly reason: string;
  readonly suggestion: string;
}

export interface SafetyCheckResult {
  readonly ok: boolean;
  readonly violations: readonly SafetyViolation[];
}

export interface SafetyOptions {
  /**
   * When true (a future validated/regulatory mode), the forbidden list is NOT
   * applied. Default false. This is the ONLY way diagnostic language is ever
   * permitted, and it must be gated by real validation + regulatory clearance.
   */
  readonly validatedRegulatoryMode?: boolean;
}

/** Check a user-facing string. Returns all violations (empty = safe). */
export function validateUserFacingText(text: string, opts: SafetyOptions = {}): SafetyCheckResult {
  if (opts.validatedRegulatoryMode) return { ok: true, violations: [] };
  const violations: SafetyViolation[] = [];
  for (const f of FORBIDDEN_PHRASES) {
    const re = new RegExp(f.pattern.source, f.pattern.flags.includes("g") ? f.pattern.flags : f.pattern.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      violations.push({ phrase: m[0], index: m.index, reason: f.reason, suggestion: f.suggestion });
      if (m.index === re.lastIndex) re.lastIndex++; // avoid zero-width loop
    }
  }
  return { ok: violations.length === 0, violations };
}

export class UnsafeLanguageError extends Error {
  readonly violations: readonly SafetyViolation[];
  constructor(violations: readonly SafetyViolation[]) {
    super(
      `User-facing text contains ${violations.length} forbidden phrase(s): ` +
        violations.map((v) => `"${v.phrase}" (${v.reason})`).join("; "),
    );
    this.name = "UnsafeLanguageError";
    this.violations = violations;
  }
}

/** Throw if any user-facing copy is unsafe. Use at the copy/render boundary. */
export function assertSafeUserFacingText(text: string, opts: SafetyOptions = {}): void {
  const r = validateUserFacingText(text, opts);
  if (!r.ok) throw new UnsafeLanguageError(r.violations);
}
