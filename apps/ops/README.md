# apps/ops (placeholder)

Operational tooling: derived-data dashboards, consent-state audits, model
version rollout, and notification campaigns. **Not built in this pass.**

Ops may only ever touch **derived** data. Any view, export, or job must run its
payload through `assertNoRawAudioFields` and respect each user's `ConsentState`
(`@hum-ai/shared-types`). Clinical labels (PHQ/GAD/CES-DC) are visible to ops only
under explicit `clinical_label_capture` research consent.
