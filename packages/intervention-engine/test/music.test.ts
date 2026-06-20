import { test } from "node:test";
import assert from "node:assert/strict";
import type { RecommendationView } from "@hum-ai/affect-model-contracts";
import { validateUserFacingText, isConfidenceCopySafe } from "@hum-ai/safety-language";
import {
  selectMusicForTarget,
  SEED_MUSIC_CATALOG,
  selectInterventionOfDay,
  type InterventionOfDayInput,
  type MusicVaTarget,
} from "@hum-ai/intervention-engine";

const TARGETS: readonly MusicVaTarget[] = ["settle", "steady", "gentle_lift", "maintain", "focused_momentum"];

const view = (over: Partial<RecommendationView> = {}): RecommendationView => ({
  abstained: false,
  dimensional: { valence: 0, arousal: 0 },
  uncertainty: 0.2,
  elevatedRegulationNeed: false,
  lowEnergyPattern: false,
  lowMoodPattern: false,
  mixedOrUncertain: false,
  ...over,
});

const input = (over: Partial<InterventionOfDayInput> = {}): InterventionOfDayInput => ({
  view: view(),
  captureUsable: true,
  evidence: "medium",
  baselineMature: true,
  ...over,
});

// --- 1. recommender shape + determinism ------------------------------------

test("selectMusicForTarget returns 1-2 catalog tracks, deterministically", () => {
  for (const target of TARGETS) {
    const a = selectMusicForTarget({ valence: -0.4, arousal: 0.5 }, target);
    const b = selectMusicForTarget({ valence: -0.4, arousal: 0.5 }, target);
    assert.equal(a.target, target);
    assert.ok(a.tracks.length >= 1 && a.tracks.length <= 2, `bad track count for ${target}`);
    assert.deepEqual(a.tracks.map((t) => t.id), b.tracks.map((t) => t.id), `not deterministic for ${target}`);
    for (const t of a.tracks) {
      assert.ok(SEED_MUSIC_CATALOG.some((c) => c.id === t.id), "track must come from the catalog");
    }
  }
  assert.equal(selectMusicForTarget({ valence: 0, arousal: 0 }, "settle", { limit: 1 }).tracks.length, 1);
});

// --- 2. every recommendation string is safety-clean ------------------------

test("every music recommendation string passes the safety screens", () => {
  for (const target of TARGETS) {
    const m = selectMusicForTarget({ valence: 0.1, arousal: -0.2 }, target);
    const strings = [m.copy, m.tempoBand, m.basedOn, ...m.tracks.flatMap((t) => [t.title, t.genre])];
    for (const s of strings) {
      assert.ok(validateUserFacingText(s).ok, `forbidden phrase in "${s}"`);
      assert.ok(isConfidenceCopySafe(s), `leaked confidence number in "${s}"`);
    }
  }
});

// --- 3. the steer actually moves the recommendation in V-A space -----------

test("settle steers calmer than focused_momentum", () => {
  const cur = { valence: 0, arousal: 0.2 };
  const settle = selectMusicForTarget(cur, "settle").tracks[0]!;
  const momentum = selectMusicForTarget(cur, "focused_momentum").tracks[0]!;
  assert.ok(settle.arousal < momentum.arousal, "settle should pick lower-arousal music than focused_momentum");
  assert.ok(settle.bpm <= momentum.bpm, "settle should not be faster than focused_momentum");
});

// --- 4. IoD attaches the recommendation only at sufficient confidence ------

test("a music_regulation step carries a recommendation at >= medium evidence, not below", () => {
  // high-activation-negative reliably offers a music_settle template in its rotation set.
  const v = view({ dimensional: { valence: -0.4, arousal: 0.6 } });
  let seed = -1;
  for (let s = 0; s < 12; s += 1) {
    if (selectInterventionOfDay(input({ view: v, rotationSeed: s })).category === "music_regulation") {
      seed = s;
      break;
    }
  }
  assert.notEqual(seed, -1, "expected some rotation to yield a music_regulation step");

  const med = selectInterventionOfDay(input({ view: v, evidence: "medium", rotationSeed: seed }));
  assert.equal(med.category, "music_regulation");
  assert.ok(med.musicRecommendation, "medium evidence music step must carry a recommendation");

  const low = selectInterventionOfDay(input({ view: v, evidence: "low", rotationSeed: seed }));
  if (low.category === "music_regulation") {
    assert.equal(low.musicRecommendation, undefined, "below medium evidence must NOT carry a specific recommendation");
  }
});
