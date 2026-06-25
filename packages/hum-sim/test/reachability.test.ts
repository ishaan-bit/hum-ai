import { test } from "node:test";
import assert from "node:assert/strict";
import { runHum, makeLatent, type LatentHumProfile } from "@hum-ai/hum-sim";

/**
 * RESPONSIVENESS — assert the user-facing read MOVES where the implementation supports a
 * directional claim (and only there). These use CLEAN hums (high SNR ⇒ the fidelity fade is
 * off) and relative orderings, so they are robust to the read's overall compression while
 * still catching a genuine pin (an axis that stops responding to its real driver).
 */
const clean = (over: Partial<LatentHumProfile>): LatentHumProfile =>
  makeLatent({ durationSec: 8, sampleRate: 16000, noiseLevel: 0.04, ...over });

test("energy drives arousal (louder ⇒ more activated)", async () => {
  const lo = await runHum("rx/energy-lo", clean({ energy: 0.2 }));
  const hi = await runHum("rx/energy-hi", clean({ energy: 0.95 }));
  assert.ok(hi.displayAxis.arousal > lo.displayAxis.arousal + 0.2, `arousal ${lo.displayAxis.arousal.toFixed(2)} → ${hi.displayAxis.arousal.toFixed(2)}`);
});

test("pitch height drives valence (higher register ⇒ brighter affect)", async () => {
  const lo = await runHum("rx/pitch-lo", clean({ pitchHeight: 0.1 }));
  const hi = await runHum("rx/pitch-hi", clean({ pitchHeight: 0.9 }));
  assert.ok(hi.displayAxis.valence > lo.displayAxis.valence + 0.15, `valence ${lo.displayAxis.valence.toFixed(2)} → ${hi.displayAxis.valence.toFixed(2)}`);
});

test("melodic movement drives valence (more melodic ⇒ more positive)", async () => {
  const flat = await runHum("rx/melody-flat", clean({ melodicMovement: 0.0, pitchHeight: 0.5 }));
  const wide = await runHum("rx/melody-wide", clean({ melodicMovement: 1.0, pitchHeight: 0.5 }));
  assert.ok(wide.displayAxis.valence > flat.displayAxis.valence + 0.1, `valence ${flat.displayAxis.valence.toFixed(2)} → ${wide.displayAxis.valence.toFixed(2)}`);
});

test("the four mood corners are ORDERED correctly on each axis", async () => {
  const bright = await runHum("rx/bright", clean({ energy: 0.92, pitchHeight: 0.85, melodicMovement: 0.7, brightness: 0.75, timbralChange: 0.55, pitchInstability: 0.1, amplitudeInstability: 0.12 }));
  const calm = await runHum("rx/calm", clean({ energy: 0.22, pitchHeight: 0.78, melodicMovement: 0.42, brightness: 0.4, timbralChange: 0.12, vibratoRegularity: 0.88 }));
  const tense = await runHum("rx/tense", clean({ energy: 0.85, pitchHeight: 0.4, brightness: 0.8, timbralChange: 0.85, pitchInstability: 0.7, amplitudeInstability: 0.7, vibratoRegularity: 0.3 }));
  const low = await runHum("rx/low", clean({ energy: 0.16, pitchHeight: 0.1, melodicMovement: 0.1, brightness: 0.22, pitchInstability: 0.5, amplitudeInstability: 0.5 }));

  // Arousal ordering: energetic/tense moods are more activated than calm/low moods.
  assert.ok(bright.displayAxis.arousal > low.displayAxis.arousal, "bright should be more aroused than low");
  assert.ok(tense.displayAxis.arousal > calm.displayAxis.arousal, "tense should be more aroused than calm");
  // Valence ordering: positive moods read more positive than negative moods.
  assert.ok(bright.displayAxis.valence > tense.displayAxis.valence, "bright should be more positive than tense");
  assert.ok(calm.displayAxis.valence > low.displayAxis.valence, "calm should be more positive than low");
});
