# Branch Protection — Hum AI

Recommended protection for `main` on **ishaan-bit/hum-ai**. Apply after the first
push and after CI has run at least once (so the status-check contexts exist).

## Goals

- `main` is always green: CI (`ci.yml`) and the privacy gate (`privacy-check.yml`)
  must pass before merge.
- No direct pushes that bypass review/CI once collaborators join.
- History stays clean and force-push-free.

## Required status checks

These are the job names from the workflows — they appear as required-check contexts
after their first run:

- `build-and-test` (from `.github/workflows/ci.yml`)
- `privacy-check` (from `.github/workflows/privacy-check.yml`)

## Apply via GitHub UI

`Settings → Branches → Add branch ruleset` (or classic *Branch protection rules*) for
`main`:

- [x] Require a pull request before merging (1 approval once there is a second maintainer).
- [x] Require status checks to pass before merging → select `build-and-test` and `privacy-check`.
- [x] Require branches to be up to date before merging.
- [x] Require conversation resolution before merging.
- [x] Block force pushes.
- [x] Restrict deletions.
- [ ] (Optional) Require signed commits.

> Solo-maintainer note: if you are the only committer right now, you may keep "require
> PR" off to avoid blocking yourself, but **keep the two required status checks on** —
> that is the part that protects `main`.

## Apply via gh CLI (classic protection)

Requires admin on the repo. Run after the first CI run:

```bash
gh api -X PUT repos/ishaan-bit/hum-ai/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=build-and-test" \
  -f "required_status_checks[contexts][]=privacy-check" \
  -F "enforce_admins=false" \
  -F "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "restrictions=null" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false"
```

Set `enforce_admins=true` and `required_approving_review_count` appropriately once the
team grows. Verify with:

```bash
gh api repos/ishaan-bit/hum-ai/branches/main/protection | jq '.required_status_checks'
```

## Notes

- The required-check names must exactly match the workflow **job** names. If you rename
  a job in `ci.yml` / `privacy-check.yml`, update the protection contexts too.
- Branch protection is configured **on GitHub**, not in the repo, so it is applied
  post-push (it cannot be part of the initial commit).
