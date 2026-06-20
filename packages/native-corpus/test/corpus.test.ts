import { test } from "node:test";
import assert from "node:assert/strict";
import { appendExample, emptyCorpus, corpusStats, trainableExamples, parseCorpus, NATIVE_CORPUS_LIMIT } from "../src/corpus";
import { makeExample } from "./fixtures";

test("append validates, dedups by id, and keeps eligible-only trainable", () => {
  let c = emptyCorpus();
  c = appendExample(c, makeExample({ id: "a", label: { valence: 0.5, arousal: 0.5 } }));
  c = appendExample(c, makeExample({ id: "b", label: { valence: -0.5, arousal: -0.5 }, eligible: false }));
  // Re-label "a" → overwrite, not duplicate.
  c = appendExample(c, makeExample({ id: "a", label: { valence: -0.2, arousal: 0.1 } }));
  assert.equal(c.examples.length, 2);
  assert.equal(c.examples.find((e) => e.id === "a")!.label.valence, -0.2);
  assert.equal(trainableExamples(c).length, 1); // "b" is ineligible
});

test("an invalid row is rejected by append (privacy guard)", () => {
  const c = emptyCorpus();
  const bad = { ...makeExample({ id: "x", label: { valence: 2, arousal: 0 } }) };
  assert.throws(() => appendExample(c, bad));
});

test("the ring is bounded oldest-first", () => {
  let c = emptyCorpus();
  for (let i = 0; i < NATIVE_CORPUS_LIMIT + 5; i++) {
    c = appendExample(c, makeExample({ id: `e${i}`, label: { valence: 0.3, arousal: 0.3 } }));
  }
  assert.equal(c.examples.length, NATIVE_CORPUS_LIMIT);
  assert.equal(c.examples[0]!.id, "e5"); // first 5 dropped
});

test("stats report quadrant coverage, balance, and agreement", () => {
  let c = emptyCorpus();
  c = appendExample(c, makeExample({ id: "1", label: { valence: 0.5, arousal: 0.5 }, source: "self_report_confirm", agreedWithRead: true }));
  c = appendExample(c, makeExample({ id: "2", label: { valence: -0.5, arousal: 0.5 } }));
  c = appendExample(c, makeExample({ id: "3", label: { valence: 0.5, arousal: -0.5 } }));
  c = appendExample(c, makeExample({ id: "4", label: { valence: -0.5, arousal: -0.5 } }));
  const s = corpusStats(c);
  assert.equal(s.total, 4);
  assert.equal(s.quadrantsCovered, 4);
  assert.equal(s.confirmed, 1);
  assert.equal(s.adjusted, 3);
  assert.equal(s.axisBalance.valence.high, 2);
  assert.equal(s.axisBalance.valence.low, 2);
  assert.ok(s.agreementRate > 0 && s.agreementRate < 1);
});

test("parseCorpus round-trips and drops a single malformed row", () => {
  let c = emptyCorpus();
  c = appendExample(c, makeExample({ id: "ok", label: { valence: 0.4, arousal: 0.1 } }));
  const json = JSON.stringify(c);
  const back = parseCorpus(json);
  assert.equal(back.examples.length, 1);
  // Inject a malformed row into the serialized form.
  const tampered = JSON.parse(json);
  tampered.examples.push({ id: "bad", label: { valence: 9, arousal: 0 } });
  const recovered = parseCorpus(JSON.stringify(tampered));
  assert.equal(recovered.examples.length, 1); // bad row dropped, good row kept
  assert.equal(parseCorpus(null).examples.length, 0);
});
