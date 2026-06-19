# ADR-0000 — Product Naming

**Status:** Accepted
**Date:** 2026-06-18
**Deciders:** Hum AI core team

---

## Context

The product was originally developed under the working name "Hum" and the older technical specification was authored under that name. As the platform matures into a distinct, branded product, consistent naming across all surfaces (code, docs, repos, packages, environment variables) reduces confusion, prevents future drift, and prepares the repository for public bootstrap as `hum-ai`.

Multiple naming variants appeared in early development: "Hum", "Hum AI", "HumAI", "Hum-AI", "Hum App", and "Hum v2". This ADR settles the canonical form.

---

## Decision

The product is named **Hum AI**.

| Context | Canonical form |
|---|---|
| Display / product name | **Hum AI** |
| In-prose short form (after "Hum AI" is introduced on a surface) | "Hum" |
| Repository name | `hum-ai` |
| Root `package.json` `"name"` | `hum-ai` |
| Package scope | `@hum-ai` |
| Vercel project name | `hum-ai` |
| Internal machine slug | `hum-ai` |
| Environment variable prefix | `HUM_AI_` |
| Database / collection prefix | `hum_ai_` |

### Legacy Hum

The older technical specification (`Hum_Academic_Review_Technical_Specification.docx`) and the pre-ADR-0000 implementation are referred to as **legacy Hum** when a distinction is required. "legacy Hum" is the only sanctioned use of bare "Hum" to denote the OLD spec/implementation. Bare "Hum" MAY otherwise be used as an in-prose short form of "Hum AI" once the full name has been introduced on a surface (as the README does) — what must never appear is bare "Hum" in machine identifiers (package metadata, slugs, scopes), which is what CI enforces.

### Banned variants

The following are **not** used as the primary product name:

- `Hum` (bare, without "AI") — as a product name use only in "legacy Hum" (historical) or as in-prose shorthand for "Hum AI" after first use; never as a machine identifier
- `HumAI` — not used (no space)
- `Hum-AI` — not used (hyphenated display form)
- `Hum App` — not used
- `Hum v2` — not used
- `Hum Intelligence` — not used

---

## Rationale

1. **Clarity.** "Hum AI" distinguishes the platform from the raw gesture (a hum) and signals its AI-first nature.
2. **Slug consistency.** `hum-ai` follows standard kebab-case npm/URL conventions; `@hum-ai` is the corresponding npm scope.
3. **Drift prevention.** Encoding the name in an ADR and in CI-enforced tests ensures that future contributors cannot accidentally reintroduce bare "Hum" naming in package metadata or docs.

---

## Enforcement

- Root `package.json` `"name"` field MUST be `"hum-ai"`.
- All internal package names MUST use `@hum-ai/` scope.
- The word "Hum AI" (with space and capital A and I) MUST appear in the README `h1` header.
- A naming consistency test (`packages/naming-check`) checks these invariants on every CI run.

---

## Consequences

- All source files migrated from the legacy `@hum` scope to `@hum-ai/` scope — done in the 2026-06-18 foundation pass.
- README title updated to "Hum AI" — done.
- `package.json` root name updated to `hum-ai` — done.
- Future ADRs, docs, and code MUST use "Hum AI" as the product name.
