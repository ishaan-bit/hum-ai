import { execFileSync } from "node:child_process";

/**
 * Cross-platform tracked-file listing.
 *
 * We shell out to `git ls-files` via `execFileSync` (NOT a bash pipeline) so the
 * gates run identically on Windows and Linux CI. Only TRACKED files are scanned:
 * git-ignored files (node_modules, build output, local secrets) cannot leak into
 * the repo, so they are out of scope by construction — mirroring privacy-check.yml.
 *
 * `git ls-files -z` emits NUL-separated paths, which is robust to spaces/newlines
 * in filenames; we split on NUL and drop the trailing empty entry.
 */
export function listTrackedFiles(repoRoot: string): string[] {
  const out = execFileSync("git", ["-C", repoRoot, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter((p) => p.length > 0);
}
