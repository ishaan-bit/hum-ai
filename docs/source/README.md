# docs/source — PRIVATE source materials (NOT committed)

This directory holds the **primary academic source documents** used to build the
Hum AI foundation. The binary documents are **local-only and must never be committed
to a public repository.**

## What is tracked vs. ignored

| Tracked (committed) | Ignored (local-only) |
| --- | --- |
| `INDEX.md` — source manifest, provenance, key facts | `*.pdf` — source PDFs |
| `README.md` — this file | `*.docx` / `*.doc` — source Word docs |
| | `*.pptx` and other binary source materials |

The `.gitignore` rules `docs/source/*.pdf` and `docs/source/*.docx` (plus `**` variants)
enforce this, and `.github/workflows/privacy-check.yml` fails CI if any such file is
ever staged or tracked. **If you add a new source, add it here locally only and record
it in [INDEX.md](INDEX.md) — never `git add` the binary.**

## Why these are private

The sources are third-party copyrighted academic papers and a working technical
specification. They were used as **priors and references** under fair-use review;
redistributing them in a public repo would be a copyright and provenance problem.
Hum AI cites every source by its `id` (see [INDEX.md](INDEX.md)) so the lineage is
auditable **without** shipping the documents themselves.

## The sources (see INDEX.md for full citations + extracted facts)

| `id` | Role |
| --- | --- |
| `trisense_architecture` | System spine — expert-based late fusion (FER+SER+TER) |
| `hum_spec` | Source of truth — hum protocol, features, quality gate, caps, privacy |
| `clinical_voice_biomarker_review` | Clinical prior — voice→depression markers (priors only) |
| `vocal_biomarker_and_singing_protocol_support` | Scientific basis for the sung/hum protocol |
| `ser_mental_health_review` | Affect prior + methodology guardrail (multi-head, abstention) |
| `longitudinal_voice_treatment_response_source` | Relapse/recovery engine inspiration (DVDSA) |
| `intervention_support_source` | Intervention support only (music & stress) — never diagnosis |

## Reproducing extraction (local only)

Extraction caches go to `.extract/` (also git-ignored). See the bottom of
[INDEX.md](INDEX.md) for the `pdftotext` / docx commands. Never commit `.extract/`
or the binaries.
