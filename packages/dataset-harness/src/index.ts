/**
 * @hum-ai/dataset-harness — local-only ingestion scaffold for public voice
 * datasets. Resolves an EXTERNAL data dir, parses RAVDESS filenames, builds
 * manifests into a git-ignored output dir, and validates dataset folders.
 * No audio, no manifests, no datasets are ever written into the repo.
 */
export * from "./paths";
export * from "./ravdess";
export * from "./manifest";
export * from "./validate";
export { runCli, type CliResult } from "./cli";
