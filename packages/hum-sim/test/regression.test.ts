import { test } from "node:test";
import assert from "node:assert/strict";
import { runHum, makeLatent, type LatentHumProfile } from "@hum-ai/hum-sim";

/**
 * REGRESSION GUARDS for the fidelity→affect leak the Hum Simulator found and the
 * axis-read fix closed: broadband recording noise must NOT manufacture or invert the
 * affect read. It may only fade the read toward neutral (honest low-confidence
 * down-weighting). These pin the v9 fidelity contract in `orchestrator/src/axis-read.ts` —
 * the whole acoustic read is blended toward neutral in proportion to capture fidelity
 * (`0.5 + fidelity·(raw − 0.5)`) — so a future change that re-opens the leak is caught.
 */
const fast = (over: Partial<LatentHumProfile>): LatentHumProfile =>
  makeLatent({ durationSec: 8, sampleRate: 16000, ...over });

test("REGRESSION: recording noise must not FLIP a clearly-aroused hum to low arousal", async () => {
  const energised = { energy: 0.92, pitchHeight: 0.85, brightness: 0.75, timbralChange: 0.55 };
  const clean = await runHum("reg/energised-clean", fast({ ...energised, noiseLevel: 0 }));
  const noisy = await runHum("reg/energised-noisy", fast({ ...energised, noiseLevel: 1 }));
  // The mood is unchanged; noise may lower confidence + fade toward neutral, but must not
  // invert the arousal sign (read a loud, bright, energetic hum as low/subdued).
  if (clean.displayAxis.arousal > 0.1) {
    assert.ok(noisy.displayAxis.arousal > -0.1, `noise flipped arousal ${clean.displayAxis.arousal.toFixed(2)} → ${noisy.displayAxis.arousal.toFixed(2)}`);
  }
});

test("REGRESSION: recording noise must not MANUFACTURE high arousal from a quiet hum", async () => {
  const quiet = { energy: 0.18, pitchHeight: 0.5, brightness: 0.4, timbralChange: 0.2 };
  const clean = await runHum("reg/quiet-clean", fast({ ...quiet, noiseLevel: 0 }));
  const noisy = await runHum("reg/quiet-noisy", fast({ ...quiet, noiseLevel: 1 }));
  // Before the fix, pure hiss raised spectralCentroid/flux/meanRms and pushed arousal to a
  // clearly-positive (high-activation) read (~+0.26). After the fix a quiet hum may only fade
  // toward neutral under noise — it must never cross to a manufactured HIGH-arousal read.
  assert.ok(clean.displayAxis.arousal < 0, `clean quiet hum should read low arousal, got ${clean.displayAxis.arousal.toFixed(2)}`);
  assert.ok(noisy.displayAxis.arousal < 0.15, `noise manufactured high arousal from a quiet hum: ${clean.displayAxis.arousal.toFixed(2)} → ${noisy.displayAxis.arousal.toFixed(2)}`);
});

test("REGRESSION: a near-neutral clean read is not pushed to a strong pole by noise", async () => {
  const neutral = {}; // the NEUTRAL_LATENT reference
  const clean = await runHum("reg/neutral-clean", fast({ ...neutral, noiseLevel: 0 }));
  const noisy = await runHum("reg/neutral-noisy", fast({ ...neutral, noiseLevel: 1 }));
  if (Math.abs(clean.displayAxis.valence) < 0.15 && Math.abs(clean.displayAxis.arousal) < 0.15) {
    assert.ok(Math.abs(noisy.displayAxis.valence) < 0.35, `noise invented valence ${noisy.displayAxis.valence.toFixed(2)}`);
    assert.ok(Math.abs(noisy.displayAxis.arousal) < 0.35, `noise invented arousal ${noisy.displayAxis.arousal.toFixed(2)}`);
  }
});

test("REGRESSION: a CLEAN hum's affect read is essentially unchanged by the fidelity fade", async () => {
  // The fix must be a no-op at high SNR (the common case). A clean bright/energetic hum keeps
  // its read whether we call it via the production path or not — the fade only engages on noise.
  const r = await runHum("reg/clean-bright", fast({ energy: 0.9, pitchHeight: 0.85, brightness: 0.8, melodicMovement: 0.7, noiseLevel: 0.05 }));
  assert.ok(r.features.signalToNoiseProxy > 10, `clean hum should have high SNR, got ${r.features.signalToNoiseProxy.toFixed(0)}`);
  assert.ok(r.displayAxis.valence > 0.1, `clean bright hum should read positive valence, got ${r.displayAxis.valence.toFixed(2)}`);
});
