"""Signal-Lab neural training harness.

An OFFLINE, app-runtime-isolated PyTorch cohort for the HumAI affect priors. It
trains/evaluates neural models on the EXACT labels, actor groups, target
derivations, and engineered features exported by `@hum-ai/signal-lab`
(`npm run signal:export-neural`), under the SAME leakage-safe grouped-CV
promotion gate as the classical cohort. It promotes a neural model ONLY if it
clears the gate AND beats the classical baseline; otherwise it reports the
failure honestly and the TypeScript runtime keeps its classical fallback.

Governance (ADR-0005): RAVDESS is acted speech, far domain (penalty 0.45) — a
PRIOR only, never hum truth, never clinical. Nothing here changes that.
"""

__all__ = ["device", "data", "models", "metrics", "evaluate", "gate", "train"]
