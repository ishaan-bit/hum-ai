# Validation Report

All commands run on branch `cohesion/voice-core-merge` (merge commit `e6bd8c6`
+ cohesion fixes) in `c:\Users\Kafka\Documents\humai`.

| Gate | Command | Result |
| --- | --- | --- |
| Install | `npm install` | PASS — 49 packages audited, **0 vulnerabilities**, no heavy/ML/camera deps added. |
| Typecheck | `npm run typecheck` (`tsc --noEmit`, strict) | **PASS** |
| Tests | `npm test` | **202 / 202 pass**, 0 fail, 0 skipped, 0 todo (`duration ≈ 32s`). |
| QA gates | `npm run qa` | **PASS** — `no-clinical-leak`, `no-camera-deps`, `no-raw-confidence-copy`, `forbidden-files` all green. |
| Voice demo | `npm run demo:voice` | **PASS** — clean / noisy / near-silence hums run end-to-end; near-silence abstains; sync raw-audio guard PASSED; "Nothing was recorded; all signals generated in code." |
| Privacy sweep | `git ls-files \| grep <forbidden>` | **PASS** — no tracked binaries/audio/weights/`.env`/`.vercel`/credentials/datasets (only `.env.example`). |
| Working tree | `git status --short` | clean except intended changes (`README.md`, new cohesion worklog). |

## Test count

202 (overnight baseline 202; the merge carried all overnight additions intact;
163 → 202 across the foundation + voice-core). No existing test weakened, skipped,
or deleted; no test was modified to make it pass.

## Demo highlights (honesty preserved)

- User-facing copy is qualitative only ("Low evidence", "close to your usual"),
  never a raw number; near-silence yields an explicit abstain.
- Internal block (quality / domain / stage / derived f0·rms·snr) is clearly
  separated and labelled "never shown to a user."
- Every sync payload prints "raw-audio guard PASSED" and "derived-only".

## Fixes applied during validation

None required for the gates — all passed on first run after the merge + the
README cohesion patch. The only working-tree changes are the documentation
cohesion edits described in `COHESION_FIXES.md`. No code behavior changed.
