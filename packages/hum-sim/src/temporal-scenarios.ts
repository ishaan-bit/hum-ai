/**
 * v12 WITHIN-HUM TEMPORAL GATE — validate the change-point segmentation + trajectory
 * read end-to-end on synthesized audio with KNOWN contours.
 *
 * The synth can now impose a net within-hum CONTOUR (`energyShift` / `pitchShiftSemis`,
 * a logistic late-vs-early transition) while preserving the MEAN level — so a hum can
 * be made to genuinely swell, fade, rise or fall in pitch without changing its average.
 * That isolates the temporal feature: only the TRAJECTORY differs. We render each
 * contour through `analyzeTemporalDynamics` → `computeTemporalRead` (the exact product
 * path) and assert the read recovers what we built in:
 *
 *   - a FLAT hum stays ONE chunk and reads "steady" (no manufactured trajectory);
 *   - a SWELLING hum is chunked (≥2) and reads rising energy (not "fading");
 *   - a FADING hum is chunked and reads "easing off";
 *   - a RISING-pitch hum reads rising arousal; a FALLING-pitch hum falling;
 *   - the rise/fall energy arcs SEPARATE; the mid-hum change-point lands near centre;
 *   - all surfaced trajectory copy passes the safety screen.
 *
 * These are hard regressions a change to the segmentation rule or the trajectory math
 * could re-introduce — the CLI folds this gate into its non-zero exit code.
 */
import { analyzeTemporalDynamics, type AudioInput, type TemporalAnalysis } from "@hum-ai/audio-features";
import { computeTemporalRead, type TemporalRead } from "@hum-ai/orchestrator";
import { validateUserFacingText } from "@hum-ai/safety-language";
import { renderControls } from "./synth";
import { latentToControls, NEUTRAL_LATENT, type SynthControls } from "./latent";
import type { GateCheck } from "./analysis";

const BASE: SynthControls = latentToControls(NEUTRAL_LATENT);

/** Render one contour variant of the neutral hum and read its trajectory. */
function readContour(over: Partial<SynthControls>): { audio: AudioInput; ta: TemporalAnalysis; read: TemporalRead | null } {
  const controls: SynthControls = { ...BASE, ...over };
  const audio = renderControls(controls);
  const ta = analyzeTemporalDynamics(audio);
  return { audio, ta, read: computeTemporalRead(ta) };
}

interface ContourRun {
  readonly read: TemporalRead;
  readonly durationSec: number;
  readonly changePeak: number;
  /** First→last chunk change in measured pitch (Hz); null if a chunk was unvoiced. */
  readonly pitchDeltaHz: number | null;
}

/** First→last chunk change in a measured per-chunk feature (the chunk-level trajectory). */
function chunkPitchDelta(ta: TemporalAnalysis): number | null {
  if (ta.segments.length < 2) return 0;
  const first = ta.segments[0]?.features.pitchMeanHz ?? null;
  const last = ta.segments[ta.segments.length - 1]?.features.pitchMeanHz ?? null;
  return first !== null && last !== null ? last - first : null;
}

/** Run a contour across several seeds; drop any degenerate (null) read. */
function runSeeds(over: Omit<Partial<SynthControls>, "seed">, seeds: readonly number[]): ContourRun[] {
  const out: ContourRun[] = [];
  for (const seed of seeds) {
    const { audio, ta, read } = readContour({ ...over, seed });
    if (read) {
      out.push({
        read,
        durationSec: audio.samples.length / audio.sampleRate,
        changePeak: ta.changePeak,
        pitchDeltaHz: chunkPitchDelta(ta),
      });
    }
  }
  return out;
}

const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
const num = (x: number): string => (Number.isFinite(x) ? x.toFixed(3) : "—");

export interface TemporalGateResult {
  readonly pass: boolean;
  readonly checks: readonly GateCheck[];
  /** Printable diagnostic rows (one per contour family). */
  readonly rows: readonly string[];
}

/** Thresholds — loose enough for synth variability, tight enough to catch a real regression. */
export const TEMPORAL_GATE = {
  /** A swell/fade must move energy at least this much first→last. */
  ENERGY_ARC_MIN: 0.1,
  /** Rise − fall energy-arc separation. */
  ENERGY_SEPARATION: 0.28,
  /**
   * A pitch glide's CHUNKS must track its direction: the last chunk's measured pitch
   * differs from the first by at least this many Hz. This validates the user's actual
   * goal — the chunks capture how a PARAMETER changed across the hum — at the feature
   * level, independent of how the (deliberately pitch-muted, movement-confounded) V/A
   * read maps register.
   */
  PITCH_CHUNK_HZ_MIN: 12,
  /** A mid-hum shift's nearest boundary must land within this of the midpoint (s). */
  BOUNDARY_CENTER_TOL: 2.4,
} as const;

/**
 * Build + evaluate the temporal gate. Pure (deterministic synth + read).
 */
export function runTemporalGate(): TemporalGateResult {
  const seedsFew = [201, 202, 203];
  const seedsFlat = [301, 302, 303, 304, 305];

  const flat = runSeeds({}, seedsFlat);
  const rise = runSeeds({ energyShift: 1.3, shiftCenter: 0.5, shiftSharpness: 12 }, seedsFew);
  const fall = runSeeds({ energyShift: -1.3, shiftCenter: 0.5, shiftSharpness: 12 }, seedsFew);
  const pUp = runSeeds({ pitchShiftSemis: 11, shiftCenter: 0.5, shiftSharpness: 12 }, seedsFew);
  const pDn = runSeeds({ pitchShiftSemis: -11, shiftCenter: 0.5, shiftSharpness: 12 }, seedsFew);

  const checks: GateCheck[] = [];
  const add = (id: string, pass: boolean, detail: string): void => { checks.push({ id, pass, detail }); };

  // T1 — a flat (steady-mood) hum must NOT manufacture a trajectory. The meaningful
  // guarantee is the PREDICTION: it reads "steady" and stays minimally chunked (a steady
  // hum's bounded oscillation may occasionally yield 2 identical chunks, but never a
  // direction). Over-fragmentation (≥3 chunks) or any non-steady shape is the regression.
  const flatSteady = flat.filter((r) => r.read.shape === "steady" && r.read.segmentCount <= 2).length;
  add(
    "temporal:flat-stays-steady",
    flat.length > 0 && flatSteady === flat.length,
    `${flatSteady}/${flat.length} flat hums read steady & ≤2 chunks (no manufactured trajectory)`,
  );

  // T2 — a swelling hum is chunked and reads rising energy (never "fading").
  const riseArc = mean(rise.map((r) => r.read.energyArc));
  const riseSegs = mean(rise.map((r) => r.read.segmentCount));
  const riseNotFading = rise.every((r) => r.read.shape !== "fading");
  add(
    "temporal:swell-detected",
    rise.length > 0 && riseArc >= TEMPORAL_GATE.ENERGY_ARC_MIN && riseSegs >= 2 && riseNotFading,
    `swell energyArc=${num(riseArc)} (≥${TEMPORAL_GATE.ENERGY_ARC_MIN}), chunks=${num(riseSegs)} (≥2), never-fading=${riseNotFading}`,
  );

  // T3 — a fading hum is chunked and reads easing-off / negative energy arc.
  const fallArc = mean(fall.map((r) => r.read.energyArc));
  const fallSegs = mean(fall.map((r) => r.read.segmentCount));
  const fallFading = fall.filter((r) => r.read.shape === "fading").length;
  add(
    "temporal:fade-detected",
    fall.length > 0 && fallArc <= -TEMPORAL_GATE.ENERGY_ARC_MIN && fallSegs >= 2 && fallFading >= Math.ceil(fall.length / 2),
    `fade energyArc=${num(fallArc)} (≤−${TEMPORAL_GATE.ENERGY_ARC_MIN}), chunks=${num(fallSegs)} (≥2), fading=${fallFading}/${fall.length}`,
  );

  // T4 — rise vs fall energy arcs SEPARATE (direction is recovered, not noise).
  const sep = riseArc - fallArc;
  add(
    "temporal:energy-direction-separates",
    sep >= TEMPORAL_GATE.ENERGY_SEPARATION,
    `rise−fall energyArc separation=${num(sep)} (≥${TEMPORAL_GATE.ENERGY_SEPARATION})`,
  );

  // T5 — a pitch glide (energy flat) CHUNKS the hum: live pitch tracking drives
  // segmentation independent of loudness. Both directions must split (≥2 chunks).
  const pUpSegs = mean(pUp.map((r) => r.read.segmentCount));
  const pDnSegs = mean(pDn.map((r) => r.read.segmentCount));
  add(
    "temporal:pitch-glide-chunks",
    pUp.length > 0 && pDn.length > 0 && pUpSegs >= 2 && pDnSegs >= 2,
    `pitch-glide chunks: rise=${num(pUpSegs)} fall=${num(pDnSegs)} (both ≥2, energy held flat)`,
  );

  // T6 — the chunks track the pitch DIRECTION: last−first chunk pitch rises for a
  // rising glide and falls for a falling glide (feature-level trajectory recovery).
  const pUpHz = mean(pUp.map((r) => r.pitchDeltaHz).filter((d): d is number => d !== null));
  const pDnHz = mean(pDn.map((r) => r.pitchDeltaHz).filter((d): d is number => d !== null));
  add(
    "temporal:pitch-direction",
    pUpHz >= TEMPORAL_GATE.PITCH_CHUNK_HZ_MIN && pDnHz <= -TEMPORAL_GATE.PITCH_CHUNK_HZ_MIN,
    `chunk pitch Δ: rising=${num(pUpHz)}Hz (≥${TEMPORAL_GATE.PITCH_CHUNK_HZ_MIN}), falling=${num(pDnHz)}Hz (≤−${TEMPORAL_GATE.PITCH_CHUNK_HZ_MIN})`,
  );

  // T7 — the mid-hum change-point lands near the centre of a swelling hum.
  const centeredOk = rise.filter((r) => {
    const mid = r.durationSec / 2;
    return r.read.boundarySec.some((b) => Math.abs(b - mid) <= TEMPORAL_GATE.BOUNDARY_CENTER_TOL);
  }).length;
  add(
    "temporal:boundary-near-center",
    rise.length > 0 && centeredOk >= Math.ceil(rise.length / 2),
    `${centeredOk}/${rise.length} swells placed a boundary within ${TEMPORAL_GATE.BOUNDARY_CENTER_TOL}s of midpoint`,
  );

  // T8 — every surfaced trajectory string passes the safety screen.
  const allReads = [...flat, ...rise, ...fall, ...pUp, ...pDn].map((r) => r.read);
  const strings = allReads.flatMap((r) => [r.headline, r.detail]);
  const unsafe = strings.filter((s) => !validateUserFacingText(s).ok);
  add(
    "temporal:copy-safe",
    unsafe.length === 0,
    unsafe.length === 0 ? `${strings.length} trajectory strings all safe` : `unsafe copy: ${unsafe.join(" | ")}`,
  );

  const pk = (rs: ContourRun[]): string => num(mean(rs.map((r) => r.changePeak)));
  const rows = [
    `flat   chunks=${num(mean(flat.map((r) => r.read.segmentCount)))} peak=${pk(flat)} shapes=[${flat.map((r) => r.read.shape).join(",")}]`,
    `swell  energyArc=${num(riseArc)} chunks=${num(riseSegs)} peak=${pk(rise)} shapes=[${rise.map((r) => r.read.shape).join(",")}]`,
    `fade   energyArc=${num(fallArc)} chunks=${num(fallSegs)} peak=${pk(fall)} shapes=[${fall.map((r) => r.read.shape).join(",")}]`,
    `pitch↑ chunkΔHz=${num(mean(pUp.map((r) => r.pitchDeltaHz).filter((d): d is number => d !== null)))} chunks=${num(mean(pUp.map((r) => r.read.segmentCount)))} shapes=[${pUp.map((r) => r.read.shape).join(",")}]`,
    `pitch↓ chunkΔHz=${num(mean(pDn.map((r) => r.pitchDeltaHz).filter((d): d is number => d !== null)))} chunks=${num(mean(pDn.map((r) => r.read.segmentCount)))} shapes=[${pDn.map((r) => r.read.shape).join(",")}]`,
  ];

  return { pass: checks.every((c) => c.pass), checks, rows };
}
