import { test } from "node:test";
import assert from "node:assert/strict";
import { newRegimeState, updateRegime } from "@hum-ai/personalization-engine";

test("stable noise around zero does not trip a regime shift", () => {
  let s = newRegimeState();
  let anyShift = false;
  for (let i = 0; i < 40; i++) {
    const u = updateRegime(s, i % 2 === 0 ? 0.1 : -0.1);
    s = u.state;
    if (u.shift !== "none") anyShift = true;
  }
  assert.equal(anyShift, false);
});

test("a sustained upward drift is detected as an 'up' shift, then the detector resets", () => {
  let s = newRegimeState();
  for (let i = 0; i < 10; i++) s = updateRegime(s, i % 2 === 0 ? 0.05 : -0.05).state; // warm up ~0
  let shift: "none" | "up" | "down" = "none";
  for (let i = 0; i < 30 && shift === "none"; i++) {
    const u = updateRegime(s, 1.5);
    s = u.state;
    shift = u.shift;
  }
  assert.equal(shift, "up");
  assert.equal(s.sinceShift, 0);
  assert.equal(s.lastShift, "up");
});

test("a sustained downward drift is detected as 'down'", () => {
  let s = newRegimeState();
  for (let i = 0; i < 10; i++) s = updateRegime(s, i % 2 === 0 ? 0.05 : -0.05).state;
  let shift: "none" | "up" | "down" = "none";
  for (let i = 0; i < 30 && shift === "none"; i++) {
    const u = updateRegime(s, -1.5);
    s = u.state;
    shift = u.shift;
  }
  assert.equal(shift, "down");
});

test("a non-finite observation is tolerated (no NaN poisoning)", () => {
  const u = updateRegime(newRegimeState(), Number.NaN);
  assert.equal(u.shift, "none");
  assert.equal(Number.isFinite(u.state.mean), true);
});
