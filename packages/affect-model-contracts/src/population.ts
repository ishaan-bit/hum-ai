import { assertNoRawAudioFields, type IsoTimestamp } from "@hum-ai/shared-types";
import { assertNoClinicalLeak } from "./two-head";
import { assertValidNativeHumExample, type NativeHumExample } from "./feedback";

/**
 * POOLED POPULATION-CORPUS CONTRIBUTION CONTRACT (ADR-0012).
 *
 * The within-user HiTL loop teaches a model THIS person's hums; this contract is how
 * those confirmed hums become a POOLED corpus that retrains a population BASELINE model
 * every new user starts from — "the baseline keeps improving across users." It is a
 * deliberately thin envelope around a `NativeHumExample`:
 *
 *  - keyed by a non-identifying `contributorKey` PSEUDONYM (never a uid/email), so a
 *    population model can be cross-validated GROUPED BY CONTRIBUTOR without identifying anyone;
 *  - carries DERIVED features + a BENIGN valence/arousal label only — never raw audio, never a
 *    clinical instrument score (the same guards as the native corpus, re-run here);
 *  - records the consent version under which it was contributed (append-only audit), gated on
 *    the dedicated `population_corpus_contribution` scope (distinct from `derived_feature_sync`,
 *    which only backs up to the user's OWN space).
 *
 * The pooled collection is server/aggregator-readable only (never cross-user); see firestore.rules.
 */
export interface PopulationContribution {
  /** Stable id for the contribution row (caller-minted). */
  readonly contributionId: string;
  /**
   * Non-identifying contributor pseudonym. All of one contributor's rows share this key so a
   * population model is cross-validated GROUPED BY CONTRIBUTOR (no within-person leakage). Must
   * NOT be an email/uid (defense in depth against re-identification).
   */
  readonly contributorKey: string;
  /** The benign, derived-only native-hum training row (re-validated here). */
  readonly example: NativeHumExample;
  /** The consent-document version the contributor agreed to (append-only audit). */
  readonly consentVersion: string;
  readonly contributedAt: IsoTimestamp;
}

export class InvalidPopulationContributionError extends Error {
  constructor(reason: string) {
    super(`invalid population contribution: ${reason}`);
    this.name = "InvalidPopulationContributionError";
  }
}

/**
 * Validate a contribution before it may be pooled or trained on. Re-runs the native-hum
 * example guards (no raw audio, no clinical leak, in-range benign label) AND enforces the
 * pseudonymity + consent-version invariants. Throws on any violation.
 */
export function assertValidPopulationContribution(c: PopulationContribution): void {
  if (!c.contributionId) throw new InvalidPopulationContributionError("contributionId required");
  if (!c.contributorKey || c.contributorKey.includes("@")) {
    throw new InvalidPopulationContributionError("contributorKey must be a non-identifying pseudonym (no email/uid)");
  }
  if (!c.consentVersion) throw new InvalidPopulationContributionError("consentVersion required (append-only audit)");
  // The embedded example must itself be a valid, benign, derived-only native row.
  assertValidNativeHumExample(c.example);
  // Defense in depth at the envelope level too (no raw-audio field, no clinical-risk leak anywhere).
  assertNoRawAudioFields(c);
  assertNoClinicalLeak(c);
}

/** Filter a pool to the contributions that pass every guard (drop, never throw, on a bad row). */
export function validContributions(pool: readonly PopulationContribution[]): PopulationContribution[] {
  const out: PopulationContribution[] = [];
  for (const c of pool) {
    try {
      assertValidPopulationContribution(c);
      out.push(c);
    } catch {
      /* drop a single malformed/unsafe contribution rather than failing the whole pool */
    }
  }
  return out;
}
