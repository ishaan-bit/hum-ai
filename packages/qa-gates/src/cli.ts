import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runAllGates, totalViolations } from "./index";
import { formatViolation } from "./types";

/**
 * QA-gates CLI. Runs every gate against the repo root and exits non-zero on any
 * violation, with actionable per-failure output. Wired as the root `qa` script.
 *
 * Repo root resolution prefers `git rev-parse --show-toplevel` (works from any
 * cwd, and respects worktrees), falling back to walking up from this file.
 */
function resolveRepoRoot(): string {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    if (top) return top;
  } catch {
    // not a git checkout context — fall through
  }
  // Fallback: packages/qa-gates/src/cli.ts -> repo root is three levels up.
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../");
}

function main(): number {
  const repoRoot = resolveRepoRoot();
  const results = runAllGates(repoRoot);
  const total = totalViolations(results);

  // eslint-disable-next-line no-console
  const log = (line = "") => process.stdout.write(line + "\n");

  log("Hum AI — QA gates");
  log(`repo: ${repoRoot}`);
  log("-----------------------------------------------");

  for (const r of results) {
    if (r.violations.length === 0) {
      log(`ok  ${r.gate} — ${r.description}`);
    } else {
      log(`FAIL ${r.gate} (${r.violations.length}) — ${r.description}`);
      for (const v of r.violations) log(formatViolation(v));
    }
  }

  log("-----------------------------------------------");
  if (total > 0) {
    log(`QA gates FAILED: ${total} violation(s). See blocks above.`);
    return 1;
  }
  log("QA gates passed: no violations.");
  return 0;
}

process.exit(main());
