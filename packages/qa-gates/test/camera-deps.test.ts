import { test } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cameraDepsGate,
  isForbiddenCameraPackage,
  scanPackageJsonForCameraDeps,
} from "@hum-ai/qa-gates";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../../");

test("camera-deps gate passes on the real (clean) tree; expert-fer is a placeholder", () => {
  const result = cameraDepsGate(REPO_ROOT);
  assert.deepEqual(
    result.violations,
    [],
    `Unexpected camera/CV deps or FER import:\n${result.violations.map((v) => `  ${v.where}: ${v.token}`).join("\n")}`,
  );
});

test("denylist matches exact names and scope/name prefixes", () => {
  for (const name of [
    "opencv4nodejs",
    "face-api.js",
    "@vladmandic/face-api",
    "@mediapipe/face_mesh",
    "@mediapipe/tasks-vision",
    "@tensorflow-models/face-landmarks-detection",
    "@tensorflow-models/facemesh",
    "clmtrackr",
    "tracking.js",
    "jeelizfacefilter",
  ]) {
    assert.ok(isForbiddenCameraPackage(name), `expected "${name}" to be forbidden`);
  }
});

test("denylist does NOT flag legitimate packages", () => {
  for (const name of [
    "tsx",
    "typescript",
    "@types/node",
    "@hum-ai/affect-model-contracts",
    "@tensorflow/tfjs", // not a face-* model package
    "opencv-docs", // not the exact 'opencv'
    "react", // unrelated
  ]) {
    assert.ok(!isForbiddenCameraPackage(name), `did not expect "${name}" to be forbidden`);
  }
});

test("scanPackageJsonForCameraDeps flags a synthetic offending package.json", () => {
  const synthetic = {
    name: "@hum-ai/app-web",
    dependencies: { "face-api.js": "^1.0.0", react: "^18.0.0" },
    devDependencies: { "@mediapipe/face_mesh": "^0.4.0" },
  };
  const violations = scanPackageJsonForCameraDeps(synthetic, "apps/web/package.json");
  const tokens = violations.map((v) => v.token);
  assert.ok(tokens.some((t) => t.includes("face-api.js")), "should flag face-api.js in dependencies");
  assert.ok(tokens.some((t) => t.includes("@mediapipe/face_mesh")), "should flag mediapipe in devDependencies");
  assert.equal(violations.length, 2, "react should not be flagged");
  for (const v of violations) assert.ok(v.fix.includes("voice-first"), "fix should reference voice-first policy");
});
