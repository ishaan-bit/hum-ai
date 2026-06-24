import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const appDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(appDir, "../..");
const pkg = (name: string) => resolve(repoRoot, "packages", name, "src/index.ts");

/**
 * Vite config for the Hum AI web client.
 *
 * The whole read spine is bundled FROM SOURCE: the `@hum-ai/*` workspaces ship raw
 * TypeScript (no build step), so we alias each to its `src/index.ts` and let
 * Vite/esbuild transpile. Only the browser-safe packages are aliased here.
 *
 * `@hum-ai/signal-lab` is an OFFLINE library whose barrel pulls in `node:fs`/`zlib`.
 * We deliberately DO NOT alias the barrel — the client reaches only its two PURE
 * modules (`model`, `expert`) via deep aliases, so no Node builtin enters the bundle.
 *
 * Firebase public web-client config is read from repo-root `.env` (envPrefix HUM_AI_);
 * these are public identifiers, safe to embed in the static bundle.
 */
export default defineConfig({
  root: appDir,
  envDir: repoRoot,
  envPrefix: ["VITE_", "HUM_AI_"],
  resolve: {
    alias: [
      // Pure, browser-safe spine packages.
      { find: "@hum-ai/shared-types", replacement: pkg("shared-types") },
      { find: "@hum-ai/audio-features", replacement: pkg("audio-features") },
      { find: "@hum-ai/affect-model-contracts", replacement: pkg("affect-model-contracts") },
      // clinical-corpus: the sanctioned clinical channel's store helpers — pure TS (depends
      // only on affect-model-contracts + shared-types), browser-safe. NOT the screening model.
      { find: "@hum-ai/clinical-corpus", replacement: pkg("clinical-corpus") },
      { find: "@hum-ai/quality-gate", replacement: pkg("quality-gate") },
      { find: "@hum-ai/domain-classifier", replacement: pkg("domain-classifier") },
      { find: "@hum-ai/expert-ser", replacement: pkg("expert-ser") },
      { find: "@hum-ai/fusion-engine", replacement: pkg("fusion-engine") },
      { find: "@hum-ai/personalization-engine", replacement: pkg("personalization-engine") },
      { find: "@hum-ai/relapse-engine", replacement: pkg("relapse-engine") },
      { find: "@hum-ai/intervention-engine", replacement: pkg("intervention-engine") },
      { find: "@hum-ai/safety-language", replacement: pkg("safety-language") },
      { find: "@hum-ai/orchestrator", replacement: pkg("orchestrator") },
      // native-corpus: the HiTL retraining loop — pure TS (reaches signal-lab ONLY via its
      // pure deep modules below), so no Node builtin enters the bundle.
      { find: "@hum-ai/native-corpus", replacement: pkg("native-corpus") },
      // population-corpus: the cross-user baseline tier (ADR-0012) — pure TS (reaches signal-lab
      // only transitively via native-corpus' pure deep modules), so no Node builtin enters the bundle.
      { find: "@hum-ai/population-corpus", replacement: pkg("population-corpus") },
      // signal-lab: ONLY the pure modules, never the (Node-tainted) barrel.
      { find: "@hum-ai/signal-lab/model", replacement: resolve(repoRoot, "packages/signal-lab/src/model.ts") },
      { find: "@hum-ai/signal-lab/expert", replacement: resolve(repoRoot, "packages/signal-lab/src/expert.ts") },
      { find: "@hum-ai/signal-lab/axis-prior", replacement: resolve(repoRoot, "packages/signal-lab/src/axis-prior.ts") },
      { find: "@hum-ai/signal-lab/feature-schema", replacement: resolve(repoRoot, "packages/signal-lab/src/feature-schema.ts") },
      // Stage ① capture-acceptance gate: a PURE module (imports only the AcousticFeatures
      // type), so it is browser-safe via the same deep-alias pattern as the prior modules.
      { find: "@hum-ai/signal-lab/capture-gate", replacement: resolve(repoRoot, "packages/signal-lab/src/capture-gate.ts") },
    ],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
});
