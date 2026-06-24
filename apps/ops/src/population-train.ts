import { readFileSync, writeFileSync } from "node:fs";
import { asIsoTimestamp, assertNoRawAudioFields } from "@hum-ai/shared-types";
import { validContributions, type PopulationContribution } from "@hum-ai/affect-model-contracts";
import {
  trainPopulationArtifact,
  serializePopulationArtifact,
  hasPromotedPopulationModel,
} from "@hum-ai/population-corpus";

/**
 * OFFLINE POPULATION RETRAIN JOB (ADR-0012).
 *
 * The cross-user analogue of the on-device `maybeRetrain`: read a POOLED, consented,
 * pseudonymous set of `PopulationContribution` rows, train a population baseline (group-by-
 * contributor CV + OCEAN norms), and write a versioned `PopulationArtifact` the client ships as
 * its middle prior tier (personal > population > far-domain). This is the "offline-capable"
 * tier of the chosen design: it runs by hand / in CI, NOT as an auto-deployed cloud function —
 * standing up the live aggregation collection + scheduled run is a governed follow-up (the
 * Firestore rules scaffold + consent scope are already in place).
 *
 * Usage:
 *   npm run population:train --workspace @hum-ai/app-ops -- <pool.json> <out-artifact.json>
 *   # or: node --import tsx apps/ops/src/population-train.ts <pool.json> <out-artifact.json>
 *
 * <pool.json> is a JSON array of PopulationContribution (or { contributions: [...] }). It must
 * already be consent-filtered to `population_corpus_contribution` grants — this job re-runs the
 * per-row safety guards (no raw audio, no clinical leak, pseudonymous key) and DROPS any row
 * that fails, but it cannot re-derive consent that was never granted.
 */

function loadPool(path: string): PopulationContribution[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as
    | PopulationContribution[]
    | { contributions: PopulationContribution[] };
  const list = Array.isArray(raw) ? raw : raw.contributions;
  if (!Array.isArray(list)) throw new Error(`${path}: expected a JSON array of contributions (or { contributions: [...] })`);
  return list;
}

function main(): void {
  const [inPath, outPath] = process.argv.slice(2);
  if (!inPath || !outPath) {
    console.error("usage: population-train <pool.json> <out-artifact.json>");
    process.exit(2);
  }

  const submitted = loadPool(inPath);
  // Defense in depth: the envelope must carry no raw-audio-like field at any depth.
  assertNoRawAudioFields(submitted);
  // Drop any contribution that fails the safety/pseudonymity guards (never train on an unsafe row).
  const valid = validContributions(submitted);
  const dropped = submitted.length - valid.length;

  const now = asIsoTimestamp(new Date().toISOString());
  const artifact = trainPopulationArtifact(valid, now);
  writeFileSync(outPath, serializePopulationArtifact(artifact), "utf8");

  const v = artifact.axes.manifest.valence;
  const a = artifact.axes.manifest.arousal;
  console.log(
    [
      `population retrain → ${outPath}`,
      `  contributions: ${submitted.length} submitted, ${valid.length} valid${dropped ? ` (${dropped} dropped)` : ""}`,
      `  contributors:  ${artifact.contributorCount} (min for promotion: ${artifact.provenance.minContributors})`,
      `  examples:      ${artifact.exampleCount}`,
      `  valence axis:  ${v.decision} — ${v.note}`,
      `  arousal axis:  ${a.decision} — ${a.note}`,
      `  OCEAN norms:   ${Object.keys(artifact.oceanNorms).length} cue window(s) recomputed from data`,
      `  promotable:    ${hasPromotedPopulationModel(artifact) ? "yes — ships as the population baseline prior" : "no — provenance + OCEAN norms only"}`,
    ].join("\n"),
  );
}

main();
