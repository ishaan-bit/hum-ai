/**
 * End-to-end CYCLE demo (Node) — proves the multi-hum loop the web client drives.
 *
 * Runs ~22 daily synthetic hums through the SAME loop as apps/web (`cycle.ts`):
 *   humHistoryFromState(state) → orchestrateHumRead({…, learnedAffectPrior})
 *     → observationFromRead(read) → ingestHum(state)
 * using the real trained prior (loaded via the Node bridge), and prints how the ladder
 * advances: population_prior → early_calibration → personal_baseline (baseline active)
 * → personalized_fusion → relapse_model (longitudinal/relapse model active).
 *
 *   npm run demo:cycle
 *
 * Non-clinical, research-stage. Synthetic hums only — no microphone, no network.
 */
import { computeFeatures, synthHum } from "@hum-ai/audio-features";
import {
  orchestrateHumRead,
  humHistoryFromState,
  observationFromRead,
  ingestHum,
  type PersonalizationState,
} from "@hum-ai/orchestrator";
import { newPersonalizationState } from "@hum-ai/personalization-engine";
import { asIsoTimestamp, asModelVersion, asUserId, type ConsentState } from "@hum-ai/shared-types";
import { loadLearnedAffectPrior } from "@hum-ai/signal-lab";

const MODEL_VERSION = asModelVersion("hum-cycle-demo@0.1.0");
// Grant the consent-gated longitudinal view so we can observe the medical/longitudinal layer.
const consent: ConsentState = {
  grantedScopes: ["local_processing", "clinical_risk_surfacing"],
  updatedAt: asIsoTimestamp("2026-06-01T09:00:00.000Z"),
};

const prior = loadLearnedAffectPrior() ?? undefined;

let state: PersonalizationState = newPersonalizationState(
  asUserId("demo-user"),
  asIsoTimestamp("2026-06-01T09:00:00.000Z"),
  MODEL_VERSION,
);

process.stdout.write("Hum AI — end-to-end cycle (22 daily hums)\n");
process.stdout.write(`prior: ${prior ? `learned affect prior @ ${prior.artifact}` : "heuristic fallback"}\n`);
process.stdout.write("day  stage                 elig  evidence       suggestion          longitudinal\n");
process.stdout.write("───  ────────────────────  ────  ─────────────  ──────────────────  ────────────\n");

const DAY_MS = 24 * 60 * 60 * 1000;
const base = Date.UTC(2026, 5, 1, 9, 0, 0);

for (let day = 1; day <= 22; day += 1) {
  const now = asIsoTimestamp(new Date(base + (day - 1) * DAY_MS).toISOString());
  const audio = synthHum({ seed: day, f0: 150 + (day % 7) * 3, vibratoDepth: 0.008 + (day % 5) * 0.001 });
  const features = computeFeatures(audio);

  const history = humHistoryFromState(state, now);
  // eslint-disable-next-line no-await-in-loop
  const read = await orchestrateHumRead({
    features,
    consent,
    modelVersion: MODEL_VERSION,
    now,
    history,
    learnedAffectPrior: prior,
  });
  state = ingestHum(state, observationFromRead(read, now));

  const lg = read.internal.longitudinal;
  const lgText = lg.abstained ? "abstained" : lg.monitoringFlag ? "MONITORING" : "nominal";
  const sugg = read.userFacing.suggestion?.type ?? "—";
  process.stdout.write(
    `${String(day).padStart(3)}  ${read.internal.stage.padEnd(20)}  ${String(read.internal.eligibleHumCount).padStart(4)}  ` +
      `${read.userFacing.confidence.evidenceLevel.padEnd(13)}  ${sugg.padEnd(18)}  ${lgText}\n`,
  );
}

process.stdout.write("\nFinal stage policy reflects the eligible-hum ladder; raw audio never persisted.\n");
