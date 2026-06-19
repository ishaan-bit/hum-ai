import { listTrackedFiles } from "./git";
import type { GateResult, GateViolation } from "./types";

/**
 * GATE: no tracked forbidden files (Node port of `.github/workflows/privacy-check.yml`).
 *
 * This is a 1:1 port of the bash `git ls-files | grep -iE ...` privacy scan into
 * pure Node + JS regex so it runs locally and on Windows CI (the YAML is bash /
 * ubuntu-only). The regexes are deliberately the SAME carefully-anchored ERE
 * patterns as the YAML, applied case-insensitively (the `i` flag here mirrors the
 * YAML's `grep -iE`) so an uppercase extension like `.PEM`/`.ONNX` cannot bypass
 * the scan, while staying false-positive-free: e.g. `gadget.json`
 * must NOT trip the PHQ/GAD rule, `serviceAccountHelper.ts` must NOT trip the
 * credential rule, `.env.example` is allowed, `datasets/README.md` is allowed.
 *
 * Each rule is exported as a structured entry so a test can prove the patterns
 * against synthetic path lists WITHOUT creating real forbidden files in the repo.
 */

export interface ForbiddenFileRule {
  /** Stable id used in violation output. */
  readonly id: string;
  /** Human label (matches the YAML "report" label). */
  readonly label: string;
  /** A path matches the rule when `test(path)` is true (all rules use the `i` flag). */
  readonly test: RegExp;
  /** ... UNLESS it also matches `allow` (the YAML `grep -v` exclusions). */
  readonly allow?: RegExp;
  /** Suggested remediation surfaced in the violation. */
  readonly fix: string;
}

/**
 * Forbidden-file rules. Patterns mirror privacy-check.yml exactly (same anchors,
 * same exclusions). JS regex uses `(^|/)` for path-boundary just like the ERE.
 */
export const FORBIDDEN_FILE_RULES: readonly ForbiddenFileRule[] = [
  {
    // YAML rule 1 + 8 (docs/source binaries are a subset of this extension set).
    id: "binary-or-weights-or-audio",
    label: "source docs / model weights / audio / archive binaries",
    test: /\.(pdf|docx|doc|pptx|wav|mp3|m4a|flac|ogg|aac|webm|opus|zip|tar|tgz|gz|ckpt|pt|pth|onnx|safetensors|h5|pb|tflite|gguf|bin)$/i,
    fix: "Keep binaries/audio/weights/dataset-archives out of git. Track a text pointer/checksum or a README in docs/source instead; store the artifact in private object storage.",
  },
  {
    // YAML rule 2: .env files (allow only .env.example).
    id: "dotenv-secret",
    label: ".env / dotenv secret files",
    test: /(^|\/)\.env($|\.)/i,
    allow: /(^|\/)\.env\.example$/i,
    fix: "Never commit real .env files. Commit only .env.example with placeholder values; load real secrets from the environment.",
  },
  {
    // YAML rule 3: service-account / cloud credential JSON, anchored to .json.
    id: "cloud-credential-json",
    label: "service-account / cloud credential files",
    test: /(serviceAccount|service-account|firebase-adminsdk|google-credentials)[^/]*\.json$|(^|\/)gcp-[^/]*\.json$/i,
    fix: "Do not commit credential JSON. Use workload identity / env-injected secrets; add the file to .gitignore.",
  },
  {
    // YAML rule 4: vercel local metadata.
    id: "vercel-local-metadata",
    label: "vercel local metadata (.vercel)",
    test: /(^|\/)\.vercel(\/|$)/i,
    fix: "Remove the .vercel directory from git (it holds local project linkage). It is auto-generated and should be .gitignore'd.",
  },
  {
    // YAML rule 5: private keys / tokens.
    id: "private-key-or-token",
    label: "private keys / tokens",
    test: /\.(pem|key|p12|pfx)$|(^|\/)[^/]*\.token$/i,
    fix: "Never commit private keys/tokens. Rotate the secret if it was committed, then store it in a secret manager / env var.",
  },
  {
    // YAML rule 6: dataset / raw-recording directories (allow READMEs).
    id: "dataset-or-recording-payload",
    label: "dataset / raw-recording payloads",
    test: /(^|\/)(datasets|recordings|raw_audio)\//i,
    allow: /\/README\.md$/i,
    fix: "Datasets/recordings must stay out of git (privacy + size). Keep only a README describing provenance; store data in private storage referenced by the dataset-registry.",
  },
  {
    // YAML rule 7: clinical-label / PHQ-GAD data files (case-insensitive).
    // Token at a name boundary, followed only by sep/digit or extension — so
    // `gadget.json` / `badge.csv` do NOT trip while `phq9.csv`, `gad-7.csv`,
    // `clinical_labels.parquet`, `phq.csv` do.
    id: "clinical-label-data",
    label: "clinical-label / PHQ-GAD data files",
    test: /(^|\/|[-_])(phq|gad|ces-dc|clinical[-_]labels?)([-_0-9][^/]*)?\.(csv|json|parquet|xlsx|tsv)$/i,
    fix: "Clinical-label data (PHQ/GAD/CES-DC/clinical_labels) is PHI and must never be tracked. Remove it and reference it via the private dataset-registry only.",
  },
];

/**
 * Pure matcher: given a list of (already tracked) paths, return the violations.
 * Exported so tests can pass synthetic path lists without touching the FS.
 */
export function scanForbiddenPaths(paths: readonly string[]): GateViolation[] {
  const violations: GateViolation[] = [];
  for (const path of paths) {
    for (const rule of FORBIDDEN_FILE_RULES) {
      if (!rule.test.test(path)) continue;
      if (rule.allow && rule.allow.test(path)) continue;
      violations.push({
        gate: `forbidden-files:${rule.id}`,
        where: path,
        token: path,
        detail: `tracked file matches forbidden class: ${rule.label}`,
        fix: rule.fix,
      });
    }
  }
  return violations;
}

/** GATE entry: scan the real tracked tree. */
export function forbiddenFilesGate(repoRoot: string): GateResult {
  const paths = listTrackedFiles(repoRoot);
  return {
    gate: "forbidden-files",
    description:
      "No tracked binaries/audio/weights/.env/credentials/.vercel/keys/datasets/clinical-label data (Node port of privacy-check.yml).",
    violations: scanForbiddenPaths(paths),
  };
}
