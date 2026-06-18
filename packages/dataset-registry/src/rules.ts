import type { AudioDomain } from "@hum-ai/shared-types";
import type { DatasetRegistryEntry, ModelUse } from "./schema";

/**
 * Canonical domain → forbidden-use rules (ADR-0005). These encode the
 * project-brief "Prohibited rule":
 *  - Music-emotion datasets must not be used as direct user-state diagnosis
 *    datasets → forbid clinical_prior, affect_prior, relapse_tracking,
 *    hum_finetune, personalization (music's affect ≠ the user's affect).
 *  - Clinical-speech datasets must not be treated as direct hum truth → forbid
 *    hum_finetune and personalization (clinical read speech ≠ a hum).
 *  - Vocal-burst / Hume-style datasets are affective-expression BRIDGES, not
 *    clinical-diagnosis datasets → forbid clinical_prior, relapse_tracking.
 *  - Only `native_hum` may serve hum_finetune / personalization / relapse_tracking
 *    as *truth*.
 */
export const DOMAIN_FORBIDDEN_USES: Record<AudioDomain, readonly ModelUse[]> = {
  native_hum: [], // the target domain — the only source of hum truth
  singing_or_sustained_phonation: ["relapse_tracking", "personalization"],
  vocal_burst_or_nonverbal_expression: ["clinical_prior", "relapse_tracking", "personalization"],
  clinical_speech: ["hum_finetune", "personalization", "relapse_tracking"],
  acted_speech_emotion: ["clinical_prior", "hum_finetune", "personalization", "relapse_tracking"],
  multimodal_conversation: ["hum_finetune", "personalization", "relapse_tracking", "clinical_prior"],
  music_emotion: ["clinical_prior", "affect_prior", "hum_finetune", "personalization", "relapse_tracking"],
  unknown: ["clinical_prior", "affect_prior", "hum_finetune", "personalization", "relapse_tracking"],
};

export interface RegistryViolation {
  readonly entryId: string;
  readonly code:
    | "allowed_prohibited_overlap"
    | "allowed_uses_forbidden_for_domain"
    | "domain_rule_not_declared_prohibited"
    | "music_used_for_diagnosis"
    | "clinical_used_as_hum_truth";
  readonly message: string;
}

const intersect = <T>(a: readonly T[], b: readonly T[]): T[] => a.filter((x) => b.includes(x));

/**
 * Validate a single registry entry against the domain rules. Returns the list
 * of violations (empty = valid).
 */
export function validateEntry(entry: DatasetRegistryEntry): RegistryViolation[] {
  const violations: RegistryViolation[] = [];
  const forbidden = DOMAIN_FORBIDDEN_USES[entry.domain];

  // 1. allowed and prohibited must be disjoint.
  const overlap = intersect(entry.allowed_model_use, entry.prohibited_model_use);
  if (overlap.length > 0) {
    violations.push({
      entryId: entry.id,
      code: "allowed_prohibited_overlap",
      message: `allowed and prohibited overlap: ${overlap.join(", ")}`,
    });
  }

  // 2. no allowed use may be forbidden for the domain.
  const illegalAllowed = intersect(entry.allowed_model_use, forbidden);
  if (illegalAllowed.length > 0) {
    violations.push({
      entryId: entry.id,
      code: "allowed_uses_forbidden_for_domain",
      message: `domain '${entry.domain}' forbids: ${illegalAllowed.join(", ")}`,
    });
  }

  // 3. every domain-forbidden use must be explicitly declared prohibited.
  const undeclared = forbidden.filter((u) => !entry.prohibited_model_use.includes(u));
  if (undeclared.length > 0) {
    violations.push({
      entryId: entry.id,
      code: "domain_rule_not_declared_prohibited",
      message: `domain '${entry.domain}' requires these in prohibited_model_use: ${undeclared.join(", ")}`,
    });
  }

  // 4. explicit named rules (defense-in-depth, independent of the table above).
  if (entry.domain === "music_emotion") {
    const diag = intersect(entry.allowed_model_use, ["clinical_prior", "relapse_tracking"]);
    if (diag.length > 0) {
      violations.push({
        entryId: entry.id,
        code: "music_used_for_diagnosis",
        message: `music_emotion dataset must not be used for user-state diagnosis (${diag.join(", ")})`,
      });
    }
  }
  if (entry.domain === "clinical_speech" && entry.allowed_model_use.includes("hum_finetune")) {
    violations.push({
      entryId: entry.id,
      code: "clinical_used_as_hum_truth",
      message: "clinical_speech dataset must not be treated as direct hum truth (hum_finetune)",
    });
  }

  return violations;
}

export function validateRegistry(entries: readonly DatasetRegistryEntry[]): RegistryViolation[] {
  return entries.flatMap(validateEntry);
}

export function assertValidRegistry(entries: readonly DatasetRegistryEntry[]): void {
  const violations = validateRegistry(entries);
  if (violations.length > 0) {
    const lines = violations.map((v) => `  [${v.entryId}] ${v.code}: ${v.message}`).join("\n");
    throw new Error(`Dataset registry has ${violations.length} governance violation(s):\n${lines}`);
  }
}

/** True if an entry permits a given use (allowed and not prohibited and legal for domain). */
export function isUseAllowed(entry: DatasetRegistryEntry, use: ModelUse): boolean {
  return (
    entry.allowed_model_use.includes(use) &&
    !entry.prohibited_model_use.includes(use) &&
    !DOMAIN_FORBIDDEN_USES[entry.domain].includes(use)
  );
}
