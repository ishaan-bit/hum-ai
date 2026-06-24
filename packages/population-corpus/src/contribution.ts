import type { IsoTimestamp } from "@hum-ai/shared-types";
import {
  assertValidPopulationContribution,
  type NativeHumExample,
  type PopulationContribution,
} from "@hum-ai/affect-model-contracts";

/**
 * CLIENT-SIDE GATHERING (ADR-0012) — build a guard-valid `PopulationContribution` from a
 * confirmed native-hum example so the same HiTL feedback that personalizes a user's own read can
 * (with `population_corpus_contribution` consent) also feed the pooled corpus that retrains the
 * population baseline. Pure + validated: an unsafe row throws here, never reaching the pool.
 */
export function buildPopulationContribution(args: {
  readonly example: NativeHumExample;
  readonly contributorKey: string;
  readonly consentVersion: string;
  readonly contributedAt: IsoTimestamp;
}): PopulationContribution {
  const contribution: PopulationContribution = {
    // Globally unique in the shared pool (the hum id alone is only unique per device).
    contributionId: `${args.contributorKey}:${args.example.id}`,
    contributorKey: args.contributorKey,
    example: args.example,
    consentVersion: args.consentVersion,
    contributedAt: args.contributedAt,
  };
  assertValidPopulationContribution(contribution);
  return contribution;
}

/**
 * A stable, NON-IDENTIFYING contributor pseudonym derived from a local seed (e.g. the device's
 * local id). A one-way FNV-1a hash so the pooled rows group by contributor for grouped-CV without
 * carrying a uid/email. (A server-minted, salted pseudonym is the hardening follow-up; this keeps
 * the offline pipeline self-contained.)
 */
export function contributorPseudonym(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `contrib-${(h >>> 0).toString(16).padStart(8, "0")}`;
}
