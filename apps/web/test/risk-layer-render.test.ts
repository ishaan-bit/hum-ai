/**
 * MEDICAL-LAYER RENDER PROOF.
 *
 * Drives the REAL `renderLongitudinal` with a consented diary history (and no live read —
 * the "cold diary" path that the always-accessible Diary tab needs) and asserts that:
 *   - the three named within-user early signals render (low-mood / tension / steadiness),
 *   - the colour legend renders,
 *   - the visible copy carries no raw percentage and no clinical head id / internal label.
 *
 * Runs behind a tiny hand-rolled `document` stub (no jsdom), mirroring render-safety.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultConsent, asIsoTimestamp, type ConsentState } from "@hum-ai/shared-types";
import { isConfidenceCopySafe } from "@hum-ai/safety-language";
import { AFFECT_HEADS, CLINICAL_RISK_MARKER_HEAD_IDS } from "@hum-ai/affect-model-contracts";
import { renderLongitudinal, type DiaryPoint } from "../src/app/render";

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

const FORBIDDEN_IDS = [
  ...CLINICAL_RISK_MARKER_HEAD_IDS,
  ...CLINICAL_RISK_MARKER_HEAD_IDS.map((id) => AFFECT_HEADS[id].internalLabel),
].map((s) => s.toLowerCase());

function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

const consented: ConsentState = {
  grantedScopes: ["local_processing", "clinical_risk_surfacing"],
  updatedAt: asIsoTimestamp("2026-06-24T12:00:00.000Z"),
};

/** A deep-enough history: steady, then a sustained low-and-flat stretch (depressive-leaning). */
function history(): DiaryPoint[] {
  const base: DiaryPoint[] = Array.from({ length: 10 }, (_, i) => ({
    at: asIsoTimestamp(`2026-06-${String(10 + i).padStart(2, "0")}T09:00:00.000Z`),
    valence: 0.1 + (i % 2 ? 0.03 : -0.03),
    arousal: 0.0 + (i % 2 ? 0.02 : -0.02),
    risk: 0.2,
  }));
  const low: DiaryPoint[] = [0, 1, 2, 3].map((k) => ({
    at: asIsoTimestamp(`2026-06-${String(20 + k).padStart(2, "0")}T09:00:00.000Z`),
    valence: -0.55 - k * 0.02,
    arousal: -0.3,
    risk: 0.4,
  }));
  return [...base, ...low];
}

test("the consented cold diary renders all three within-user early signals", () => {
  installDom();
  renderLongitudinal(null, consented, 14, { points: history() });
  const html = els.get("longitudinal-card")?.innerHTML ?? "";
  assert.ok(html.includes("Early signals"), "missing the medical-layer header");
  assert.ok(html.includes('data-layer="low-mood"'), "missing the depressive-affect layer");
  assert.ok(html.includes('data-layer="tension"'), "missing the anxiety-tension layer");
  assert.ok(html.includes('data-layer="steadiness"'), "missing the relapse-drift layer");
  assert.ok(html.includes("What the colours mean"), "missing the colour legend");
});

test("the rendered medical layer is safe (no raw %, no clinical id/label leak)", () => {
  installDom();
  renderLongitudinal(null, consented, 14, { points: history() });
  const html = els.get("longitudinal-card")?.innerHTML ?? "";
  const text = visibleText(html);
  assert.equal(isConfidenceCopySafe(text), true, `raw confidence number rendered: "${text}"`);
  const lower = html.toLowerCase();
  for (const id of FORBIDDEN_IDS) {
    assert.equal(lower.includes(id), false, `clinical id/label '${id}' leaked into the diary markup`);
  }
});

test("the locked diary (consent off) does not render the medical layer", () => {
  installDom();
  renderLongitudinal(null, defaultConsent(asIsoTimestamp("2026-06-24T12:00:00.000Z")), 14, { points: history() });
  const html = els.get("longitudinal-card")?.innerHTML ?? "";
  assert.equal(html.includes("Early signals"), false, "medical layer must stay behind consent");
});
