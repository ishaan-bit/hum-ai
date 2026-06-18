# Environment Variables — Hum AI

All Hum AI variables use the **`HUM_AI_`** prefix. The canonical template is
[`.env.example`](../../.env.example) (committed). A populated `.env` is **git-ignored
and must never be committed**. Configure deployment values in the **Vercel dashboard**,
not in the repo.

> **None of these are required to run `npm test` / `npm run typecheck`.** The foundation
> packages are pure TypeScript with no runtime configuration. These slots are for the
> app/ops surfaces as they come online.

## Variables

| Variable | Scope | Secret? | Default | Purpose |
| --- | --- | --- | --- | --- |
| `HUM_AI_ENV` | all | no | `development` | `development` \| `preview` \| `production` |
| `HUM_AI_ALLOW_DERIVED_FEATURE_SYNC` | app | no | `false` | Gate: sync derived features (needs user consent) |
| `HUM_AI_ALLOW_RESEARCH_AUDIO_UPLOAD` | app | no | `false` | Gate: raw-audio research upload (explicit opt-in) |
| `HUM_AI_ALLOW_CLINICAL_RISK_SURFACING` | app | no | `false` | Gate: surface clinical-risk markers (ADR-0006 consent) |
| `HUM_AI_FIREBASE_API_KEY` | app (client) | no¹ | — | Firebase public client key |
| `HUM_AI_FIREBASE_PROJECT_ID` | app (client) | no | — | Firebase project id |
| `HUM_AI_FIREBASE_APP_ID` | app (client) | no | — | Firebase app id |
| `HUM_AI_FIREBASE_SERVICE_ACCOUNT_PATH` | server/local | **YES** | — | Path to a LOCAL service-account JSON (never in repo) |
| `HUM_AI_MODEL_VERSION` | all | no | `foundation-0.0.0` | Model version tag |
| `HUM_AI_MODEL_WEIGHTS_PATH` | server/local | **YES²** | — | Path to LOCAL model weights (never committed) |

¹ Firebase client keys are public identifiers, not secrets, but still belong in env
config, not source. ² The path is not secret; the **weights it points to** must never
enter the repo.

## Privacy posture defaults

The three `HUM_AI_ALLOW_*` gates default to **`false`** — local-first. Raw audio never
leaves the device by default; flipping any gate requires real, scoped user consent wired
through the consent UI (see [ADR-0006](../adr/0006-two-head-affect-and-clinical-risk-separation.md)
and [DATA_GOVERNANCE](../privacy/DATA_GOVERNANCE.md)). Do not enable these globally via
env for convenience.

## Secrets — never in the repo

- `HUM_AI_FIREBASE_SERVICE_ACCOUNT_PATH` must point to a file **outside** the repo
  (e.g. `~/.secrets/hum-ai-sa.json`). The JSON itself is git-ignored by pattern.
- Vercel tokens, CI tokens, and any private key live in the platform's secret store
  (Vercel project env / GitHub Actions secrets), never in files.

## Setting them

- **Local:** copy `.env.example` → `.env`, fill in, keep it untracked.
- **Vercel:** Project → Settings → Environment Variables. Set per-environment
  (Development / Preview / Production). Mark service-account-style values as sensitive.
- **GitHub Actions:** repo → Settings → Secrets and variables → Actions. CI for the
  foundation needs **none** of these (it only typechecks/tests).
