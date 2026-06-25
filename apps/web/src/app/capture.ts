/**
 * Hum capture — on-device only. Either record a real ~12s hum from the microphone
 * (decoded to mono Float32 PCM, never uploaded) or synthesize a deterministic test hum
 * in code (no mic permission needed). Both yield the SAME `AudioInput` contract that the
 * spine consumes; the raw samples never leave this module — only derived features flow on.
 *
 * Recording fix (redo): the mic stream is opened with the browser's noise suppression,
 * echo cancellation, and auto-gain DISABLED. A sustained hum is a stationary tone — exactly
 * what noise suppression attenuates — so leaving those on was gating real hums below the
 * quality threshold. While recording, a Web Audio `AnalyserNode` drives a LIVE meter
 * (level + detected pitch) so you can see the hum registering in real time.
 */
import {
  synthHum,
  synthNoisyHum,
  synthSilence,
  type AudioInput,
} from "@hum-ai/audio-features";

export type SynthKind = "clean" | "noisy" | "silence";

/** A small random integer seed so repeated synthetic hums vary (a real baseline has spread). */
function seed(): number {
  return Math.floor(Math.random() * 1e9);
}

/**
 * A realistic MOOD PALETTE for synthetic "clean" hums. The old synth used `targetPeak 0.5`
 * (RMS ≈ 0.28) with a single mid pitch — far hotter than any real hum, which saturated the
 * arousal read so EVERY simulated hum came back "restless and activated". These specs sit in a
 * realistic loudness band (RMS ≈ 0.05–0.11) and vary the cues a sustained tone can actually carry
 * — loudness, pitch height, harmonic brightness, vibrato and a little noise — so the demo path
 * spans calm / warm / steady / bright / low instead of one pinned zone. (Verified in sim-lab's
 * synth-probe.)
 */
interface MoodSpec {
  readonly mood: string;
  readonly f0: number;
  readonly harmonics: readonly number[];
  readonly targetPeak: number;
  readonly vibratoDepth: number;
  readonly noiseRms: number;
}
const CLEAN_PALETTE: readonly MoodSpec[] = [
  { mood: "calm", f0: 196, harmonics: [1, 0.32, 0.1], targetPeak: 0.1, vibratoDepth: 0.012, noiseRms: 0.0015 },
  { mood: "warm", f0: 210, harmonics: [1, 0.45, 0.18], targetPeak: 0.12, vibratoDepth: 0.016, noiseRms: 0.0015 },
  { mood: "steady", f0: 168, harmonics: [1, 0.5, 0.25, 0.12], targetPeak: 0.13, vibratoDepth: 0.011, noiseRms: 0.0016 },
  { mood: "bright", f0: 232, harmonics: [1, 0.6, 0.34, 0.16], targetPeak: 0.2, vibratoDepth: 0.02, noiseRms: 0.0015 },
  { mood: "low", f0: 122, harmonics: [1, 0.28, 0.08], targetPeak: 0.07, vibratoDepth: 0.004, noiseRms: 0.0022 },
  { mood: "tense", f0: 150, harmonics: [1, 0.7, 0.45, 0.25], targetPeak: 0.18, vibratoDepth: 0.005, noiseRms: 0.004 },
];

/** Build one hum from a palette spec, jittered by `salt` so repeats aren't byte-identical. */
function synthMoodHum(spec: MoodSpec, salt: number): AudioInput {
  const jit = ((salt % 7) - 3) * 0.01;
  return synthHum({
    seed: seed(),
    f0: spec.f0 * (1 + jit * 0.4),
    harmonics: spec.harmonics,
    targetPeak: spec.targetPeak * (1 + jit),
    vibratoDepth: spec.vibratoDepth,
    noiseRms: spec.noiseRms,
  });
}

/** The number of distinct moods the demo seed walks through. */
export const CLEAN_PALETTE_SIZE = CLEAN_PALETTE.length;

/** A deterministic palette-walk hum for the demo seeder, so a seeded week spans real moods. */
export function synthesizeMood(index: number): AudioInput {
  const spec = CLEAN_PALETTE[index % CLEAN_PALETTE.length]!;
  return synthMoodHum(spec, index);
}

/** Synthesize a test hum. Clean hums draw from a realistic mood palette so they aren't degenerate. */
export function synthesize(kind: SynthKind): AudioInput {
  if (kind === "silence") return synthSilence({ seed: seed() });
  if (kind === "noisy") return synthNoisyHum({ seed: seed(), f0: 150 + Math.random() * 30 });
  const spec = CLEAN_PALETTE[Math.floor(Math.random() * CLEAN_PALETTE.length)]!;
  return synthMoodHum(spec, Math.floor(Math.random() * 7));
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Live capture telemetry, emitted ~20×/sec while recording. */
export interface CaptureLevel {
  /** Elapsed fraction of the target duration, [0,1]. */
  readonly fraction: number;
  /** Instantaneous RMS level mapped to [0,1] for a meter bar. */
  readonly level: number;
  /** Detected pitch in Hz while voiced, or null when no clear pitch this frame. */
  readonly pitchHz: number | null;
  /** Whether the current level is loud enough to read as an active hum. */
  readonly voiced: boolean;
}

export interface RecordOptions {
  readonly seconds?: number;
  /** Called ~10×/sec with elapsed fraction in [0,1] during recording. */
  readonly onProgress?: (fraction: number) => void;
  /** Called ~20×/sec with the live level + detected pitch (drives the meter). */
  readonly onLevel?: (level: CaptureLevel) => void;
}

/** Constraints that turn OFF the browser DSP that would gate a sustained hum. */
const RAW_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  noiseSuppression: false,
  echoCancellation: false,
  autoGainControl: false,
  channelCount: 1,
};

/**
 * Prime microphone permission from a user gesture (the onboarding consent step), so the OS
 * prompt appears in a warm, explained context instead of the first time someone taps Hum.
 * Opens the stream only to trigger the prompt, then immediately stops every track — it never
 * records and keeps no audio. Returns whether access was granted (false on deny / no API),
 * and never throws so the caller can proceed regardless.
 */
export async function primeMicrophone(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO_CONSTRAINTS });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch {
    return false;
  }
}

/** RMS of a time-domain frame in [-1,1]. */
function frameRms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i]! * buf[i]!;
  return Math.sqrt(s / buf.length);
}

/**
 * Quick autocorrelation pitch estimate for the live meter (70–500 Hz). Deliberately
 * lightweight — the authoritative pitch is computed by the DSP extractor downstream.
 */
function estimatePitch(buf: Float32Array, sampleRate: number): number | null {
  const minLag = Math.floor(sampleRate / 500);
  const maxLag = Math.min(buf.length - 1, Math.ceil(sampleRate / 70));
  let mean = 0;
  for (let i = 0; i < buf.length; i++) mean += buf[i]!;
  mean /= buf.length;
  let r0 = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i]! - mean;
    r0 += v * v;
  }
  if (r0 < 1e-6) return null;
  let bestLag = -1;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i < buf.length - lag; i++) acc += (buf[i]! - mean) * (buf[i + lag]! - mean);
    const r = acc / r0;
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  if (bestLag <= 0 || best < 0.5) return null;
  return sampleRate / bestLag;
}

/**
 * Record from the microphone for `seconds`, decode to mono Float32 PCM, and return an
 * `AudioInput`. Throws if mic permission is denied or the browser lacks the APIs — the
 * caller should fall back to {@link synthesize}. The raw audio is decoded locally and
 * dropped after features are computed; nothing is persisted or transmitted.
 */
export async function recordHum(opts: RecordOptions = {}): Promise<AudioInput> {
  const seconds = opts.seconds ?? 12;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("Microphone capture is not supported in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: RAW_AUDIO_CONSTRAINTS });
  // Live meter: tap the same stream with an AnalyserNode (does not affect the recording).
  let meterCtx: AudioContext | null = null;
  let meterTimer: ReturnType<typeof setInterval> | null = null;
  // Interruption guard: backgrounding (app switch, screen lock) or an incoming call freezes the
  // page and cuts the mic mid-record on iOS — the resulting buffer is truncated/silent and would
  // be read as a confusing "didn't catch a hum". Flag it so we fail with a clear, kind retry
  // message instead. `mute`/`ended` on the live track catches a mid-stream device loss too.
  let interrupted = false;
  const markInterrupted = (): void => {
    if (typeof document === "undefined" || document.visibilityState === "hidden") interrupted = true;
  };
  const track0 = stream.getAudioTracks()[0];
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", markInterrupted);
  if (typeof window !== "undefined") window.addEventListener("pagehide", markInterrupted);
  track0?.addEventListener("ended", () => { interrupted = true; });
  try {
    try {
      meterCtx = new AudioContext();
      // iOS/WKWebView creates the context 'suspended'; resume inside this gesture-initiated
      // call so the AnalyserNode produces real data and the live orb visualizer animates.
      if (meterCtx.state === "suspended") await meterCtx.resume();
      const source = meterCtx.createMediaStreamSource(stream);
      const analyser = meterCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const timeBuf = new Float32Array(analyser.fftSize);
      const sr = meterCtx.sampleRate;
      const startedMeter = performance.now();
      meterTimer = setInterval(() => {
        analyser.getFloatTimeDomainData(timeBuf);
        const rms = frameRms(timeBuf);
        const level = Math.min(1, rms / 0.18); // ~0.18 RMS reads as a strong hum
        const voiced = rms > 0.012;
        opts.onLevel?.({
          fraction: Math.min(1, (performance.now() - startedMeter) / (seconds * 1000)),
          level,
          pitchHz: voiced ? estimatePitch(timeBuf, sr) : null,
          voiced,
        });
      }, 50);
    } catch {
      // Meter is best-effort; recording still proceeds without it.
    }

    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    });
    const stopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve());
    });

    recorder.start();
    const startedAt = performance.now();
    const tick = setInterval(() => {
      opts.onProgress?.(Math.min(1, (performance.now() - startedAt) / (seconds * 1000)));
    }, 100);
    await delay(seconds * 1000);
    clearInterval(tick);
    opts.onProgress?.(1);
    recorder.stop();
    await stopped;

    // The page was backgrounded / the call interrupted us mid-record → the buffer is unreliable.
    if (interrupted) {
      throw new Error("recording interrupted — the app left the foreground. Tap Hum to try again.");
    }
    const blob = new Blob(chunks, { type: chunks[0]?.type ?? "audio/webm" });
    if (blob.size === 0) {
      throw new Error("no audio was captured. Check the mic is allowed, then tap Hum to try again.");
    }
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new AudioContext();
    try {
      const decoded = await audioCtx.decodeAudioData(arrayBuffer);
      // Copy channel 0 out so we don't retain the decoded buffer.
      const samples = Float32Array.from(decoded.getChannelData(0));
      // A usable read needs a couple of seconds of signal; anything shorter is an interruption.
      if (samples.length < decoded.sampleRate * 2) {
        throw new Error("that recording was too short to read. Tap Hum and hold the note a few seconds.");
      }
      return { sampleRate: decoded.sampleRate, samples };
    } finally {
      await audioCtx.close().catch(() => {});
    }
  } finally {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", markInterrupted);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", markInterrupted);
    if (meterTimer) clearInterval(meterTimer);
    if (meterCtx) await meterCtx.close().catch(() => {});
    for (const track of stream.getTracks()) track.stop();
  }
}
