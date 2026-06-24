# apps/ops

Operational tooling: derived-data dashboards, consent-state audits, model
version rollout, and notification campaigns.

Ops may only ever touch **derived** data. Any view, export, or job must run its
payload through `assertNoRawAudioFields` and respect each user's `ConsentState`
(`@hum-ai/shared-types`). Clinical labels (PHQ/GAD/CES-DC) are visible to ops only
under explicit `clinical_label_capture` research consent.

## Population retrain job (ADR-0012)

`src/population-train.ts` is the **offline** cross-user retrain — the analogue of the
on-device `maybeRetrain`. It pools consented, pseudonymous `PopulationContribution`
rows, trains a population baseline with **group-by-contributor cross-validation** (the
same honest promotion gate the within-user retrain uses), derives **population OCEAN
norms**, and writes a versioned `PopulationArtifact` the client ships as its middle
prior tier (**personal > population > far-domain**).

```bash
# pool.json is a JSON array of PopulationContribution rows, already consent-filtered
# to `population_corpus_contribution` grants.
npm run population:train --workspace @hum-ai/app-ops -- pool.json population-artifact.json
# or:
node --import tsx apps/ops/src/population-train.ts pool.json population-artifact.json
```

This is the **offline-capable** tier: it runs by hand / in CI, not as an auto-deployed
cloud function. The live aggregation collection (`firestore.rules` →
`populationContributions/*`, server/aggregator-readable only, append-only) and the
`population_corpus_contribution` consent scope are in place; standing up a scheduled
cloud run + a public artifact-distribution doc is a governed follow-up.
