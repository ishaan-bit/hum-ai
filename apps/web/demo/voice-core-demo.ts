/**
 * Voice-core local demo — VOICE-FIRST, NO microphone, NO camera.
 *
 * Run from the repo root:
 *     npm run demo:voice
 *
 * It synthesizes a couple of test hums (a clean one and a near-silent one) IN
 * CODE, runs them through the real pipeline
 *   audio buffer → DSP extractor → quality gate → domain classifier → experts →
 *   fusion → personalization → relapse → intervention → safety-language,
 * and prints ONLY the safe, user-facing read plus a short internal summary.
 *
 * It exists to make the hum-only voice layer tangible locally. It is NOT a
 * product, NOT clinically validated, and it never records you — there is no
 * capture surface here, only synthetic signals.
 */
import { asIsoTimestamp, asModelVersion, defaultConsent } from "@hum-ai/shared-types";
import { synthHum, synthSilence, synthNoisyHum, type AudioInput } from "@hum-ai/audio-features";
import {
  orchestrateHumAudio,
  buildHumSyncPayload,
  type HumHistory,
  type OrchestratedRead,
} from "@hum-ai/orchestrator";

const now = asIsoTimestamp("2026-06-19T09:00:00.000Z");
const modelVersion = asModelVersion("voice-core-demo@0.0.0");

// A mature-ish personal history so the read is past the early-baseline phase.
const history: HumHistory = {
  eligibleSamplesByFeature: { meanRms: Array.from({ length: 30 }, (_, i) => 0.27 + ((i % 5) - 2) * 0.004) },
  priorEligibleCount: 30,
};

function printRead(label: string, read: OrchestratedRead): void {
  const uf = read.userFacing;
  const sync = buildHumSyncPayload(read, { capturedAt: now, modelVersion });
  console.log(`\n──────────────────────────────────────────────`);
  console.log(`  ${label}`);
  console.log(`──────────────────────────────────────────────`);
  console.log(`  USER-FACING (safe to show):`);
  console.log(`    ${uf.headline}`);
  console.log(`    ${uf.note}`);
  console.log(`    ${uf.confidence.summary}`);
  console.log(`    suggestion: ${uf.suggestion ? uf.suggestion.copy : "(none)"}`);
  const iod = uf.interventionOfDay;
  console.log(`  INTERVENTION OF THE DAY (safe to show):`);
  console.log(`    [${iod.category} · ${iod.durationMinutes} min · ${iod.confidenceLanguage}] ${iod.title}`);
  console.log(`    ${iod.instruction}`);
  console.log(`    why: ${iod.whySuggested}`);
  if (iod.escalation?.show && iod.escalation.copy) console.log(`    support: ${iod.escalation.copy}`);
  console.log(`  INTERNAL (never shown to a user):`);
  console.log(
    `    quality=${read.internal.quality.decision}/${read.internal.quality.captureQuality}` +
      `  domain=${read.internal.domain.predicted} (conf ${read.internal.domain.confidence.toFixed(2)})` +
      `  stage=${read.internal.stage}  eligibleHums=${read.internal.eligibleHumCount}`,
  );
  console.log(
    `    derived: f0=${sync.derivedFeatures.pitchMeanHz === null ? "n/a" : `${sync.derivedFeatures.pitchMeanHz.toFixed(0)}Hz`}` +
      `  rms=${sync.derivedFeatures.rmsEnergy.toFixed(3)}  snr=${sync.derivedFeatures.signalToNoiseProxy.toFixed(1)}` +
      `  pitchCoverage=${(sync.derivedFeatures.pitchCoverage ?? 0).toFixed(2)}`,
  );
  console.log(`    sync payload: derived-only, raw-audio guard PASSED, evidence=${sync.evidenceLevel}`);
}

async function runOne(label: string, audio: AudioInput): Promise<void> {
  const read = await orchestrateHumAudio({ audio, consent: defaultConsent(now), modelVersion, now, history });
  printRead(label, read);
}

async function main(): Promise<void> {
  console.log("Hum AI — voice-core local demo (synthetic signals; no mic, no camera)");
  await runOne("Clean 12s hum", synthHum());
  await runOne("Noisy hum (low SNR)", synthNoisyHum());
  await runOne("Near silence (should abstain)", synthSilence());
  console.log("\nDone. Nothing was recorded; all signals were generated in code.\n");
}

void main();
