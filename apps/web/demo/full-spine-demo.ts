/**
 * Full-spine local demo — VOICE-FIRST, NO microphone, NO camera.
 *
 * Run from the repo root:
 *     npm run demo:spine
 *
 * Where `demo:voice` runs the heuristic-only spine, THIS demo composes the offline
 * signal-lab trained affect PRIOR into the FULL runtime spine via the bridge:
 *
 *   audio buffer → DSP extractor → quality gate → domain classifier →
 *   experts(+learned prior) → fusion(+caps) → personalization → relapse /
 *   longitudinal-diagnostic → intervention → safety-language → stable read.
 *
 * It auto-loads the trained model from the git-ignored
 * `data/processed/signal-lab/model.json` if present; if absent it prints that it
 * fell back to the deterministic heuristic ensemble (a trained model is never
 * REQUIRED). The learned model is a far-domain acted-speech PRIOR only (ADR-0005)
 * — never hum truth, never clinical. Nothing is recorded; signals are synthetic.
 */
import { asIsoTimestamp, asModelVersion, defaultConsent } from "@hum-ai/shared-types";
import { synthHum, synthNoisyHum, synthSilence, type AudioInput } from "@hum-ai/audio-features";
import { buildHumSyncPayload, type HumHistory } from "@hum-ai/orchestrator";
import {
  loadLearnedAffectPrior,
  orchestrateHumWithLearnedPrior,
  type LoadedLearnedAffectPrior,
} from "@hum-ai/signal-lab";

const now = asIsoTimestamp("2026-06-19T09:00:00.000Z");
const modelVersion = asModelVersion("full-spine-demo@0.0.0");

// A mature-ish personal history so the read is past the early-baseline phase.
const history: HumHistory = {
  eligibleSamplesByFeature: { meanRms: Array.from({ length: 30 }, (_, i) => 0.27 + ((i % 5) - 2) * 0.004) },
  priorEligibleCount: 30,
};

async function runOne(label: string, audio: AudioInput, prior: LoadedLearnedAffectPrior | null): Promise<void> {
  // `prior` is loaded once; pass it in so every read uses the same model (no reload).
  const { read, priorUsed, provenance, promotion, neuralAuxiliary } = await orchestrateHumWithLearnedPrior({
    audio,
    consent: defaultConsent(now),
    modelVersion,
    now,
    history,
    prior,
  });
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
  console.log(`  INTERNAL (never shown to a user):`);
  console.log(
    `    model=${read.internal.modelProvenance.kind}` +
      `${read.internal.modelProvenance.expertId ? ` (${read.internal.modelProvenance.expertId})` : ""}` +
      `  priorUsed=${priorUsed}`,
  );
  console.log(
    `    quality=${read.internal.quality.decision}/${read.internal.quality.captureQuality}` +
      `  domain=${read.internal.domain.predicted}  stage=${read.internal.stage}` +
      `  appliedCap=${read.internal.inference.confidence.appliedCap.toFixed(2)} (${read.internal.inference.confidence.capReason})`,
  );
  // Honest promotion-gate status for the affect read (manifest-sourced; metadata only).
  console.log(
    `    promotion=${promotion.evaluated ? `evaluated (affect passedGate=${promotion.affectPassedGate})` : "not-evaluated (no manifest)"}` +
      `${read.internal.modelProvenance.gateNote ? `  — ${read.internal.modelProvenance.gateNote}` : ""}`,
  );
  if (neuralAuxiliary) {
    console.log(
      `    neural aux (transparency only, does NOT steer the read): ` +
        `${neuralAuxiliary.target}='${neuralAuxiliary.topLabel}' (${(neuralAuxiliary.probability * 100).toFixed(0)}%, balAcc ${(neuralAuxiliary.balancedAccuracy * 100).toFixed(1)}%)`,
    );
  }
  console.log(`    sync payload: derived-only, raw-audio guard PASSED, evidence=${sync.evidenceLevel}  [${provenance}]`);
}

async function main(): Promise<void> {
  console.log("Hum AI — full-spine local demo (synthetic signals; no mic, no camera)");
  const prior = loadLearnedAffectPrior();
  if (prior) {
    console.log(`Loaded trained affect PRIOR from ${prior.artifact} (far-domain cap ${prior.confidenceCap}; ADR-0005).`);
    if (prior.gateNote) console.log(`  Promotion: ${prior.gateNote}`);
    if (prior.neuralAux.model) console.log(`  + promoted neural aux '${prior.neuralAux.model.target}' (surfaced for transparency only).`);
  } else {
    console.log("No trained model artifact found → honest heuristic fallback (run `npm run signal:train` to produce one).");
  }
  await runOne("Clean 12s hum", synthHum(), prior);
  await runOne("Noisy hum (low SNR)", synthNoisyHum(), prior);
  await runOne("Near silence (should abstain)", synthSilence(), prior);
  console.log("\nDone. Nothing was recorded; all signals were generated in code.\n");
}

void main();
