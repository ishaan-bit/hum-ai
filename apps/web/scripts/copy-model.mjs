// Prebuild step: stage the trained affect-prior artifacts as static assets for the
// browser client, WITHOUT ever committing them to git.
//
// The model lives under the git-ignored data/processed/signal-lab/. We copy the two
// small, derived JSON artifacts (the 6-class logreg prior + its honest promotion
// manifest) into apps/web/public/models/ (also git-ignored) so the SPA can `fetch`
// them and run the real pretrained prior. No raw audio, no datasets, no weights with
// a forbidden extension — these are derived public-data priors (.json), and the copy
// is resilient: if the artifacts are absent (e.g. a clean CI checkout), the client
// degrades to the honest heuristic fallback. Nothing here is required to build.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appDir, "../..");
const srcDir = resolve(repoRoot, "data/processed/signal-lab");
const outDir = resolve(appDir, "public/models");

// model.json            — 6-class affect prior (below gate; secondary affect-label hint)
// model.arousal_binary.json / model.valence_binary.json — the COARSE AXIS priors the
//   runtime leads with from the first hum (arousal cleared the 80% gate; valence is a
//   developing, below-gate prior). model_manifest.json carries the honest accuracy/gate.
const ARTIFACTS = [
  "model.json",
  "model_manifest.json",
  "model.arousal_binary.json",
  "model.valence_binary.json",
];

mkdirSync(outDir, { recursive: true });

let staged = 0;
for (const name of ARTIFACTS) {
  const from = resolve(srcDir, name);
  if (existsSync(from)) {
    copyFileSync(from, resolve(outDir, name));
    staged += 1;
  }
}

if (staged === ARTIFACTS.length) {
  console.log(`[copy-model] staged ${staged} artifact(s) → apps/web/public/models/ (trained prior available)`);
} else {
  console.log(
    `[copy-model] ${staged}/${ARTIFACTS.length} artifact(s) found under data/processed/signal-lab/ — ` +
      "client will use the honest heuristic fallback for any missing piece.",
  );
}
