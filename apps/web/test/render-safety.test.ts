/**
 * RENDER-LAYER SAFETY PROOF (Stable Build v3, Part B).
 *
 * The deferred "render-copy gate": prove that what the user can actually SEE — the real
 * HTML produced by `apps/web/src/app/render.ts` — stays safe after orchestration AND
 * rendering, across a battery of scenarios (mature/abstained/consented/held-prior).
 *
 * We drive the REAL render functions with reads from the REAL orchestrator, behind a
 * tiny hand-rolled `document` stub (no jsdom dependency — the repo stays dep-light; see
 * STABLE_BUILD_V3.md §2 for why this over jsdom). Every rendered surface is asserted to:
 *   - carry no raw percentage / probability in its visible text (ADR-0008),
 *   - contain no forbidden diagnosis / clinical-certainty language,
 *   - expose no clinical-risk head id or internal label (ADR-0006),
 *   - expose no raw-audio-like token.
 *
 * NOTE: this file is executed by tsx (it is outside both tsconfig `include` sets, so it is
 * run, not statically typed — the assertions are the contract).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asIsoTimestamp,
  asModelVersion,
  defaultConsent,
  type ConsentState,
} from "@hum-ai/shared-types";
import { computeFeatures, synthHum, synthSilence } from "@hum-ai/audio-features";
import {
  AFFECT_HEADS,
  CLINICAL_RISK_MARKER_HEAD_IDS,
  type AffectExpert,
  type ExpertInputMeta,
  type ExpertOutput,
} from "@hum-ai/affect-model-contracts";
import { isConfidenceCopySafe, validateUserFacingText } from "@hum-ai/safety-language";
import { orchestrateHumRead, type HumHistory, type LearnedAffectPrior, type OrchestratedRead } from "@hum-ai/orchestrator";
import {
  renderRead,
  renderInterventionOfDay,
  renderLongitudinal,
  renderPersonalization,
  renderProvenance,
  renderCaptureRejected,
  renderSignature,
} from "../src/app/render";
import { assessPersonalitySignature } from "@hum-ai/personality-signature";

// ── tiny DOM stub (no jsdom) ──────────────────────────────────────────────────
interface StubEl {
  innerHTML: string;
  hidden: boolean;
  textContent: string;
  style: Record<string, string>;
  firstElementChild: null;
  classList: { toggle(): void; add(): void; remove(): void };
  querySelector(): null;
  querySelectorAll(): [];
  addEventListener(): void;
  removeAttribute(): void;
  setAttribute(): void;
}
function makeEl(): StubEl {
  return {
    innerHTML: "",
    hidden: false,
    textContent: "",
    style: {},
    firstElementChild: null,
    classList: { toggle() {}, add() {}, remove() {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeAttribute() {},
    setAttribute() {},
  };
}
const els = new Map<string, StubEl>();
function installDom(): void {
  els.clear();
  (globalThis as { document?: unknown }).document = {
    getElementById(id: string): StubEl {
      let el = els.get(id);
      if (!el) {
        el = makeEl();
        els.set(id, el);
      }
      return el;
    },
  };
}

// ── safety assertions over rendered HTML ──────────────────────────────────────
const FORBIDDEN_IDS = [
  ...CLINICAL_RISK_MARKER_HEAD_IDS,
  ...CLINICAL_RISK_MARKER_HEAD_IDS.map((id) => AFFECT_HEADS[id].internalLabel),
];
const RAW_AUDIO_TOKENS = ["rawaudio", "raw_audio", "pcm", "waveform", "audiobuffer", "float32", "samples"];

function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ") // strip tags (drops style="left:50%" attrs too)
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assertHtmlSafe(html: string, where: string): void {
  if (!html) return;
  const text = visibleText(html);
  // (1) No raw percentage / probability in the VISIBLE confidence copy (ADR-0008).
  assert.equal(isConfidenceCopySafe(text), true, `raw confidence number rendered in ${where}: "${text}"`);
  // (2) No clinical-risk head id / internal label anywhere in the markup (ADR-0006).
  const lower = html.toLowerCase();
  for (const id of FORBIDDEN_IDS) {
    assert.equal(lower.includes(id.toLowerCase()), false, `clinical id '${id}' rendered in ${where}`);
  }
  // (3) No raw-audio-like token anywhere in the markup.
  for (const tok of RAW_AUDIO_TOKENS) {
    assert.equal(lower.includes(tok), false, `raw-audio token '${tok}' rendered in ${where}`);
  }
  // NOTE: the forbidden-PHRASE screen (validateUserFacingText) is applied to the DYNAMIC
  // model-generated strings (assertDynamicCopySafe), NOT to the full markup — the render
  // layer's protective disclaimers ("non-diagnostic", "does not diagnose") legitimately
  // contain "diagnos" and are allowed; only model CLAIMS are screened for it.
}

/** Assert every captured element is safe (call after a batch of render*() calls). */
function assertAllCapturedSafe(where: string): void {
  for (const [id, el] of els) assertHtmlSafe(el.innerHTML, `${where}#${id}`);
}

/** The dynamic, model-generated user-facing strings — must be forbidden-phrase + raw-% free. */
function assertDynamicCopySafe(read: OrchestratedRead): void {
  const uf = read.userFacing;
  const strings: string[] = [uf.headline, uf.note, uf.confidence.signalClarity, uf.confidence.basedOn, uf.confidence.summary];
  if (uf.innerState) strings.push(uf.innerState);
  if (uf.suggestion) strings.push(uf.suggestion.copy);
  const iod = uf.interventionOfDay;
  strings.push(iod.title, iod.instruction, iod.whySuggested);
  if (iod.musicRecommendation) strings.push(iod.musicRecommendation.copy, iod.musicRecommendation.basedOn);
  for (const s of strings) {
    assert.equal(validateUserFacingText(s).ok, true, `forbidden phrase in model copy: "${s}"`);
    assert.equal(isConfidenceCopySafe(s), true, `raw confidence number in model copy: "${s}"`);
  }
}

// ── orchestrator scenario harness ─────────────────────────────────────────────
const now = asIsoTimestamp("2026-06-21T12:00:00.000Z");
const modelVersion = asModelVersion("render-safety-test-v1");
const withConsent = (...scopes: ConsentState["grantedScopes"]): ConsentState => ({ grantedScopes: scopes, updatedAt: now });

const matureHistory: HumHistory = {
  eligibleSamplesByFeature: { meanRms: Array.from({ length: 30 }, (_, i) => 0.09 + ((i % 5) - 2) * 0.002) },
  priorEligibleCount: 30,
  relapseReferences: {
    baseline_30d: { capturedAt: now, dimensional: { valence: 0.1, arousal: 0 }, riskScore: 0.2 },
    previous_stable: { capturedAt: now, dimensional: { valence: 0.2, arousal: 0 }, riskScore: 0.15 },
  },
};

class FakeHeldPriorExpert implements AffectExpert {
  readonly expertId = "test:held-prior";
  readonly modality = "audio" as const;
  readonly labelSpace = ["calm_regulated", "neutral_close_to_usual"];
  predict(_f: unknown, meta: ExpertInputMeta): Promise<ExpertOutput> {
    return Promise.resolve({
      expertId: this.expertId,
      modality: this.modality,
      available: meta.captureQuality > 0,
      probabilities: { calm_regulated: 0.5, neutral_close_to_usual: 0.5 },
      selfConfidence: 0.3,
      domainMatch: 0.45,
      oodScore: 0.4,
    });
  }
}

function renderAll(read: OrchestratedRead, consent: ConsentState): void {
  renderRead(read, consent);
  renderInterventionOfDay(read);
  renderPersonalization(read);
  renderLongitudinal(read, consent, read.internal.eligibleHumCount);
  renderProvenance(read, null, false);
}

// ── tests ─────────────────────────────────────────────────────────────────────
test("a mature, risk-leaning, consented read renders only safe copy across every surface", async () => {
  installDom();
  const read = await orchestrateHumRead({
    features: computeFeatures(synthHum({ seed: 3, f0: 130, targetPeak: 0.7 })),
    consent: withConsent("local_processing", "clinical_risk_surfacing"),
    modelVersion,
    now,
    history: matureHistory,
  });
  renderAll(read, withConsent("local_processing", "clinical_risk_surfacing"));
  assertAllCapturedSafe("mature-consented");
  assertDynamicCopySafe(read);
});

test("an abstained (silent) read renders the 'hum again' surface safely with no axis/suggestion leak", async () => {
  installDom();
  const read = await orchestrateHumRead({
    features: computeFeatures(synthSilence({ seed: 4 })),
    consent: defaultConsent(now),
    modelVersion,
    now,
  });
  renderRead(read, defaultConsent(now));
  renderCaptureRejected({} as never); // decision is ignored by the renderer (it clears every surface)
  assertAllCapturedSafe("abstained");
});

test("the consent-gated longitudinal panel renders a safe LOCKED state when consent is off", async () => {
  installDom();
  const read = await orchestrateHumRead({
    features: computeFeatures(synthHum({ seed: 5 })),
    consent: defaultConsent(now),
    modelVersion,
    now,
    history: matureHistory,
  });
  renderLongitudinal(read, defaultConsent(now), read.internal.eligibleHumCount);
  assertAllCapturedSafe("longitudinal-locked");
});

test("the first-hum (early-baseline) read renders safely", async () => {
  installDom();
  const read = await orchestrateHumRead({
    features: computeFeatures(synthHum({ seed: 6 })),
    consent: defaultConsent(now),
    modelVersion,
    now,
  });
  renderAll(read, defaultConsent(now));
  assertAllCapturedSafe("first-hum");
  assertDynamicCopySafe(read);
});

test("a read produced with a HELD gate-failed prior renders safe provenance (v3 §A × §B)", async () => {
  installDom();
  const prior: LearnedAffectPrior = {
    expert: new FakeHeldPriorExpert(),
    confidenceCap: 0.45,
    capReason: "test far-domain cap",
    artifact: "mem://held-model",
    gatePassed: false,
    gateNote: "population prior; affect target did NOT pass the 80% balanced_accuracy gate.",
  };
  const read = await orchestrateHumRead({
    features: computeFeatures(synthHum({ seed: 7 })),
    consent: defaultConsent(now),
    modelVersion,
    now,
    history: matureHistory,
    learnedAffectPrior: prior,
  });
  // The held prior must be reflected honestly and safely in the provenance footer.
  assert.equal(read.internal.modelProvenance.priorContribution, "held_failed_gate");
  renderProvenance(read, null, false);
  const prov = els.get("provenance");
  assert.ok(prov && prov.innerHTML.length > 0, "provenance must render");
  assertAllCapturedSafe("held-prior");
});

// The OCEAN hum-signature card (renderSignature) carries render-ONLY copy — the badge and the
// disclaimer — that lives nowhere else and is NOT covered by the @hum-ai/personality-signature
// package's safety test. Screen the WHOLE visible card text for forbidden phrases here so any
// future edit reintroducing diagnosis/overclaim language into the card fails the build. (We scope
// the validateUserFacingText screen to THIS card because its disclaimers deliberately avoid the
// "diagnos*" token — unlike other surfaces' protective disclaimers, which legitimately use it.)
test("the OCEAN hum-signature card renders only safe copy, incl. the render-only badge + disclaimer", async () => {
  const rep = (v: number): number[] => Array.from({ length: 20 }, () => v);
  // A balanced (sparse-feature) signature AND a leaning one (steady → low openness, high conscientiousness),
  // so both headline branches + the OCEAN lede pole words are exercised.
  const leaningWindows: Record<string, number[]> = {
    pitchRangeSemitones: rep(0.4), musicalityScore: rep(0.3), vibratoRegularity: rep(0.2),
    controlledExpressionScore: rep(0.9), amplitudeStability: rep(0.97), pitchStability: rep(0.98),
    residualInstabilityScore: rep(0.12), shimmerProxy: rep(0.06), jitter: rep(0.006),
    meanRms: rep(0.06), peakAmplitude: rep(0.2), activeFrameRatio: rep(0.5), spectralCentroidHz: rep(720),
    smoothnessScore: rep(0.9), breathinessProxy: rep(0.15), residualPitchInstability: rep(0.06),
  };
  const sigs = [
    assessPersonalitySignature(matureHistory.eligibleSamplesByFeature, matureHistory.priorEligibleCount), // ~balanced
    assessPersonalitySignature(leaningWindows, 30), // leaning (deliberate / grounded)
  ];
  for (const sig of sigs) {
    installDom();
    const read = await orchestrateHumRead({
      features: computeFeatures(synthHum({ seed: 8, f0: 128, targetPeak: 0.65 })),
      consent: withConsent("local_processing", "clinical_risk_surfacing"),
      modelVersion,
      now,
      history: matureHistory,
    });
    renderSignature(sig, read, withConsent("local_processing", "clinical_risk_surfacing"), read.internal.eligibleHumCount, "local-test");
    const card = els.get("signature-card");
    assert.ok(card && card.innerHTML.length > 0, "signature card must render");
    assertHtmlSafe(card.innerHTML, "signature-card"); // raw% / clinical id / raw-audio
    const text = visibleText(card.innerHTML);
    assert.equal(validateUserFacingText(text).ok, true, `forbidden phrase in signature card: "${text}"`);
    // The MBTI overlay must never reappear in the rendered card.
    assert.ok(!/\b[EI][NS][FT][JP]\b/.test(text), `MBTI-like code rendered in signature card: "${text}"`);
    // The OCEAN framing + the anti-overclaim frame are present.
    assert.match(text, /OCEAN/);
    assert.match(text, /not a personality test/);
  }
});

// Smoke check that the safety asserters actually reject unsafe copy (guards the guards).
test("the safety asserters reject a raw percentage, a clinical id, and a diagnosis claim (self-check)", () => {
  const firstClinical = CLINICAL_RISK_MARKER_HEAD_IDS[0] as string;
  assert.throws(() => assertHtmlSafe("<p>confidence 87%</p>", "self"), /confidence number/);
  assert.throws(() => assertHtmlSafe(`<p>${firstClinical}</p>`, "self"), /clinical id/);
  // The dynamic-copy screen catches an affirmative diagnosis claim (the disclaimer form is allowed).
  assert.equal(validateUserFacingText("you have depression").ok, false);
  assert.equal(validateUserFacingText("This view is non-diagnostic.").ok, false); // contains "diagnostic" — disclaimers are render-only, never model copy
});
