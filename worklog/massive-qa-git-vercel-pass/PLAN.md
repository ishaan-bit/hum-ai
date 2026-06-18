# Massive QA / QC + Architecture Hardening + GitHub/Vercel Bootstrap — PLAN

- **Product:** Hum AI · slug `hum-ai` · scope `@hum-ai` · env prefix `HUM_AI`
- **Date:** 2026-06-18
- **Entry state:** Foundation green — `npm test` 89/89, `npm run typecheck` clean, packages scoped `@hum-ai/*`, **not yet a git repo**, source docs local-only under `docs/source/`.
- **Constraint:** voice-first now, camera-assisted later. No camera packages, no visual feature extraction this pass. FER stays an architecture placeholder only.

## Lanes

| Lane | Title | Output |
| --- | --- | --- |
| A | QA/QC Foundation Auditor | Re-run tests/typecheck/naming/doc-link; verify no stale `@hum`, no camera impl, voice-first intact, source docs git-ignored. → `LANE_A_QA_REPORT.md` |
| B | Architecture Decision Closer | Two-head separation, dual baseline, user-facing confidence language. Typed contracts + tests + ADR-0006/0007/0008. → `LANE_B_ARCHITECTURE_DECISIONS.md` |
| C | Voice-First Scope Guard | `VOICE_FIRST_ROADMAP.md` + ADR-0009. → `LANE_C_VOICE_FIRST_SCOPE.md` |
| D | Public Repo Safety + GitHub Bootstrap | `.gitignore`, `.env.example`, `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE`, `docs/source/README.md`, privacy checklist, devops bootstrap/branch-protection docs; safe git init + push. → `LANE_D_GITHUB_BOOTSTRAP.md` |
| E | Vercel Bootstrap | `VERCEL_SETUP.md`, `DEPLOYMENT.md`, `ENVIRONMENT_VARIABLES.md`; web deployability decision (no fake deploy). → `LANE_E_VERCEL_BOOTSTRAP.md` |
| F | CI / Privacy Gates | `.github/workflows/ci.yml` + `privacy-check.yml`. → `LANE_F_CI_PRIVACY_GATES.md` |
| G | Final Integration / Combine | Reconcile, re-validate, adversarial verification, commit/push only if green + privacy-safe. → `VALIDATION_REPORT.md`, `PATCH_LOG.md`, `FINAL_STATUS.md`, `NEXT_PROMPT.md` |

## Execution order (dependency-aware)

1. PLAN.md (this file).
2. Lane B code — typed contracts + tests (must keep build green; validated after each module).
3. Lane B/C ADRs + voice-first roadmap (docs reference the new contracts).
4. Lane D/E/F files (repo-safety, devops docs, CI workflows).
5. Full re-validation (`typecheck` + `test` + naming + privacy scan).
6. **Adversarial verification workflow** (parallel read-only agents: privacy leak scan, naming/scope audit, two-head clinical-leak audit, doc-link/consistency, CI sanity).
7. Reconcile findings → patch → re-validate.
8. Git init + privacy gate + commit `chore: bootstrap Hum AI foundation` + push to `github.com/ishaan-bit/hum-ai`.
9. Vercel link (project `hum-ai`, team `ishaans-projects-f5eaf242`) — link only, no fake deploy.
10. Reports + FINAL_STATUS + NEXT_PROMPT.

## Hard gates (never violated)

- Do not weaken tests to pass.
- Do not push if tests/typecheck fail.
- Do not push if privacy scan fails (PDF/docx/`.env`/secrets/audio/datasets/weights staged).
- Do not deploy a placeholder web app as production.
- Keep naming locked: Hum AI / hum-ai / @hum-ai / HUM_AI. No HumAI, Hum-AI, Hum v2, @hum.

## Architecture decisions to close (Lane B)

1. **Two-head separation** — `broad affect head` (dimensional + benign states, drives copy + recommendations) vs `consent-gated clinical-risk marker head` (anxiety/depressive/relapse markers). Internal labels never leak to user copy; the recommendation engine consumes a sanitized view with **no direct clinical labels**.
2. **Dual baseline** — `rolling` short-term (fast-adapting, window 24) + `anchored` long-term (stable reference, maturity-gated). Divergence between them is the drift signal.
3. **User-facing confidence** — no raw clinical-looking numeric by default; surface "Signal clarity", "Based on X clean hums", "Early baseline", High/Medium/Low evidence. Internal numeric confidence retained for model logic only.
