# Plan — Hum AI Foundation Pass

**Controller:** Plan → Build → Validate
**Date:** 2026-06-18
**Status:** EXECUTING

---

## 1. Current Repo State

### What Exists

| Item | Status |
|---|---|
| Root `package.json` | ⚠️ NAMING DRIFT — name is `"hum"` not `"hum-ai"` |
| Package scope | ⚠️ NAMING DRIFT — scope is `@hum` not `@hum-ai` |
| `tsconfig.json` | ⚠️ NAMING DRIFT — paths use `@hum-ai/` prefix |
| `packages/shared-types` | ✅ Exists, types well-defined |
| `packages/dataset-registry` | ✅ Exists, domain rules enforced |
| `packages/affect-model-contracts` | ✅ Exists, multi-head inference contract |
| `packages/fusion-engine` | ✅ Exists, late fusion + calibrated confidence |
| `packages/personalization-engine` | ✅ Exists, ladder + stage policy |
| `packages/relapse-engine` | ✅ Exists, paired-sample DVDSA comparison |
| `packages/safety-language` | ✅ Exists, forbidden-phrase enforcement |
| `packages/quality-gate` | ✅ Exists, gate thresholds from hum_spec |
| `packages/domain-classifier` | ✅ Exists, HeuristicDomainClassifier + HumDomainAdapter |
| `packages/audio-features` | ✅ Exists, feature contracts + NotImplementedExtractor |
| `packages/expert-fer` | ✅ Exists, FaceEmotionExpert stub |
| `packages/expert-ser` | ✅ Exists, 6 sub-expert stubs |
| `packages/expert-ter` | ✅ Exists, TextEmotionExpert stub |
| `packages/intervention-engine` | ✅ Exists, V-A → recommendation mapping |
| `apps/web`, `apps/mobile`, `apps/ops` | ✅ Placeholder READMEs present |
| `docs/source/INDEX.md` | ✅ Authoritative source manifest |
| `.extract/` text cache | ✅ All 7 sources extracted |
| `parallel-agent-review/` | ✅ Prior review artifacts (not main repo docs) |
| `parallel-research-pass/` | ✅ Prior research artifacts |
| `research/` | ✅ Model cards, dataset/evaluation stubs |
| Tests | ✅ 83 tests, all passing |
| TypeScript | ✅ Compiles clean (noEmit) |
| `README.md` | ❌ MISSING — no root README |

### What is Missing

| Missing Item | Severity | Why Required |
|---|---|---|
| Root `README.md` | HIGH | Entry point for every developer/reviewer |
| `docs/adr/0000-product-naming.md` | HIGH | Required by brief; naming ADR must exist |
| `docs/adr/0001-trisense-adapted-architecture.md` | HIGH | Architecture spine ADR |
| `docs/adr/0002-domain-aware-audio-modeling.md` | HIGH | Domain-gap ADR referenced in code comments |
| `docs/adr/0003-personalization-relapse.md` | HIGH | Personalization/relapse ADR |
| `docs/adr/0004-confidence-abstention.md` | HIGH | Confidence/abstention ADR |
| `docs/adr/0005-public-datasets-as-priors.md` | HIGH | Dataset governance ADR referenced in code |
| `docs/architecture/TRISENSE_ADAPTED_ARCHITECTURE.md` | HIGH | Required per acceptance criteria |
| `docs/architecture/HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md` | HIGH | Required per acceptance criteria |
| `docs/architecture/PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md` | HIGH | Required per acceptance criteria |
| `docs/claims/CLAIMS_LADDER.md` | HIGH | Forbidden/allowed claims enumerated |
| `docs/validation/VALIDATION_PLAN.md` | HIGH | Required per acceptance criteria |
| `docs/privacy/DATA_GOVERNANCE.md` | HIGH | Referenced in apps/web README |
| Naming consistency test | MEDIUM | Catch future naming drift |

### What is Weak

| Item | Issue |
|---|---|
| `@hum-ai/audio-features` has `NotImplementedExtractor` | Intentional stub — NOT weak; correctly refuses to fabricate |
| Expert stubs return heuristic distributions | Intentional — ML models not yet trained |
| HeuristicDomainClassifier is rule-based | Intentional — trained classifier slots in behind same interface |
| No end-to-end pipeline wiring | Expected — apps are stubs this pass |

### What is Overbuilt

Nothing is overbuilt. All packages align with the required system concepts.

### What Violates the Brief

| Violation | File | Fix |
|---|---|---|
| Product name in pkg.json is `"hum"` | `package.json` | Rename to `"hum-ai"` |
| Package scope is `@hum` not `@hum-ai` | All `package.json`, `tsconfig.json`, `.ts` imports | Global rename `@hum-ai/` → `@hum-ai/` |
| No product naming ADR | — | Create `docs/adr/0000-product-naming.md` |
| No README.md | — | Create root README |

---

## 2. Product Naming Consistency Status

| Check | Current | Required | Status |
|---|---|---|---|
| Root pkg name | `"hum"` | `"hum-ai"` | ❌ FAIL |
| Root pkg description | `"Hum —"` | `"Hum AI —"` | ❌ FAIL |
| Package scope | `@hum-ai/` | `@hum-ai/` | ❌ FAIL |
| tsconfig paths | `@hum-ai/` | `@hum-ai/` | ❌ FAIL |
| TypeScript imports | `"@hum-ai/..."` | `"@hum-ai/..."` | ❌ FAIL |
| Naming ADR | absent | `docs/adr/0000-product-naming.md` | ❌ FAIL |
| README title | absent | "# Hum AI" | ❌ FAIL |
| Product name in source docs | uses "Hum" | "Hum AI" in user-facing | ✅ OK (source docs cite legacy spec) |

---

## 3. Exact Build Plan

### Naming Patches

1. Patch `package.json` root: name `"hum"` → `"hum-ai"`, update description.
2. Patch all `packages/*/package.json`: `"@hum-ai/` → `"@hum-ai/`.
3. Patch all `apps/*/package.json`: `"@hum-ai/` → `"@hum-ai/`.
4. Patch `tsconfig.json`: all path entries `"@hum-ai/` → `"@hum-ai/`.
5. Patch all `.ts` files (38 files): `from "@hum-ai/` → `from "@hum-ai/`.
6. Run `npm install` to regenerate `package-lock.json`.

### New Files

7. Create `README.md` — root repo README, product name "Hum AI".
8. Create `docs/adr/0000-product-naming.md` — naming ADR.
9. Create `docs/adr/0001-trisense-adapted-architecture.md`.
10. Create `docs/adr/0002-domain-aware-audio-modeling.md`.
11. Create `docs/adr/0003-personalization-relapse.md`.
12. Create `docs/adr/0004-confidence-abstention.md`.
13. Create `docs/adr/0005-public-datasets-as-priors.md`.
14. Create `docs/architecture/TRISENSE_ADAPTED_ARCHITECTURE.md`.
15. Create `docs/architecture/HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md`.
16. Create `docs/architecture/PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md`.
17. Create `docs/claims/CLAIMS_LADDER.md`.
18. Create `docs/validation/VALIDATION_PLAN.md`.
19. Create `docs/privacy/DATA_GOVERNANCE.md`.

### Naming Tests

20. Create `packages/naming-check/` — lightweight package with a naming consistency test
    (reads package.json files, checks for `hum-ai` slug, `@hum-ai` scope, README title).

---

## 4. Validation Plan

### Commands

```
npm run typecheck   # tsc --noEmit
npm test            # node --import tsx --test packages/**/test/**/*.test.ts
```

### Test Coverage Required (13 scenarios from brief)

| # | Scenario | Package | Status Before |
|---|---|---|---|
| 1 | Dataset domain rules | dataset-registry | ✅ tests 11-17 |
| 2 | Domain-gap penalty behavior | domain-classifier | ✅ test 20 |
| 3 | First-hum confidence cap | personalization-engine | ✅ test (stage policy) |
| 4 | Poor-capture confidence cap | quality-gate | ✅ test (gate) |
| 5 | Raw-audio privacy blocking | shared-types | ✅ tests 77-82 |
| 6 | Safety-language forbidden phrase | safety-language | ✅ tests 66-73 |
| 7 | Personalization stage policy | personalization-engine | ✅ tests |
| 8 | Relapse output contract | relapse-engine | ✅ tests |
| 9 | Fusion missing-modality handling | fusion-engine | ✅ test 34 |
| 10 | Music dataset prohibited-use rule | dataset-registry | ✅ test 12 |
| 11 | Clinical speech not direct hum truth | dataset-registry | ✅ test 13 |
| 12 | Abstention when confidence weak | fusion-engine | ✅ |
| 13 | Product naming consistency | naming-check | ❌ MISSING |

---

## 5. Domain Rules Reference

All domains, gaps, and forbidden uses are encoded in:
- `packages/shared-types/src/domain.ts` (AUDIO_DOMAINS, DOMAIN_GAP_PENALTY)
- `packages/dataset-registry/src/rules.ts` (DOMAIN_FORBIDDEN_USES)

Public datasets are **priors only** — see ADR-0005.

---

## 6. Confidence Rules Reference

All caps encoded in `packages/personalization-engine/src/ladder.ts`:
- First hum: 0.72 cap
- Pre-baseline (hums 2-4): 0.76 cap
- Personal baseline (hums 5-9): 0.82 cap
- Personalized fusion (hums 10-19): 0.88 cap
- Mature/relapse (hums 20+): 0.92 cap

Poor capture caps in `packages/quality-gate/src/thresholds.ts`.
Abstention logic in `packages/fusion-engine/src/confidence.ts`.
