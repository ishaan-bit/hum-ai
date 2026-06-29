import { test } from "node:test";
import assert from "node:assert/strict";
import type { ValenceArousal } from "@hum-ai/shared-types";
import { validateUserFacingText, isConfidenceCopySafe } from "@hum-ai/safety-language";
import {
  planSoundLab,
  buildSoundQuery,
  soundLabDirection,
  defaultSoundLabPreferences,
  genresForLanguage,
  flavorsForGenre,
  pertinentGenres,
  defaultGenreForState,
  defaultFlavorsForState,
  defaultPrefsForState,
  reconcilePreferences,
  DIRECTION_LABEL,
  MAIN_GENRES,
  MUSIC_FLAVORS,
  MUSIC_LANGUAGES,
  MAX_FLAVORS,
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

// --- 6. DYNAMIC FILTER TAXONOMY: only coherent language→genre→flow combinations -----

test("genresForLanguage removes nonsensical language×genre combinations", () => {
  const hindi = genresForLanguage("Hindi");
  const english = genresForLanguage("English");
  // Hindi can't carry the English-language lanes; English can't carry the India-specific lanes.
  for (const g of ["Metal", "Jazz", "Blues"] as const) assert.ok(!hindi.includes(g), `Hindi excludes ${g}`);
  for (const g of ["Bollywood", "Devotional"] as const) assert.ok(!english.includes(g), `English excludes ${g}`);
  // Bollywood/Devotional ARE valid Hindi lanes; "Surprise me" leaves everything open.
  assert.ok(hindi.includes("Bollywood") && hindi.includes("Devotional"));
  assert.deepEqual([...genresForLanguage("Surprise me")].sort(), [...MAIN_GENRES].sort());
  // Every language's genre list is a subset of the canonical genres.
  for (const l of MUSIC_LANGUAGES) for (const g of genresForLanguage(l)) assert.ok(MAIN_GENRES.includes(g));
});

test("flavorsForGenre removes nonsensical genre×flow combinations", () => {
  // No lo-fi/acoustic metal; no electronic classical; no ambient/electronic blues.
  assert.ok(!flavorsForGenre("Metal").includes("Lo-fi") && !flavorsForGenre("Metal").includes("Acoustic"));
  assert.ok(!flavorsForGenre("Classical").includes("Electronic"));
  assert.ok(!flavorsForGenre("Blues").includes("Electronic") && !flavorsForGenre("Blues").includes("Ambient"));
  // Every genre's flow list is a non-empty subset of the canonical flavors.
  for (const g of MAIN_GENRES) {
    const fl = flavorsForGenre(g);
    assert.ok(fl.length > 0, `${g} offers at least one flow`);
    for (const f of fl) assert.ok(MUSIC_FLAVORS.includes(f), `${g} flow ${f} is canonical`);
  }
  // With no genre chosen there's nothing to constrain against → the full set is offered.
  assert.deepEqual([...flavorsForGenre(null)].sort(), [...MUSIC_FLAVORS].sort());
});

test("defaultPrefsForState is always a COHERENT, state-tied selection", () => {
  for (const va of READS) {
    for (const language of MUSIC_LANGUAGES) {
      const p = defaultPrefsForState(va, language);
      assert.equal(p.language, language);
      assert.ok(p.genre, "a default genre is always chosen");
      assert.ok(genresForLanguage(language).includes(p.genre as MainMusicGenre), "default genre is language-valid");
      const allowed = flavorsForGenre(p.genre);
      for (const f of p.flavors) assert.ok(allowed.includes(f), "default flow is genre-valid");
      assert.ok(p.flavors.length <= MAX_FLAVORS, "default flow respects the cap");
      // Determinism.
      assert.deepEqual(defaultPrefsForState(va, language), p);
    }
  }
});

test("pertinentGenres is a state-driven subset of the language's genres", () => {
  for (const va of READS) {
    for (const language of MUSIC_LANGUAGES) {
      const allowed = genresForLanguage(language);
      const pert = pertinentGenres(va, language);
      for (const g of pert) assert.ok(allowed.includes(g), "pertinent ⊆ language-valid");
      // The default genre is the first pertinent one (state leads the default).
      if (pert.length) assert.equal(defaultGenreForState(va, language), pert[0]);
    }
  }
  // A calming read leans to a calmer default genre than an energised read (state actually steers).
  const settle = defaultGenreForState({ valence: -0.5, arousal: 0.6 }, "Surprise me");
  const momentum = defaultGenreForState({ valence: 0.5, arousal: 0.6 }, "Surprise me");
  assert.notEqual(settle, momentum, "different states seed different default genres");
  assert.ok(["Classical", "Devotional", "Folk"].includes(settle as MainMusicGenre), "settle → a calm genre");
});

test("reconcilePreferences drops incoherent genre/flow, keeps valid taste", () => {
  // Bollywood isn't an English lane → dropped (and its flow with it).
  const a = reconcilePreferences({ language: "English", genre: "Bollywood", flavors: ["Electronic"] });
  assert.equal(a.genre, null);
  assert.deepEqual(a.flavors, []);
  // Lo-fi isn't a coherent Metal flow → dropped; the valid genre is kept.
  const b = reconcilePreferences({ language: "English", genre: "Metal", flavors: ["Lo-fi", "Electronic"] });
  assert.equal(b.genre, "Metal");
  assert.deepEqual(b.flavors, ["Electronic"]);
  // A wholly-valid taste is returned unchanged.
  const ok: SoundLabPreferences = { language: "Hindi", genre: "Bollywood", flavors: ["Lo-fi"] };
  assert.deepEqual(reconcilePreferences(ok), ok);
});

test("defaultFlavorsForState only yields flows the genre can carry", () => {
  for (const va of READS) {
    for (const g of [null, ...MAIN_GENRES] as const) {
      const fl = defaultFlavorsForState(va, g);
      const allowed = flavorsForGenre(g);
      for (const f of fl) assert.ok(allowed.includes(f));
      assert.ok(fl.length <= MAX_FLAVORS);
    }
  }
});

// --- 7. planSoundLab reconciles at the QUERY BOUNDARY (no incoherent combo can leak) ----

test("planSoundLab never lets an incoherent taste reach the query", () => {
  const va = { valence: -0.5, arousal: 0.6 }; // settle → primary mood "calm"
  // Bollywood isn't an English lane: it (and its now-orphaned flow) must be dropped from the query.
  const q1 = planSoundLab({ va, prefs: { language: "English", genre: "Bollywood", flavors: ["Electronic"] } }).query;
  assert.ok(!/bollywood/i.test(q1), "an English-language Bollywood search never escapes");
  // Lo-fi isn't a coherent Metal flow: dropped; the valid genre + flow survive.
  const q2 = planSoundLab({ va, prefs: { language: "English", genre: "Metal", flavors: ["Lo-fi", "Electronic"] } }).query;
  assert.ok(/metal/i.test(q2) && /electronic/i.test(q2) && !/lofi/i.test(q2), "metal keeps electronic, drops lofi");
  // A coherent taste is unchanged and the read-derived primary mood still leads.
  const q3 = planSoundLab({ va, prefs: { language: "Hindi", genre: "Bollywood", flavors: ["Lo-fi"] } }).query;
  assert.ok(/^calm\b/.test(q3) && /bollywood/.test(q3) && /hindi/.test(q3), "coherent taste + state mood survive");
});

test("a coherent taste always survives the query alongside the read's mood", () => {
  // The steer's primary mood must never swallow a genuine taste token (defensive against future
  // term overlaps). Pop+Electronic is coherent for English across every steer.
  const targets: readonly MusicVaTarget[] = ["settle", "steady", "gentle_lift", "maintain", "focused_momentum"];
  const region: Record<MusicVaTarget, { valence: number; arousal: number }> = {
    settle: { valence: -0.5, arousal: 0.6 },
    steady: { valence: -0.05, arousal: 0.05 },
    gentle_lift: { valence: -0.4, arousal: -0.4 },
    maintain: { valence: 0.5, arousal: -0.4 },
    focused_momentum: { valence: 0.5, arousal: 0.6 },
  };
  for (const t of targets) {
    const q = planSoundLab({ va: region[t], prefs: { language: "English", genre: "Pop", flavors: ["Electronic"] } }).query;
    assert.equal(soundLabDirection(region[t]), t);
    assert.ok(/pop/.test(q) && /electronic/.test(q), `taste survives for ${t}: ${q}`);
  }
});

test("reconcilePreferences de-duplicates flavors", () => {
  const p = reconcilePreferences({ language: "Hindi", genre: "Bollywood", flavors: ["Lo-fi", "Lo-fi"] });
  assert.deepEqual(p.flavors, ["Lo-fi"], "a repeated flow collapses to one slot");
});
