# Research datasets — local-only harness

Hum AI uses public voice/emotion datasets ONLY to solve cold-start as priors
(see `@hum-ai/dataset-registry` and ADR-0005). This document explains how to
work with those datasets **locally**, without ever committing a single byte of
audio, label, or generated manifest to git.

## Privacy posture (read first)

- **No data is ever committed.** Raw audio, labels, and any generated manifests
  live OUTSIDE the repo. The `.gitignore` and the CI `privacy-check` workflow
  enforce this; the harness itself refuses to write a manifest into the repo tree
  (`assertOutsideRepo` / `UnsafeManifestPathError`).
- Datasets are downloaded by you, locally, under the licenses of their
  publishers. Nothing here fetches data.
- This is research metadata only. Emotion labels are the datasets' own
  categorical annotations — they are not Hum AI inferences about any person and
  carry no diagnosis.

## Where to put datasets

The harness resolves a single external **data directory**:

1. If `HUM_DATA_DIR` is set, that path is used (absolute, or relative to your
   current working directory).
2. Otherwise it defaults to **`../hum-ai-data`** — a sibling of the repo root.

Place each dataset in its own subfolder:

```
../hum-ai-data/            (or $HUM_DATA_DIR)
├── ravdess/               <- wired this pass
├── crema-d/               <- scaffolded (scans, no parser yet)
├── tess/                  <- scaffolded
├── savee/                 <- scaffolded
├── emodb/                 <- scaffolded
└── .manifests/            <- generated manifests land here (git-ignored)
```

Set the override in your local `.env` (copy from `.env.example`; `.env` is
git-ignored):

```
HUM_DATA_DIR=../hum-ai-data
```

## Datasets

| Dataset  | Folder     | Status this pass                                  |
| -------- | ---------- | ------------------------------------------------- |
| RAVDESS  | `ravdess`  | Filename parser + manifest wired                  |
| CREMA-D  | `crema-d`  | Scaffolded — scans audio, emotion left `unknown`  |
| TESS     | `tess`     | Scaffolded                                        |
| SAVEE    | `savee`    | Scaffolded                                        |
| EmoDB    | `emodb`    | Scaffolded                                        |

### RAVDESS filename convention

RAVDESS audio files are named with seven two-digit fields:

```
modality-vocalChannel-emotion-intensity-statement-repetition-actor.wav
e.g. 03-01-06-01-02-01-12.wav
```

- modality: `01` full-AV, `02` video-only, `03` audio-only
- vocalChannel: `01` speech, `02` song
- emotion: `01` neutral, `02` calm, `03` happy, `04` sad, `05` angry,
  `06` fearful, `07` disgust, `08` surprised
- intensity: `01` normal, `02` strong
- statement / repetition: `01` or `02`
- actor: `01`–`24` (odd = male, even = female)

## Running the harness

From the repo root, after `npm ci`:

```bash
# Validate a dataset folder and report counts by emotion (default: ravdess).
npm run data:validate            # ravdess
npm run data:validate crema-d

# Build a manifest into <dataDir>/.manifests/<dataset>.manifest.json.
npm run data:manifest            # ravdess
npm run data:manifest savee
```

Or invoke the CLI directly:

```bash
node --import tsx packages/dataset-harness/src/cli.ts validate ravdess
node --import tsx packages/dataset-harness/src/cli.ts manifest ravdess
```

Both commands are safe on a fresh machine: a missing dataset prints a clear
message and exits 0 (no error, nothing written).

## What gets generated, and where

`data:manifest` writes a JSON manifest to **`<dataDir>/.manifests/`**, e.g.
`../hum-ai-data/.manifests/ravdess.manifest.json`. Each manifest is an array of
typed entries:

```json
{
  "datasetId": "ravdess",
  "entries": [
    { "datasetId": "ravdess", "relPath": "...", "emotion": "happy", "actor": 2, "gender": "female" }
  ]
}
```

This output dir is OUTSIDE the repo and is also belt-and-suspenders git-ignored
(`**/.manifests/`, `*.manifest.json`) in case you ever point `HUM_DATA_DIR` at an
in-repo path — in which case the harness will refuse to write at all.

## Public API

`@hum-ai/dataset-harness` exports:

- `parseRavdessFilename` / `parseRavdessOrNull` — pure RAVDESS filename parsing.
- `buildManifest` / `writeManifest` / `buildAndWriteManifest` — scan + manifest.
- `validateDataset` / `formatValidationReport` — counts + graceful status.
- `resolveDataDir`, `manifestOutputDir`, `assertOutsideRepo`, etc. — path helpers.
- `runCli` — the CLI dispatch (also runnable as a script).
