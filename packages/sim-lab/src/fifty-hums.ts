import type { AcousticFeatures } from "@hum-ai/audio-features";
import { acousticAffectAxes, resolveAxisRead } from "@hum-ai/orchestrator";
import { refHum } from "./reference";

/**
 * FIFTY-HUM DISTRIBUTION PROBE — generate ~56 DIVERSE hums (with and without clear
 * voicing, across the full realistic range of energy, pitch height, melodic movement,
 * brightness and voice quality) and print the resulting headline distribution. If a
 * single zone dominates, the read is pinned and the calibration is biased. This is the
 * "simulate 50-60 different hums" diagnostic.
 *
 * v11 TWO-PART CONTRACT. The healthy distribution is NOT "every acoustic input spreads the
 * read" — that conflated voice IDENTITY with mood. It is:
 *  (1) MOOD spread — varying the STATE cues (energy/melody/dynamics) must still spread the read
 *      across zones (mood is readable from the first hum), AND
 *  (2) CROSS-VOICE invariance — varying only the IDENTITY cues (pitch + brightness register) with
 *      mood FIXED must CLUSTER the read (a husky and a bright voice feeling the same read alike).
 * The probe prints both: the full distribution (mostly mood-driven) and a dedicated cross-voice
 * cluster check. A wide cross-voice spread is now the BUG, not a wide overall spread.
 */

// Mirror of axisHeadline in copy.ts (kept local so the probe has no extra export coupling).
const T = 0.2;
function headline(valence: number, arousal: number): string {
  const hiA = arousal > T, loA = arousal < -T, hiV = valence > T, loV = valence < -T;
  if (hiA && hiV) return "Bright and energised";
  if (hiA && loV) return "Tense and wound-up";
  if (loA && hiV) return "Calm and content";
  if (loA && loV) return "Low and flat";
  if (hiA) return "Restless and activated";
  if (loA) return "Quiet and subdued";
  if (hiV) return "Warm and steady";
  if (loV) return "A little flat";
  return "Steady and even";
}

interface Hum {
  readonly label: string;
  readonly over: Partial<AcousticFeatures>;
}

// Deterministic spread of realistic hums. Energy × pitch-height × melodic-movement ×
// voice-quality, both voiced ("with vocals") and unvoiced ("without vocals", pitch null).
const ENERGY = [
  { k: "soft", meanRms: 0.014, rmsEnergy: 0.014, peakAmplitude: 0.16, activeFrameRatio: 0.45, spectralFlux: 0.03 },
  { k: "mid", meanRms: 0.035, rmsEnergy: 0.035, peakAmplitude: 0.4, activeFrameRatio: 0.68, spectralFlux: 0.1 },
  { k: "loud", meanRms: 0.085, rmsEnergy: 0.085, peakAmplitude: 0.72, activeFrameRatio: 0.9, spectralFlux: 0.22 },
];
const PITCH = [
  { k: "low", pitchMeanHz: 110, spectralCentroidHz: 620 },
  { k: "mid", pitchMeanHz: 165, spectralCentroidHz: 1000 },
  { k: "high", pitchMeanHz: 235, spectralCentroidHz: 1700 },
];
const MELODY = [
  { k: "flat", pitchRangeSemitones: 0.8 },
  { k: "wide", pitchRangeSemitones: 5.0 },
];
const QUALITY = [
  { k: "rough", smoothnessScore: 0.4, amplitudeStability: 0.55, pitchStability: 0.55, residualInstabilityScore: 0.55, vibratoRegularity: 0.35 },
  { k: "smooth", smoothnessScore: 0.85, amplitudeStability: 0.9, pitchStability: 0.9, residualInstabilityScore: 0.12, vibratoRegularity: 0.8 },
];

function buildVoiced(): Hum[] {
  const hums: Hum[] = [];
  for (const e of ENERGY) for (const p of PITCH) for (const m of MELODY) for (const q of QUALITY) {
    hums.push({
      label: `voiced/${e.k}-${p.k}-${m.k}-${q.k}`,
      over: { ...e, ...p, ...m, ...q, pitchCoverage: 0.7, clarityScore: 0.75 },
    });
  }
  return hums; // 3×3×2×2 = 36
}

function buildUnvoiced(): Hum[] {
  // "without vocals" — breathy / weakly-voiced: pitch features null, varying energy + quality.
  const nullPitch: Partial<AcousticFeatures> = {
    pitchMeanHz: null, pitchVariance: null, pitchRangeSemitones: null, pitchStability: null,
    jitter: null, vibratoRegularity: null, smoothnessScore: null, pitchCoverage: 0.15,
  };
  const hums: Hum[] = [];
  for (const e of ENERGY) for (const b of [620, 1100, 1700]) for (const q of QUALITY) {
    hums.push({
      label: `unvoiced/${e.k}-c${b}-${q.k}`,
      over: { ...nullPitch, ...e, spectralCentroidHz: b, amplitudeStability: q.amplitudeStability, residualInstabilityScore: q.residualInstabilityScore, clarityScore: 0.5 },
    });
  }
  return hums; // 3×3×2 = 18
}

const HUMS = [...buildVoiced(), ...buildUnvoiced()];

function main(): void {
  const tally = new Map<string, number>();
  const rows: string[] = [];
  let vMin = 1, vMax = -1, aMin = 1, aMax = -1;
  for (const h of HUMS) {
    const ax = acousticAffectAxes(refHum(h.over));
    const read = resolveAxisRead(refHum(h.over)); // full path (priors absent → same as acoustic)
    const v = read.dimensional.valence, a = read.dimensional.arousal;
    const hl = headline(v, a);
    tally.set(hl, (tally.get(hl) ?? 0) + 1);
    vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
    aMin = Math.min(aMin, a); aMax = Math.max(aMax, a);
    rows.push(`${h.label.padEnd(30)} v=${v.toFixed(2).padStart(5)} a=${a.toFixed(2).padStart(5)}  ${hl}`);
    void ax;
  }
  console.log("\n=== 56-HUM READ DISTRIBUTION ===\n");
  for (const r of rows) console.log(r);
  console.log("\n--- headline tally ---");
  const sorted = [...tally.entries()].sort((x, y) => y[1] - x[1]);
  for (const [hl, n] of sorted) {
    const pct = ((n / HUMS.length) * 100).toFixed(0);
    console.log(`${String(n).padStart(3)}  (${pct.padStart(3)}%)  ${hl}`);
  }
  console.log(`\nvalence range: [${vMin.toFixed(2)}, ${vMax.toFixed(2)}]   arousal range: [${aMin.toFixed(2)}, ${aMax.toFixed(2)}]`);
  console.log(`distinct headlines: ${tally.size} / 9 possible`);
  const top = sorted[0];
  if (top && top[1] / HUMS.length > 0.4) {
    console.log(`\n⚠️  PINNED: "${top[0]}" dominates ${((top[1] / HUMS.length) * 100).toFixed(0)}% of diverse hums.`);
  }

  // v11 CROSS-VOICE INVARIANCE — the read must NOT spread when ONLY voice identity changes.
  // Fixed neutral mood; five voices from husky/low+dark → bright/high. They should cluster.
  console.log("\n=== CROSS-VOICE INVARIANCE (fixed mood, identity varied) ===\n");
  const CROSS_VOICES = [
    { k: "husky-low", pitchMeanHz: 110, spectralCentroidHz: 650 },
    { k: "low", pitchMeanHz: 145, spectralCentroidHz: 850 },
    { k: "mid", pitchMeanHz: 175, spectralCentroidHz: 1000 },
    { k: "high", pitchMeanHz: 215, spectralCentroidHz: 1300 },
    { k: "bright-high", pitchMeanHz: 250, spectralCentroidHz: 1650 },
  ];
  let cvMinV = 1, cvMaxV = -1, cvMinA = 1, cvMaxA = -1;
  for (const cv of CROSS_VOICES) {
    const read = resolveAxisRead(refHum({ pitchMeanHz: cv.pitchMeanHz, spectralCentroidHz: cv.spectralCentroidHz }));
    const v = read.dimensional.valence, a = read.dimensional.arousal;
    cvMinV = Math.min(cvMinV, v); cvMaxV = Math.max(cvMaxV, v);
    cvMinA = Math.min(cvMinA, a); cvMaxA = Math.max(cvMaxA, a);
    console.log(`${cv.k.padEnd(14)} v=${v.toFixed(2).padStart(5)} a=${a.toFixed(2).padStart(5)}  ${headline(v, a)}`);
  }
  const cvSpanV = cvMaxV - cvMinV, cvSpanA = cvMaxA - cvMinA;
  console.log(`\ncross-voice valence span: ${cvSpanV.toFixed(2)} (≤0.45 good)   arousal span: ${cvSpanA.toFixed(2)} (≤0.30 good)`);
  if (cvSpanV > 0.45 || cvSpanA > 0.3) {
    console.log(`⚠️  CROSS-VOICE BIAS: voice identity is dictating the read — a husky and a bright voice read differently at the same mood.`);
  } else {
    console.log(`✅  voice identity does not dictate the cold read (the residual separates only as a personal baseline forms).`);
  }
}

main();
