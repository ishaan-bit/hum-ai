import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listTrackedFiles } from "./git";
import type { GateResult, GateViolation } from "./types";

/**
 * GATE: the screening head stays out of the consumer read/render path (ADR-0006
 * firewall — Workstream 3 / VALIDATION_PLAN §3e).
 *
 * `@hum-ai/screening-model` is a STUDY ARTIFACT: a third head (cross-sectional
 * PHQ-9/GAD-7 screening), structurally separate from the broad-affect head and the
 * consumer risk-marker head. During the pilot the screening probability is
 * internal-only and BLINDED — it must never reach `render.ts`, the orchestrator, or
 * the safety-language render path. This is the import-graph analogue of the runtime
 * `assertNoClinicalLeak` gate (`clinical-leak.ts`): a compile/lint firewall that
 * trips during `npm run qa` if a developer wires the screening head into the
 * consumer surface before the validated-claim path is unlocked.
 *
 * What is forbidden in the consumer paths:
 *  - any import of `@hum-ai/screening-model` (exact or subpath), and
 *  - any import of the `@hum-ai/signal-lab/evaluate-binary` SUBPATH — the binary
 *    screening evaluator that the screening head is built on. The broad
 *    `@hum-ai/signal-lab` barrel is NOT forbidden (the consumer legitimately uses
 *    `/capture-gate`, `/model`, `/expert`, `/axis-prior`); only the screening-
 *    specific `evaluate-binary` egress is.
 *
 * Consumer paths scanned (the read/render side that must stay blinded):
 *  - everything under `apps/web/src/`,
 *  - `packages/orchestrator/src/`,
 *  - `packages/safety-language/src/`.
 *
 * The screening package's OWN sources/tests and the validation packages it depends
 * on (`signal-lab`, `clinical-corpus`) are out of scope by construction — they are
 * the sanctioned study side of the firewall, not the consumer side.
 */

/** Import specifiers that must never appear in a consumer read/render path. */
export const FORBIDDEN_SCREENING_SPECIFIERS: readonly string[] = [
  "@hum-ai/screening-model",
  "@hum-ai/signal-lab/evaluate-binary",
];

/** Repo-relative path prefixes that make up the consumer read/render path. */
export const CONSUMER_READ_PATHS: readonly string[] = [
  "apps/web/src/",
  "packages/orchestrator/src/",
  "packages/safety-language/src/",
];

const SCREENING_FIX =
  "The screening head is a study artifact and stays BLINDED during the pilot (ADR-0006). " +
  "Do not import @hum-ai/screening-model or @hum-ai/signal-lab/evaluate-binary into the consumer " +
  "read/render path; it surfaces only via post-validation labels (phq_screening_signal/" +
  "gad_screening_signal) once validatedRegulatoryMode is scoped to the validated claim.";

/**
 * True if an import specifier is a forbidden screening egress. Matches the exact
 * specifier OR a deeper subpath of `@hum-ai/screening-model` (e.g.
 * `@hum-ai/screening-model/foo`), but NOT the broad `@hum-ai/signal-lab` barrel.
 */
export function isForbiddenScreeningSpecifier(spec: string): boolean {
  for (const forbidden of FORBIDDEN_SCREENING_SPECIFIERS) {
    if (spec === forbidden) return true;
    // A subpath import of the screening package is equally forbidden.
    if (forbidden === "@hum-ai/screening-model" && spec.startsWith(forbidden + "/")) {
      return true;
    }
  }
  return false;
}

/** True if a repo-relative .ts path is part of the consumer read/render path. */
export function isConsumerReadPath(rel: string): boolean {
  if (!rel.endsWith(".ts")) return false;
  return CONSUMER_READ_PATHS.some((prefix) => rel.startsWith(prefix));
}

// import ... from "<spec>"  |  require("<spec>")  |  import("<spec>")  |  export ... from "<spec>"
const IMPORT_RE = /\b(?:from|import|require|export)\s*\(?\s*["']([^"']+)["']/g;

/**
 * Pure matcher: given a file's source text and its repo-relative path, return any
 * forbidden screening imports. Exported so tests can pass synthetic source without
 * touching the FS.
 */
export function scanSourceForScreeningImports(content: string, where: string): GateViolation[] {
  const violations: GateViolation[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const spec = m[1];
    if (spec && isForbiddenScreeningSpecifier(spec)) {
      violations.push({
        gate: "no-screening-in-read-path",
        where,
        token: `import "${spec}"`,
        detail: `consumer read/render path imports the screening head "${spec}" — it must stay blinded (study artifact, ADR-0006)`,
        fix: SCREENING_FIX,
      });
    }
  }
  return violations;
}

/**
 * GATE entry: scan every tracked .ts file under the consumer read/render paths for
 * an import of the screening head or its binary-screening evaluator subpath.
 */
export function screeningIsolationGate(repoRoot: string): GateResult {
  const tracked = listTrackedFiles(repoRoot);
  const consumerSources = tracked.filter(isConsumerReadPath);
  const violations: GateViolation[] = [];
  for (const rel of consumerSources) {
    let content: string;
    try {
      content = readFileSync(join(repoRoot, rel), "utf8");
    } catch {
      continue;
    }
    violations.push(...scanSourceForScreeningImports(content, rel));
  }
  return {
    gate: "no-screening-in-read-path",
    description:
      "The screening head (@hum-ai/screening-model / signal-lab evaluate-binary) is never imported into the consumer read/render path (apps/web/src, orchestrator, safety-language) — it stays blinded during the pilot (ADR-0006).",
    violations,
  };
}
