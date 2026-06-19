import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { resolveDataDir, manifestOutputDir, RAW_DATASET_DIRS, type RawDatasetDir } from "./paths";
import { buildAndWriteManifest, countByEmotion } from "./manifest";
import { validateDataset, formatValidationReport } from "./validate";
import { RAVDESS_DATASET_ID } from "./ravdess";

/**
 * Tiny CLI dispatch for the dataset harness.
 *
 *   node --import tsx packages/dataset-harness/src/cli.ts manifest [dataset]
 *   node --import tsx packages/dataset-harness/src/cli.ts validate [dataset]
 *
 * Default dataset is RAVDESS. Missing datasets are handled gracefully with a
 * clear message and a non-error exit, so this is safe to run on a fresh machine.
 */

const USAGE = [
  "Hum AI dataset harness",
  "",
  "Usage:",
  "  data:manifest [dataset]   Build a manifest for a dataset (default: ravdess)",
  "  data:validate [dataset]   Validate a dataset folder and report counts",
  "",
  `Known datasets: ${RAW_DATASET_DIRS.join(", ")}`,
  "",
  "Data lives OUTSIDE the repo. Set HUM_DATA_DIR or use ../hum-ai-data.",
].join("\n");

function isKnownDataset(value: string): value is RawDatasetDir {
  return (RAW_DATASET_DIRS as readonly string[]).includes(value);
}

function resolveDatasetArg(arg: string | undefined): RawDatasetDir | null {
  if (arg === undefined) return RAVDESS_DATASET_ID;
  if (isKnownDataset(arg)) return arg;
  return null;
}

export interface CliResult {
  readonly exitCode: number;
  readonly output: string;
}

/** Run the CLI logic purely; returns output + intended exit code. */
export function runCli(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): CliResult {
  const [command, datasetArg] = argv;
  const lines: string[] = [];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    return { exitCode: command ? 0 : 1, output: USAGE };
  }

  if (command !== "manifest" && command !== "validate") {
    return { exitCode: 1, output: `Unknown command: ${command}\n\n${USAGE}` };
  }

  const dataset = resolveDatasetArg(datasetArg);
  if (dataset === null) {
    return {
      exitCode: 1,
      output: `Unknown dataset: ${datasetArg}\nKnown datasets: ${RAW_DATASET_DIRS.join(", ")}`,
    };
  }

  lines.push(`data dir: ${resolveDataDir(env)}`);

  if (command === "validate") {
    const report = validateDataset(dataset, env);
    lines.push(formatValidationReport(report));
    // Missing/empty is a graceful, non-error outcome.
    return { exitCode: 0, output: lines.join("\n") };
  }

  // command === "manifest"
  const report = validateDataset(dataset, env);
  if (!report.present) {
    lines.push(report.message);
    lines.push("No manifest written (dataset not present).");
    return { exitCode: 0, output: lines.join("\n") };
  }

  const { manifest, write } = buildAndWriteManifest(dataset, env);
  lines.push(
    `manifest for "${dataset}": scanned ${manifest.scanned}, parsed ${manifest.parsed}, skipped ${manifest.skipped}.`,
  );
  const counts = countByEmotion(manifest);
  const emotionLines = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `    ${k}: ${v}`);
  if (emotionLines.length > 0) {
    lines.push("  by emotion label:");
    lines.push(...emotionLines);
  }
  lines.push(`output: ${write.outputPath} (${write.bytesWritten} bytes)`);
  lines.push(`output dir (git-ignored, external): ${manifestOutputDir(env)}`);
  return { exitCode: 0, output: lines.join("\n") };
}

/**
 * Detect whether this module is the entrypoint (works under tsx ESM). Compares
 * the RESOLVED absolute entry path to this module's own path — exactly, not by a
 * loose `endsWith("cli.ts")` (which falsely fired for any other package whose
 * entrypoint is also named `cli.ts`, e.g. `@hum-ai/signal-lab`, running this CLI
 * as an import side effect). The drive-letter case may differ on Windows, so a
 * case-insensitive fallback is included.
 */
function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const a = resolve(entry);
    const b = fileURLToPath(import.meta.url);
    return a === b || a.toLowerCase() === b.toLowerCase();
  } catch {
    return false;
  }
}

if (isMain()) {
  const result = runCli(process.argv.slice(2));
  process.stdout.write(result.output + "\n");
  process.exitCode = result.exitCode;
}
