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

/** Synthesize a test hum. Clean hums vary slightly in pitch/seed so the baseline isn't degenerate. */
export function synthesize(kind: SynthKind): AudioInput {
  if (kind === "silence") return synthSilence({ seed: seed() });
  if (kind === "noisy") return synthNoisyHum({ seed: seed(), f0: 150 + Math.random() * 30 });
  return synthHum({ seed: seed(), f0: 150 + Math.random() * 30, vibratoDepth: 0.008 + Math.random() * 0.006 });
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
  try {
    try {
      meterCtx = new AudioContext();
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

    const blob = new Blob(chunks, { type: chunks[0]?.type ?? "audio/webm" });
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new AudioContext();
    try {
      const decoded = await audioCtx.decodeAudioData(arrayBuffer);
      // Copy channel 0 out so we don't retain the decoded buffer.
      const samples = Float32Array.from(decoded.getChannelData(0));
      return { sampleRate: decoded.sampleRate, samples };
    } finally {
      await audioCtx.close();
    }
  } finally {
    if (meterTimer) clearInterval(meterTimer);
    if (meterCtx) await meterCtx.close().catch(() => {});
    for (const track of stream.getTracks()) track.stop();
  }
}
