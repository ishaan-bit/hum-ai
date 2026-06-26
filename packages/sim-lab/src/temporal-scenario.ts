/**
 * v12 WITHIN-HUM TEMPORAL TRAJECTORY — sim-lab calibration scenario.
 *
 * sim-lab's posture is feature-injection (construct `AcousticFeatures` directly, no
 * audio), which isolates the READ math. The temporal SEGMENTATION needs audio (validated
 * in `@hum-ai/hum-sim`'s temporal gate), but the temporal PREDICTION — chunk-to-chunk
 * variation → trajectory shape — is pure read math and belongs here.
 *
 * We hand-build `TemporalAnalysis` objects from `REFERENCE_HUM` chunk features and assert
 * `computeTemporalRead` classifies them correctly, including the key NOT-SKEWED contract:
 * a sequence of IDENTICAL chunks must read "steady" and arc ≈ 0 — a flat hum may never
 * have a trajectory manufactured for it (the temporal analogue of the read-not-skewed /
 * no-single-zone-pin gates).
 */
import type { AcousticFeatures, HumSegment, TemporalAnalysis } from "@hum-ai/audio-features";
import { computeTemporalRead } from "@hum-ai/orchestrator";
import { refHum } from "./reference";
import type { Finding } from "./report";

/** Build a synthetic TemporalAnalysis from an ordered list of chunk feature-vectors. */
function makeTA(chunks: readonly AcousticFeatures[], totalSec = 12): TemporalAnalysis {
  const per = totalSec / Math.max(1, chunks.length);
  const segments: HumSegment[] = chunks.map((features, i) => ({
    index: i,
    startFrame: Math.round((i * per) / 0.08),
    endFrame: Math.round(((i + 1) * per) / 0.08),
    startSec: i * per,
    endSec: (i + 1) * per,
    features,
  }));
  return {
    temporalMode: "hum-temporal-v1",
    durationSec: totalSec,
    hopSec: 0.08,
    segmentCount: segments.length,
    segments,
    boundarySec: segments.slice(1).map((s) => s.startSec),
    changeMean: 0,
    changePeak: 0,
    energyContour: [],
  };
}

interface TemporalCase {
  readonly label: string;
  readonly chunks: readonly AcousticFeatures[];
  /** Predicate the resulting read must satisfy. */
  readonly expect: (r: NonNullable<ReturnType<typeof computeTemporalRead>>) => boolean;
  readonly contract: string;
}

const EPS = 0.05;

/** The temporal-prediction scenarios (feature-injection; pure read math). */
export function temporalCases(): TemporalCase[] {
  return [
    {
      label: "flat / identical chunks",
      chunks: [refHum(), refHum(), refHum()],
      // NOT-SKEWED: identical chunks may not manufacture a trajectory.
      expect: (r) => r.shape === "steady" && Math.abs(r.arousalArc) < EPS && Math.abs(r.valenceArc) < EPS,
      contract: "identical chunks → steady, arc ≈ 0 (no manufactured trajectory)",
    },
    {
      label: "rising arousal (energy + flux + movement climb)",
      chunks: [
        refHum({ meanRms: 0.03, spectralFlux: 0.06, pitchRangeSemitones: 1.5, activeFrameRatio: 0.55 }),
        refHum({ meanRms: 0.06, spectralFlux: 0.1, pitchRangeSemitones: 3, activeFrameRatio: 0.7 }),
        refHum({ meanRms: 0.11, spectralFlux: 0.15, pitchRangeSemitones: 5, activeFrameRatio: 0.85 }),
      ],
      expect: (r) => r.arousalArc > 0.1 && r.shape === "winding_up",
      contract: "climbing energy/movement → winding_up, arousalArc > 0",
    },
    {
      label: "fading energy (loudness drains away)",
      chunks: [
        refHum({ meanRms: 0.11, activeFrameRatio: 0.85 }),
        refHum({ meanRms: 0.06, activeFrameRatio: 0.7 }),
        refHum({ meanRms: 0.025, activeFrameRatio: 0.5 }),
      ],
      expect: (r) => r.energyArc < -0.1 && (r.shape === "fading" || r.shape === "settling"),
      contract: "draining loudness → fading/settling, energyArc < 0",
    },
    {
      label: "settling (instability eases, arousal falls)",
      chunks: [
        refHum({ meanRms: 0.09, residualInstabilityScore: 0.55, spectralFlux: 0.16, amplitudeStability: 0.5 }),
        refHum({ meanRms: 0.07, residualInstabilityScore: 0.3, spectralFlux: 0.1, amplitudeStability: 0.72 }),
        refHum({ meanRms: 0.06, residualInstabilityScore: 0.15, spectralFlux: 0.06, amplitudeStability: 0.88 }),
      ],
      expect: (r) => r.shape === "settling" && r.instabilityTrend < 0,
      contract: "easing instability + falling arousal → settling, instabilityTrend < 0",
    },
  ];
}

/** Findings from the temporal-prediction scenarios (folded into the calibration gate). */
export function computeTemporalFindings(): Finding[] {
  const findings: Finding[] = [];
  for (const c of temporalCases()) {
    const read = computeTemporalRead(makeTA(c.chunks));
    if (!read) {
      findings.push({ severity: "fail", area: "temporal", message: `${c.label}: temporal read was null (expected: ${c.contract}).` });
      continue;
    }
    if (!c.expect(read)) {
      findings.push({
        severity: "fail",
        area: "temporal",
        message: `${c.label} read as shape=${read.shape} valenceArc=${read.valenceArc.toFixed(2)} arousalArc=${read.arousalArc.toFixed(2)} energyArc=${read.energyArc.toFixed(2)} — expected ${c.contract}.`,
      });
    }
  }
  return findings;
}

/** Markdown section for the temporal-prediction scenarios. */
export function temporalScenarioReport(): string {
  const lines: string[] = [];
  lines.push("## v12 · Within-hum temporal trajectory (chunk-to-chunk prediction)\n");
  lines.push("| scenario | shape | valenceArc | arousalArc | energyArc | contract holds |");
  lines.push("|---|---|---|---|---|---|");
  for (const c of temporalCases()) {
    const r = computeTemporalRead(makeTA(c.chunks));
    if (!r) {
      lines.push(`| ${c.label} | _null_ | — | — | — | ❌ |`);
      continue;
    }
    lines.push(
      `| ${c.label} | ${r.shape} | ${r.valenceArc.toFixed(2)} | ${r.arousalArc.toFixed(2)} | ${r.energyArc.toFixed(2)} | ${c.expect(r) ? "✅" : "❌"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
