# Security Policy

Hum AI is a **non-clinical, research-stage** voice-biomarker and affective-modeling
platform. It is local-first by design and handles sensitive signals (voice-derived
features, affect and clinical-risk *markers*). We take security and privacy seriously.

## Reporting a vulnerability

**Do not open a public issue for security or privacy vulnerabilities.**

Report privately to the maintainer:

- GitHub: open a [private security advisory](https://github.com/ishaan-bit/hum-ai/security/advisories/new) on this repository, or
- Email the maintainer listed on the GitHub profile [@ishaan-bit](https://github.com/ishaan-bit).

Please include: a description, reproduction steps, affected version/commit, and the
potential impact. We aim to acknowledge within **5 business days**.

## Scope

In scope:

- Privacy leaks: raw audio, recordings, datasets, clinical labels (PHQ/GAD/CES-DC),
  or model weights being exfiltrated, logged, or synced contrary to the consent model.
- Bypasses of the privacy guards (`assertNoRawAudioFields`), the two-head consent
  gate (`splitInference` / `clinical_risk_surfacing`), or the safety-language render
  guards (`assertSafeUserFacingText`, `assertNoClinicalLeak`).
- Secret/credential exposure in the repo or build (`.env`, Firebase service-account
  JSON, Vercel tokens).
- Standard web/app vulnerabilities in the deployed local-first web client (`apps/web`),
  including the Sound Lab's outbound third-party calls (YouTube Data API, Last.fm).

Out of scope (by design, current pass):

- The experts are heuristic stubs; "model inaccuracy" is not a security issue.
- No camera/visual path exists yet (voice-first; see ADR-0009).
- **Public client identifiers are intentionally embedded in the static bundle** and are
  *not* a credential leak: the Firebase **web** config and the optional, **referrer-restricted,
  read-only** Sound Lab keys (`HUM_AI_YOUTUBE_API_KEY`, `HUM_AI_LASTFM_API_KEY`) are public by
  design. Server secrets (service-account JSON, Vercel/admin tokens) are never bundled and *are*
  in scope above.

## What this project will never do

These are product invariants; a violation is a security/privacy bug:

- **Raw audio is not uploaded by default.** Only derived features may sync, and only
  under explicit, scoped consent. Every sync payload must pass `assertNoRawAudioFields`.
- **No diagnosis.** Hum produces reflective signals and risk *markers*, never a
  clinical diagnosis. Diagnostic language is blocked by `@hum-ai/safety-language`.
- **Clinical-risk markers are consent-gated** and never leak into user-facing copy
  verbatim or into the recommendation engine as raw labels (ADR-0006).
- **No source materials, datasets, weights, or secrets in the repo.** See
  [docs/privacy/PUBLIC_REPO_PRIVACY_CHECKLIST.md](docs/privacy/PUBLIC_REPO_PRIVACY_CHECKLIST.md).

## Supported versions

This is a pre-1.0 foundation (`0.0.0`). Security fixes target `main`. There is no
LTS branch yet.

## Disclosure

We follow coordinated disclosure: we will work with you on a fix and a disclosure
timeline before any public detail is shared.
