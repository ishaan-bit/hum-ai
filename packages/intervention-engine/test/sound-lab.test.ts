import { test } from "node:test";
import assert from "node:assert/strict";
import type { ValenceArousal } from "@hum-ai/shared-types";
import { validateUserFacingText, isConfidenceCopySafe } from "@hum-ai/safety-language";
import {
  planSoundLab,
  buildSoundQuery,
  soundLabDirection,
  defaultSoundLabPreferences,
  DIRECTION_LABEL,
  MAIN_GENRES,
  MUSIC_FLAVORS,
  MUSIC_LANGUAGES,
  type MainMusicGenre,
  type MusicVaTarget,
  type SoundLabPreferences,
} from "@hum-ai/intervention-engine";

// A spread of reads across the V-A plane so every steer region is exercised.
const READS: readonly ValenceArousal[] = [
  { valence: -0.5, arousal: 0.6 }, // tense activation → settle
  { valence: -0.4, arousal: -0.4 }, // subdued → gentle_lift
  { valence: 0.5, arousal: 0.5 }, // bright + energised → focused_momentum
  { valence: 0.5, arousal: -0.4 }, // bright + calm → maintain
  { valence: -0.05, arousal: 0.05 }, // mixed / neutral → steady
  { valence: 0, arousal: 0 },
];

// --- 1. direction covers the whole plane + matches the documented regions --------

test("soundLabDirection returns a valid steer for every read, with the expected mapping", () => {
  assert.equal(soundLabDirection({ valence: -0.5, arousal: 0.6 }), "settle");
  assert.equal(soundLabDirection({ valence: -0.4, arousal: -0.4 }), "gentle_lift");
  assert.equal(soundLabDirection({ valence: 0.5, arousal: 0.5 }), "focused_momentum");
  assert.equal(soundLabDirection({ valence: 0.5, arousal: -0.4 }), "maintain");
  assert.equal(soundLabDirection({ valence: -0.05, arousal: 0.05 }), "steady");
  for (const r of READS) assert.ok(DIRECTION_LABEL[soundLabDirection(r)], "every steer has a safe label");
});

// --- 2. the plan is deterministic ------------------------------------------------

test("planSoundLab is pure + deterministic for the same read + prefs", () => {
  const prefs: SoundLabPreferences = { language: "Hindi", genre: "Bollywood", flavors: ["Lo-fi"] };
  for (const va of READS) {
    const a = planSoundLab({ va, prefs });
    const b = planSoundLab({ va, prefs });
    assert.deepEqual(a, b, "same inputs must build the same plan");
    assert.equal(a.direction, soundLabDirection(va));
    assert.ok(a.query.length > 0, "a plan always has a non-empty query");
  }
});

// --- 3. the query reflects taste, dedupes, and never leaks the internal steer label --

test("buildSoundQuery folds in genre/flavor/language, dedupes, and hides the steer label", () => {
  const q = buildSoundQuery("settle", { language: "Hindi", genre: "Bollywood", flavors: ["Lo-fi", "Acoustic"] });
  assert.match(q, /bollywood/);
  assert.match(q, /lofi/);
  assert.match(q, /acoustic/);
  assert.match(q, /hindi/);
  assert.match(q, /\bmusic$/);
  // The internal steer LABELS must never appear as search terms (they aren't genres).
  for (const label of Object.values(DIRECTION_LABEL)) {
    assert.ok(!q.toLowerCase().includes(label.toLowerCase()), `query must not contain steer label "${label}"`);
  }
  // "Surprise me" leaves the language lane open (no stray language token).
  const open = buildSoundQuery("steady", { language: "Surprise me", genre: "Indie", flavors: [] });
  assert.ok(!/hindi|english/.test(open), "surprise-me must not pin a language");
  // A feedback nudge that repeats the primary mood is deduped, not doubled.
  const nudged = buildSoundQuery("settle", { language: "Surprise me", genre: null, flavors: [] }, ["calm"]);
  assert.equal((nudged.match(/calm/g) ?? []).length, 1, "duplicate terms collapse");
});

// --- 4. every Sound Lab string passes the safety screens -------------------------

test("every plan string is safety-clean across all reads, genres and flavors", () => {
  const genres: readonly (MainMusicGenre | null)[] = [null, ...MAIN_GENRES];
  for (const va of READS) {
    for (const language of MUSIC_LANGUAGES) {
      for (const genre of genres) {
        const flavors = MUSIC_FLAVORS.slice(0, va.arousal > 0 ? 2 : 1);
        const plan = planSoundLab({ va, prefs: { language, genre, flavors } });
        const strings = [
          plan.copy,
          plan.tempoBand,
          plan.basedOn,
          plan.directionLabel,
          ...plan.descriptors,
          ...(plan.profile ? [plan.profile.title, plan.profile.genre] : []),
        ];
        for (const s of strings) {
          assert.ok(validateUserFacingText(s).ok, `forbidden phrase in "${s}"`);
          assert.ok(isConfidenceCopySafe(s), `leaked confidence number in "${s}"`);
        }
      }
    }
  }
});

// --- 5. defaults are sane --------------------------------------------------------

test("default preferences leave the lane fully open", () => {
  const d = defaultSoundLabPreferences();
  assert.equal(d.genre, null);
  assert.equal(d.flavors.length, 0);
  assert.ok(MUSIC_LANGUAGES.includes(d.language));
});

// A steer steers: settle picks calmer profiles than focused_momentum.
test("settle steers calmer than momentum", () => {
  const cur: ValenceArousal = { valence: 0, arousal: 0.2 };
  const settle = planSoundLab({ va: cur, prefs: defaultSoundLabPreferences() });
  void settle;
  const settleProfile = planSoundLab({ va: { valence: -0.4, arousal: 0.6 }, prefs: defaultSoundLabPreferences() }).profile;
  const momentumProfile = planSoundLab({ va: { valence: 0.5, arousal: 0.6 }, prefs: defaultSoundLabPreferences() }).profile;
  assert.ok(settleProfile && momentumProfile);
  assert.ok((settleProfile?.arousal ?? 0) < (momentumProfile?.arousal ?? 0), "settle profile is calmer");
});

const _targets: readonly MusicVaTarget[] = ["settle", "steady", "gentle_lift", "maintain", "focused_momentum"];
void _targets;
