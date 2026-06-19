# Contributing to Hum AI

Thanks for your interest in Hum AI. This is a **non-clinical, research-stage**,
local-first voice-biomarker platform. Because it handles sensitive signals, a few
rules here are not style preferences — they are safety and privacy invariants.

## Ground rules (non-negotiable)

1. **Never commit private materials.** No source PDFs/docx, datasets, raw audio,
   recordings, model weights, clinical labels (PHQ/GAD/CES-DC), `.env` files,
   Firebase service-account JSON, or Vercel tokens. The repo may be public. See
   [docs/privacy/PUBLIC_REPO_PRIVACY_CHECKLIST.md](docs/privacy/PUBLIC_REPO_PRIVACY_CHECKLIST.md)
   and run the privacy scan before every push.
2. **No diagnosis, ever.** Hum produces reflective signals and risk *markers*.
   User-facing copy must pass `@hum-ai/safety-language` (`validateUserFacingText`).
   No new claim may exceed its tier in [docs/claims/CLAIMS_LADDER.md](docs/claims/CLAIMS_LADDER.md).
3. **Voice-first.** No camera packages, no visual feature extraction, no FER model
   this phase (ADR-0009). The FER seam is an architecture placeholder only.
4. **Naming is locked.** Product **Hum AI**, slug **hum-ai**, scope **@hum-ai**,
   env prefix **HUM_AI**. Never introduce `HumAI`, `Hum-AI`, `Hum v2`, or `@hum`.
   "legacy Hum" refers only to the older technical spec. `@hum-ai/naming-check`
   enforces this.
5. **Sources are priors, not truth.** Public-dataset / clinical-study numbers are
   priors and references, never presented as Hum's accuracy (ADR-0005).

## Naming reference

| Thing | Value |
| --- | --- |
| Product display name | Hum AI |
| Repo / project slug | hum-ai |
| Package scope | @hum-ai |
| Environment prefix | HUM_AI |

## Development

Requires **Node ≥ 22.6** (built-in test runner via `tsx`). No third-party test framework.

```bash
npm install        # workspaces, dev-deps only (tsx, typescript, @types/node)
npm run qa:all     # typecheck + tests + safety/privacy gates (run before every PR)
npm run check      # typecheck + tests only
npm test           # node --import tsx --test "packages/**/test/**/*.test.ts"
npm run typecheck  # tsc --noEmit -p tsconfig.json
npm run qa         # clinical-leak / camera-deps / confidence-copy / forbidden-files gates
```

- TypeScript, ESM, strict mode (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- One concern per package under `packages/*`; all packages are `@hum-ai/*`.
- Tests live in `packages/<pkg>/test/*.test.ts` using `node:test` + `node:assert`.

## Making a change

1. Branch from `main` (`feat/…`, `fix/…`, `docs/…`, `chore/…`).
2. Keep packages single-purpose; respect the dependency direction (engines depend on
   contracts, never the reverse).
3. Add or update tests. **Do not weaken or skip tests to make a build pass.**
4. For an architectural decision, add an ADR under `docs/adr/` (next number, follow
   the existing format and cite sources by their `id`).
5. Run `npm run qa:all` (typecheck + tests + the clinical-leak / camera-deps /
   confidence-copy / forbidden-files gates CI enforces). Run the privacy scan if you
   touched ignore rules, configs, or anything near `docs/source/`.
6. Open a PR. CI (`ci.yml` + `privacy-check.yml`) must be green.

## Commit messages

Conventional-commit style: `type: summary` (`feat`, `fix`, `docs`, `chore`,
`refactor`, `test`). Keep them imperative and scoped.

## Reporting security/privacy issues

See [SECURITY.md](SECURITY.md). **Do not** file public issues for vulnerabilities.
