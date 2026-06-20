import { asIsoTimestamp, asModelVersion } from "@hum-ai/shared-types";
import { computeFeatures, type AcousticFeatures, type AudioInput } from "@hum-ai/audio-features";
import type { HumLabel, NativeHumExample } from "@hum-ai/affect-model-contracts";
import { appendExample, emptyCorpus, type NativeCorpus } from "../src/corpus";

const SR = 16000;

/** One real derived-feature base from a 12 s sine — spread + override fields per example. */
export function baseFeatures(freq = 180, amp = 0.2): AcousticFeatures {
  const n = SR * 12;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  const input: AudioInput = { sampleRate: SR, samples };
  return computeFeatures(input);
}

export const BASE = baseFeatures();
export const MV = asModelVersion("hum-web@0.1.0");

/** Build a native-hum example. `at` is a monotonically-increasing iso for chronological order. */
export function makeExample(opts: {
  id: string;
  features?: Partial<AcousticFeatures>;
  predicted?: HumLabel;
  label: HumLabel;
  source?: NativeHumExample["source"];
  agreedWithRead?: boolean;
  eligible?: boolean;
  at?: string;
}): NativeHumExample {
  const features: AcousticFeatures = { ...BASE, ...opts.features };
  return {
    id: opts.id,
    capturedAt: asIsoTimestamp(opts.at ?? "2026-06-20T10:00:00.000Z"),
    modelVersion: MV,
    features,
    predicted: opts.predicted ?? { valence: 0, arousal: 0 },
    predictedConfidence: 0.4,
    label: opts.label,
    source: opts.source ?? "self_report_adjust",
    agreedWithRead: opts.agreedWithRead ?? false,
    captureQualityScore: 0.8,
    eligible: opts.eligible ?? true,
    provenance: "in_app_hitl_self_report",
    featureSchemaVersion: features.featureMode,
  };
}

/**
 * A learnable arousal corpus: the arousal label is driven by `jitter`, a feature the
 * transparent acoustic backbone IGNORES for arousal — so a model that sees all
 * features can beat the backbone. Energy/pitch/brightness held ~constant so the
 * backbone's arousal is constant (≈chance on this label). `count` examples, balanced.
 */
export function learnableArousalCorpus(count = 40): NativeCorpus {
  let corpus = emptyCorpus();
  for (let i = 0; i < count; i++) {
    const high = i % 2 === 0;
    const jitter = high ? 0.05 + (i % 4) * 0.002 : 0.005 + (i % 4) * 0.001;
    const at = `2026-06-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00.000Z`;
    corpus = appendExample(
      corpus,
      makeExample({
        id: `ar-${i}`,
        features: { jitter, shimmerProxy: high ? 0.08 : 0.03 },
        label: { valence: 0.2, arousal: high ? 0.6 : -0.6 },
        at,
      }),
    );
  }
  return corpus;
}
