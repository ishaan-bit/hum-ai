import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listTrackedFiles } from "./git";
import type { GateResult, GateViolation } from "./types";

/**
 * GATE: no camera / computer-vision / face-extraction packages (ADR-0009).
 *
 * Hum is voice-first; camera/FER is a later phase and `@hum-ai/expert-fer` stays
 * a placeholder (no real model, no camera import). This gate scans EVERY tracked
 * package.json (root + workspaces) dependency map for known camera/CV/face
 * libraries, and separately confirms expert-fer's source imports nothing from
 * that denylist.
 *
 * The denylist matches by exact package name OR scope prefix (`@mediapipe/*`,
 * `@tensorflow-models/face-*`). We intentionally do NOT regex over arbitrary
 * substrings of names, so a legitimately-named internal package cannot trip it.
 */

/** Exact package names that are forbidden. */
export const FORBIDDEN_CAMERA_PACKAGES: readonly string[] = [
  "opencv",
  "opencv4nodejs",
  "@u4/opencv4nodejs",
  "mediapipe",
  "@mediapipe/face_mesh",
  "@mediapipe/face_detection",
  "@mediapipe/tasks-vision",
  "face-api.js",
  "@vladmandic/face-api",
  "@tensorflow-models/face-landmarks-detection",
  "@tensorflow-models/facemesh",
  "@tensorflow-models/blazeface",
  "face-detector",
  "clmtrackr",
  "tracking.js",
  "jeelizfacefilter",
  "react-webcam",
  "webcam-easy",
];

/** Scope/name prefixes that are forbidden (covers all subpackages). */
export const FORBIDDEN_CAMERA_PREFIXES: readonly string[] = [
  "@mediapipe/",
  "@tensorflow-models/face",
];

const CAMERA_FIX =
  "Hum is voice-first; camera/FER is a later phase (ADR-0009). Remove the dependency. expert-fer must stay a placeholder until the camera phase is approved.";

/** True if a dependency name is on the camera/CV denylist. */
export function isForbiddenCameraPackage(name: string): boolean {
  if (FORBIDDEN_CAMERA_PACKAGES.includes(name)) return true;
  return FORBIDDEN_CAMERA_PREFIXES.some((p) => name.startsWith(p));
}

const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;

/**
 * Pure matcher: given a package.json's parsed object and its path, return any
 * forbidden camera/CV dependencies. Exported for synthetic-object tests.
 */
export function scanPackageJsonForCameraDeps(
  pkg: Record<string, unknown>,
  where: string,
): GateViolation[] {
  const violations: GateViolation[] = [];
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (deps == null || typeof deps !== "object") continue;
    for (const name of Object.keys(deps as Record<string, unknown>)) {
      if (isForbiddenCameraPackage(name)) {
        violations.push({
          gate: "no-camera-deps",
          where,
          token: `${field}["${name}"]`,
          detail: `camera/computer-vision/face package "${name}" is not allowed`,
          fix: CAMERA_FIX,
        });
      }
    }
  }
  return violations;
}

/** Forbidden import specifiers inside expert-fer source (placeholder integrity). */
function scanFerPlaceholder(repoRoot: string, trackedFiles: readonly string[]): GateViolation[] {
  const violations: GateViolation[] = [];
  const ferSources = trackedFiles.filter(
    (f) => f.startsWith("packages/expert-fer/src/") && f.endsWith(".ts"),
  );
  // import ... from "<spec>"  |  require("<spec>")  |  import("<spec>")
  const importRe = /\b(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;
  for (const rel of ferSources) {
    let content: string;
    try {
      content = readFileSync(join(repoRoot, rel), "utf8");
    } catch {
      continue;
    }
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(content)) !== null) {
      const spec = m[1];
      if (spec && isForbiddenCameraPackage(spec)) {
        violations.push({
          gate: "no-camera-deps:fer-placeholder",
          where: rel,
          token: `import "${spec}"`,
          detail: `expert-fer imports a camera/CV package — it must stay a placeholder (no real FER)`,
          fix: CAMERA_FIX,
        });
      }
    }
  }
  return violations;
}

/** GATE entry: scan every tracked package.json + expert-fer source. */
export function cameraDepsGate(repoRoot: string): GateResult {
  const tracked = listTrackedFiles(repoRoot);
  const pkgJsonPaths = tracked.filter(
    (f) => f === "package.json" || (f.endsWith("/package.json") && !f.includes("node_modules/")),
  );
  const violations: GateViolation[] = [];
  for (const rel of pkgJsonPaths) {
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(readFileSync(join(repoRoot, rel), "utf8")) as Record<string, unknown>;
    } catch {
      continue;
    }
    violations.push(...scanPackageJsonForCameraDeps(pkg, rel));
  }
  violations.push(...scanFerPlaceholder(repoRoot, tracked));
  return {
    gate: "no-camera-deps",
    description:
      "No camera/CV/face-extraction packages in any package.json; expert-fer stays a placeholder (ADR-0009).",
    violations,
  };
}
