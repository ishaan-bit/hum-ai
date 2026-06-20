import { test } from "node:test";
import assert from "node:assert/strict";
import { asIsoTimestamp } from "@hum-ai/shared-types";
import { appendExample, emptyCorpus } from "../src/corpus";
import {
  buildAxisRows,
  evaluateAxisPromotion,
  retrainNativeAxes,
  NATIVE_MIN_EXAMPLES,
  NATIVE_ABS_FLOOR,
} from "../src/train";
import { retrainReadiness, corpusReadiness, nextCollectionHint } from "../src/active-learning";
import { buildHumNativeArtifact, axisPriorsFromArtifact, serializeArtifact, parseArtifact, hasPromotedNativeModel } from "../src/manifest";
import { learnableArousalCorpus, makeExample, BASE } from "./fixtures";

const NOW = asIsoTimestamp("2026-06-20T12:00:00.000Z");

test("buildAxisRows skips ineligible and dead-zone (ambiguous) labels", () => {
  let c = emptyCorpus();
  c = appendExample(c, makeExample({ id: "clear", label: { valence: 0.5, arousal: 0.5 } }));
  c = appendExample(c, makeExample({ id: "ambiguous", label: { valence: 0.5, arousal: 0.02 } })); // arousal in dead-zone
  c = appendExample(c, makeExample({ id: "ineligible", label: { valence: 0.5, arousal: 0.5 }, eligible: false }));
  assert.equal(buildAxisRows(c, "arousal").length, 1); // only "clear"
  assert.equal(buildAxisRows(c, "valence").length, 2); // "clear" + "ambiguous" (valence clear)
});

test("a thin corpus HOLDS (no promotion) with honest reasons", () => {
  let c = emptyCorpus();
  for (let i = 0; i < 6; i++) c = appendExample(c, makeExample({ id: `e${i}`, label: { valence: 0.4, arousal: i % 2 ? 0.5 : -0.5 } }));
  const p = evaluateAxisPromotion(c, "arousal");
  assert.equal(p.decision, "hold");
  assert.equal(p.model, null);
  assert.ok(p.reasons.some((r) => r.includes(`≥${NATIVE_MIN_EXAMPLES}`)));
});

test("a learnable corpus PROMOTES a hum-native model that beats the acoustic backbone", () => {
  const c = learnableArousalCorpus(40);
  const p = evaluateAxisPromotion(c, "arousal");
  assert.equal(p.decision, "promote", `reasons: ${p.reasons.join("; ")}`);
  assert.ok(p.model !== null);
  assert.ok(p.challengerBalancedAccuracy >= NATIVE_ABS_FLOOR);
  assert.ok(p.margin >= 0.03, `margin ${p.margin}`);
  // The challenger genuinely outperforms the fixed backbone on this label.
  assert.ok(p.challengerBalancedAccuracy > p.backboneBalancedAccuracy);
});

test("readiness + collection hint guide active learning", () => {
  let c = emptyCorpus();
  for (let i = 0; i < 10; i++) c = appendExample(c, makeExample({ id: `h${i}`, label: { valence: 0.4, arousal: 0.5 } })); // all high arousal
  const r = retrainReadiness(c, "arousal");
  assert.equal(r.ready, false);
  assert.ok(r.need.low > 0); // needs low-arousal examples
  assert.equal(corpusReadiness(c).anyReady, false);
  const hint = nextCollectionHint(c);
  assert.ok(hint && hint.length > 0);

  const ready = learnableArousalCorpus(40);
  assert.equal(corpusReadiness(ready).arousal.ready, true);
});

test("artifact: retrain → promote → priors flow into the orchestrator contract", () => {
  const c = learnableArousalCorpus(40);
  const artifact = buildHumNativeArtifact(c, NOW);
  assert.equal(artifact.manifest.arousal.decision, "promote");
  assert.ok(artifact.arousalModel !== null);
  assert.ok(hasPromotedNativeModel(artifact));

  // Serialize round-trip.
  const back = parseArtifact(serializeArtifact(artifact));
  assert.ok(back !== null);
  assert.equal(back!.manifest.arousal.decision, "promote");

  // The promoted axis becomes an in-domain hum-native AffectAxisPrior.
  const priors = axisPriorsFromArtifact(artifact);
  assert.ok(priors.arousal !== undefined);
  const pred = priors.arousal!.predict({ ...BASE, jitter: 0.06, shimmerProxy: 0.08 });
  assert.equal(pred.inDomain, true, "a hum is IN-domain for the native model (it does not abstain)");
  assert.ok(pred.value >= -1 && pred.value <= 1);
  assert.equal(priors.arousal!.passedGate, true);
});

test("a held axis produces no prior (falls back to the acoustic backbone)", () => {
  let c = emptyCorpus();
  for (let i = 0; i < 6; i++) c = appendExample(c, makeExample({ id: `e${i}`, label: { valence: 0.4, arousal: i % 2 ? 0.5 : -0.5 } }));
  const artifact = buildHumNativeArtifact(c, NOW);
  assert.equal(artifact.manifest.arousal.decision, "hold");
  assert.equal(axisPriorsFromArtifact(artifact).arousal, undefined);
});
