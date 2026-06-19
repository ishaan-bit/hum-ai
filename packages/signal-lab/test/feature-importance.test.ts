import { test } from "node:test";
import assert from "node:assert/strict";
import { anovaF, featureImportanceReport } from "../src/feature-importance";

const NAMES = ["informative", "noise"];

/** `informative` separates classes; `noise` does not. */
function data(): { X: number[][]; y: string[] } {
  const X: number[][] = [];
  const y: string[] = [];
  for (let i = 0; i < 50; i++) {
    X.push([5 + (i % 3) * 0.1, (i % 7) - 3]);
    y.push("a");
    X.push([-5 - (i % 3) * 0.1, (i % 7) - 3]);
    y.push("b");
  }
  return { X, y };
}

test("ANOVA-F ranks a class-separating feature far above a noise feature", () => {
  const { X, y } = data();
  const scores = anovaF(X, y, NAMES);
  const informative = scores.find((s) => s.feature === "informative")!;
  const noise = scores.find((s) => s.feature === "noise")!;
  assert.equal(informative.rank, 1);
  assert.ok(informative.score > noise.score * 10, `informative ${informative.score} ≫ noise ${noise.score}`);
});

test("feature importance report exposes strongest and weakest", () => {
  const { X, y } = data();
  const rep = featureImportanceReport(X, y, NAMES, "toy", 2);
  assert.equal(rep.strongest[0]!.feature, "informative");
  assert.equal(rep.weakest[0]!.feature, "noise");
  assert.equal(rep.numClasses, 2);
  assert.ok(rep.method.includes("ANOVA"));
});
