/**
 * Firebase smoke test — DEV ONLY, never ships to production.
 *
 * Run:
 *   npm run firebase:smoke
 *
 * Prerequisites:
 *   cp .env.example .env   # then fill in real HUM_AI_FIREBASE_* values
 *
 * What this checks (in order):
 *   1. HUM_AI_FIREBASE_* env vars load without error
 *   2. Firebase app initializes (initializeApp does not throw)
 *   3. Firebase Auth client initializes (getAuth does not throw)
 *   4. Firestore client initializes (getFirestore does not throw)
 *   5. No credential files are tracked by git (mirrors the qa-gates check)
 *
 * No network calls are made — checks 1-4 are pure client initialization.
 * Existing tests and qa-gates run via the commands the user invokes separately.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── optional .env loader (avoids dotenv dependency) ──────────────────────────
// Node ≥ 20.6 supports --env-file but 22.6 (our floor) is safe either way.
// We do a simple manual parse so `npm run firebase:smoke` just works without
// requiring the caller to prefix `source .env`.
function loadDotEnvIfPresent(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
  const path = resolve(root, ".env");
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && val && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadDotEnvIfPresent();

// ── after env is populated, load firebase ────────────────────────────────────
import { loadFirebaseConfig, firebaseApp, firebaseAuth, firebaseFirestore } from "../src/firebase.js";
import { scanForbiddenPaths } from "@hum-ai/qa-gates";

// ── helpers ──────────────────────────────────────────────────────────────────
const OK = "  ok ";
const FAIL = " FAIL ";
let failures = 0;

function pass(label: string): void {
  process.stdout.write(`${OK} ${label}\n`);
}

function fail(label: string, err: unknown): void {
  failures++;
  process.stdout.write(`${FAIL} ${label}\n       ${String(err)}\n`);
}

function repoRoot(): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  } catch {
    return resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
  }
}

function trackedFiles(): string[] {
  const root = repoRoot();
  const out = execFileSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out.split("\0").filter((p) => p.length > 0);
}

// ── smoke checks ─────────────────────────────────────────────────────────────

process.stdout.write("Hum AI — Firebase smoke test\n");
process.stdout.write("────────────────────────────────────────────\n");

// 1. Config loads from env
let config: ReturnType<typeof loadFirebaseConfig>;
try {
  config = loadFirebaseConfig();
  pass(`config loaded (projectId=${config.projectId}, appId=${config.appId.slice(0, 12)}…)`);
} catch (err) {
  fail("config: HUM_AI_FIREBASE_* env vars", err);
  process.stdout.write("\nSmoke test ABORTED — fix env vars and re-run.\n");
  process.exit(1);
}

// 2. Firebase app initializes
try {
  const app = firebaseApp();
  pass(`firebase app initialized (name=${app.name})`);
} catch (err) {
  fail("firebase app initialization", err);
}

// 3. Auth client initializes
try {
  const auth = firebaseAuth();
  pass(`auth client initialized (tenantId=${auth.tenantId ?? "none"})`);
} catch (err) {
  fail("firebase auth initialization", err);
}

// 4. Firestore client initializes
try {
  const db = firebaseFirestore();
  // app.name on the firestore instance confirms it's bound to the right app
  pass(`firestore client initialized (app=${db.app.name})`);
} catch (err) {
  fail("firestore initialization", err);
}

// 5. No credential files tracked by git
try {
  const paths = trackedFiles();
  const credViolations = scanForbiddenPaths(paths).filter((v) =>
    v.gate.includes("cloud-credential") || v.gate.includes("private-key"),
  );
  if (credViolations.length > 0) {
    for (const v of credViolations) {
      fail(`credential file in git: ${v.where}`, v.detail);
    }
  } else {
    pass(`no credential files tracked by git (scanned ${paths.length} paths)`);
  }
} catch (err) {
  fail("git ls-files credential scan", err);
}

// ── summary ──────────────────────────────────────────────────────────────────
process.stdout.write("────────────────────────────────────────────\n");
if (failures > 0) {
  process.stdout.write(`Firebase smoke test FAILED: ${failures} check(s). See above.\n`);
  process.exit(1);
} else {
  process.stdout.write("Firebase smoke test passed. Client SDK is ready.\n");
  process.stdout.write("Next: run the emulators (`firebase emulators:start`) and wire a sync pass.\n");
}
