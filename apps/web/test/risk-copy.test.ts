/**
 * COPY-SAFETY PROOF for the three within-user risk markers.
 *
 * The medical layer is the most safety-sensitive copy in the product, so every string
 * it can show is screened here: no forbidden diagnostic/claim phrase, no raw
 * confidence number, and no clinical head id / internal label leak. This runs in pure
 * Node (the copy module has no DOM), so it is a fast, deterministic firewall.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateUserFacingText, isConfidenceCopySafe } from "@hum-ai/safety-language";
import { AFFECT_HEADS, CLINICAL_RISK_MARKER_HEAD_IDS } from "@hum-ai/affect-model-contracts";
import type { RiskMarkerId, RiskMarkerLevel } from "@hum-ai/relapse-engine";
import {
  RISK_MARKER_COPY,
  riskMarkerLine,
  riskLevelWord,
  riskTone,
  RISK_LEGEND,
  MOOD_LEGEND,
  RISK_LAYERS_NOTE,
} from "../src/app/risk-copy";

const IDS: readonly RiskMarkerId[] = ["depressive_affect", "anxiety_tension", "relapse_drift"];
const LEVELS: readonly RiskMarkerLevel[] = ["insufficient_data", "settled", "watch", "elevated"];

// Every clinical head id + its internal label must never appear in user-facing copy or a DOM token.
const FORBIDDEN_IDS = [
  ...CLINICAL_RISK_MARKER_HEAD_IDS,
  ...CLINICAL_RISK_MARKER_HEAD_IDS.map((id) => AFFECT_HEADS[id].internalLabel),
].map((s) => s.toLowerCase());

/** Collect every string the medical layer can render. */
function allCopyStrings(): string[] {
  const out: string[] = [RISK_LAYERS_NOTE];
  for (const id of IDS) {
    const c = RISK_MARKER_COPY[id];
    out.push(c.name, c.sub, c.about, c.token);
    for (const lvl of LEVELS) {
      out.push(riskMarkerLine(id, lvl, false));
      out.push(riskMarkerLine(id, lvl, true));
      out.push(riskLevelWord(lvl));
    }
  }
  for (const e of RISK_LEGEND) out.push(e.label, e.meaning);
  for (const e of MOOD_LEGEND) out.push(e.label);
  return out;
}

test("every risk-marker copy string is free of forbidden diagnostic / claim language", () => {
  for (const s of allCopyStrings()) {
    const r = validateUserFacingText(s);
    assert.equal(r.ok, true, `forbidden phrase in risk copy: "${s}" -> ${JSON.stringify(r.violations)}`);
  }
});

test("no risk-marker copy string carries a raw confidence number (ADR-0008)", () => {
  for (const s of allCopyStrings()) {
    assert.equal(isConfidenceCopySafe(s), true, `raw confidence number in risk copy: "${s}"`);
  }
});

test("no clinical head id or internal label leaks into copy or DOM tokens", () => {
  for (const s of allCopyStrings()) {
    const lower = s.toLowerCase();
    for (const id of FORBIDDEN_IDS) {
      assert.equal(lower.includes(id), false, `clinical id/label '${id}' leaked in copy: "${s}"`);
    }
  }
});

test("the DOM tokens are safe kebab tokens, not engine ids", () => {
  const tokens = IDS.map((id) => RISK_MARKER_COPY[id].token);
  assert.deepEqual([...tokens].sort(), ["low-mood", "steadiness", "tension"]);
  // The engine id 'relapse_drift' is itself a forbidden head id — make sure it never became a token.
  assert.equal(tokens.includes("relapse_drift" as never), false);
});

test("tone + level word resolve for every level", () => {
  for (const lvl of LEVELS) {
    assert.ok(riskLevelWord(lvl).length > 0);
    assert.ok(["learning", "settled", "watch", "elevated"].includes(riskTone(lvl)));
  }
});
