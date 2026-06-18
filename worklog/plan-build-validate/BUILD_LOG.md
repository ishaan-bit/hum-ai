# Build Log — Hum AI Foundation Pass

**Date:** 2026-06-18
**Controller:** Plan → Build → Validate

---

## Naming Patches

### 1. Root package.json
- **File:** `package.json`
- **Change:** `"name": "hum"` → `"name": "hum-ai"`
- **Change:** Description updated to include "Hum AI"

### 2. Global @hum/ → @hum-ai/ scope rename
- **Files affected:** 59 files (38 .ts files + 18 package.json files + tsconfig.json + package-lock.json + 2 others)
- **Method:** PowerShell `Set-Content` global replace on `*.ts`, `*.json` (excluding node_modules)
- **Includes:** All packages/*/package.json, apps/*/package.json, tsconfig.json paths, all TypeScript imports

### 3. @hum/ → @hum-ai/ in all .md docs
- **Files affected:** 40 .md files
- **Method:** PowerShell global replace on `*.md`
- **Note:** One incidental self-reference in ADR-0000 "consequences" was repaired manually (the migration description itself)

### 4. README.md updates
- H1 changed from `# Hum — domain-aware...` to `# Hum AI — domain-aware...`
- Added naming rule callout box
- Updated "All packages are `@hum/*`" to `@hum-ai/*`

### 5. npm install
- Regenerated `package-lock.json` after scope rename
- `added 1 package, removed 17 packages, and audited 43 packages` (net: renamed workspace packages)

---

## New Files Created

### docs/adr/0000-product-naming.md
- NEW — Product naming ADR (required by brief)
- Establishes: Hum AI, hum-ai, @hum-ai, HUM_AI_

### docs/adr/ (existing ADRs verified and scope-patched)
- 0001-architecture-spine.md — TriSense adapted architecture
- 0002-domain-aware-audio-modeling.md — Domain-gap framework
- 0003-personalization-and-relapse-model.md — Personalization ladder + DVDSA
- 0004-confidence-and-abstention.md — Confidence caps + abstention
- 0005-public-datasets-as-priors-not-truth.md — Dataset governance

### docs/architecture/ (existing, scope-patched)
- TRISENSE_ADAPTED_ARCHITECTURE.md ✅
- HUM_DOMAIN_AWARE_AUDIO_ARCHITECTURE.md ✅
- PERSONALIZATION_AND_RELAPSE_ARCHITECTURE.md ✅

### docs/claims/CLAIMS_LADDER.md (existing, scope-patched) ✅
### docs/validation/VALIDATION_PLAN.md (existing, scope-patched) ✅
### docs/privacy/DATA_GOVERNANCE.md (existing, scope-patched) ✅

### packages/naming-check/ (NEW)
- `package.json` — `@hum-ai/naming-check`
- `src/index.ts` — `checkNaming()`, `assertNaming()`
- `test/naming.test.ts` — 6 naming consistency tests
- Added to `tsconfig.json` paths

---

## Duplicate File Removed

- `docs/adr/0001-trisense-adapted-architecture.md` — created during BUILD then removed since `0001-architecture-spine.md` already covers the content (and is more complete)

---

## Patches Applied (PATCH phase)

### PATCH-01: JSDoc block comment parse error in naming-check
- **Cause:** JSDoc comment contained `packages/*/` which has `*/`, prematurely ending the block comment
- **Fix:** Rewrote file header as line comments instead of JSDoc block comment
- **Status:** ✅ Resolved — typecheck passes clean

---

## Build Commands Run

```
npm install            # initial workspace install
[global renames]
npm install            # regenerate package-lock.json after scope rename
npm install            # add naming-check package
npx tsc --noEmit -p tsconfig.json    # PASS (0 errors)
node --import tsx --test "packages/**/test/**/*.test.ts"   # PASS (89 tests, 0 fail)
```
