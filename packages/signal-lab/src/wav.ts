import type { AudioInput } from "@hum-ai/audio-features";

/**
 * Minimal, dependency-free RIFF/WAVE decoder.
 *
 * Decodes a WAV byte buffer into the exact `AudioInput` shape the extractor
 * expects (`{ sampleRate, samples: Float32Array }`, mono, [-1,1]). Supports the
 * formats present in the prepared public datasets:
 *  - PCM integer  (fmt code 1): 8 / 16 / 24 / 32-bit
 *  - IEEE float   (fmt code 3): 32-bit
 *  - WAVE_FORMAT_EXTENSIBLE (fmt code 0xFFFE): sub-format read from the fmt chunk.
 * Multi-channel audio is downmixed to mono by averaging channels (the extractor
 * consumes channel-0-equivalent mono PCM; averaging is the conservative downmix).
 *
 * This is decode-only and stays on-device: the decoded buffer is ephemeral, fed
 * straight to `computeFeatures`, and never persisted (DEPENDENCY_POLICY: no audio
 * library; raw audio is never stored — see ADR-0005 / privacy posture).
 */

export class WavDecodeError extends Error {
  constructor(message: string) {
    super(`WAV decode failed: ${message}`);
    this.name = "WavDecodeError";
  }
}

export interface WavInfo {
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitsPerSample: number;
  readonly format: "pcm_int" | "ieee_float";
  readonly frameCount: number;
}

interface ParsedWav extends WavInfo {
  readonly audio: AudioInput;
}

const FMT_PCM = 1;
const FMT_FLOAT = 3;
const FMT_EXTENSIBLE = 0xfffe;

function toBuffer(bytes: Uint8Array | Buffer): Buffer {
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Read a 24-bit little-endian signed sample. */
function readInt24LE(buf: Buffer, off: number): number {
  const v = buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16);
  return v & 0x800000 ? v - 0x1000000 : v;
}

/**
 * Decode a WAV buffer to `AudioInput` (+ metadata). Throws `WavDecodeError` on a
 * malformed or unsupported file so a single bad entry can be skipped, not crash
 * the batch.
 */
export function decodeWav(bytes: Uint8Array | Buffer): ParsedWav {
  const buf = toBuffer(bytes);
  if (buf.length < 12) throw new WavDecodeError("buffer too small for a RIFF header");
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new WavDecodeError("missing RIFF tag");
  if (buf.toString("ascii", 8, 12) !== "WAVE") throw new WavDecodeError("missing WAVE tag");

  let fmtFound = false;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataLength = 0;

  // Walk chunks starting after the 12-byte RIFF/WAVE header.
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      if (body + 16 > buf.length) throw new WavDecodeError("truncated fmt chunk");
      audioFormat = buf.readUInt16LE(body);
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
      if (audioFormat === FMT_EXTENSIBLE && size >= 26) {
        // The real format is the first 2 bytes of the SubFormat GUID.
        audioFormat = buf.readUInt16LE(body + 24);
      }
      fmtFound = true;
    } else if (id === "data") {
      dataOffset = body;
      // Some encoders write 0/0xFFFFFFFF; clamp to the remaining buffer.
      dataLength = Math.min(size, buf.length - body);
    }
    // Chunks are word-aligned (pad byte when size is odd).
    pos = body + size + (size & 1);
    if (dataOffset >= 0 && fmtFound) break;
  }

  if (!fmtFound) throw new WavDecodeError("no fmt chunk");
  if (dataOffset < 0) throw new WavDecodeError("no data chunk");
  if (channels <= 0) throw new WavDecodeError(`invalid channel count ${channels}`);
  if (!(sampleRate > 0)) throw new WavDecodeError(`invalid sample rate ${sampleRate}`);

  const isFloat = audioFormat === FMT_FLOAT;
  const isPcm = audioFormat === FMT_PCM;
  if (!isFloat && !isPcm) throw new WavDecodeError(`unsupported audio format code ${audioFormat}`);

  const bytesPerSample = bitsPerSample >> 3;
  if (bytesPerSample <= 0) throw new WavDecodeError(`invalid bitsPerSample ${bitsPerSample}`);
  const frameSize = bytesPerSample * channels;
  const frameCount = Math.floor(dataLength / frameSize);
  if (frameCount <= 0) throw new WavDecodeError("no audio frames");

  const out = new Float32Array(frameCount);
  const intScale = 1 / (2 ** (bitsPerSample - 1));

  for (let f = 0; f < frameCount; f++) {
    let acc = 0;
    const base = dataOffset + f * frameSize;
    for (let c = 0; c < channels; c++) {
      const off = base + c * bytesPerSample;
      let s: number;
      if (isFloat) {
        s = bitsPerSample === 64 ? buf.readDoubleLE(off) : buf.readFloatLE(off);
      } else if (bitsPerSample === 8) {
        // 8-bit PCM is unsigned, centered at 128.
        s = (buf[off]! - 128) / 128;
      } else if (bitsPerSample === 16) {
        s = buf.readInt16LE(off) * intScale;
      } else if (bitsPerSample === 24) {
        s = readInt24LE(buf, off) * intScale;
      } else if (bitsPerSample === 32) {
        s = buf.readInt32LE(off) * intScale;
      } else {
        throw new WavDecodeError(`unsupported PCM bit depth ${bitsPerSample}`);
      }
      acc += s;
    }
    out[f] = acc / channels;
  }

  return {
    sampleRate,
    channels,
    bitsPerSample,
    format: isFloat ? "ieee_float" : "pcm_int",
    frameCount,
    audio: { sampleRate, samples: out },
  };
}

/**
 * Encode a mono Float32 signal as a 16-bit PCM WAV buffer. Only used by tests and
 * tooling to exercise the decoder without committing any audio file (the
 * forbidden-files QA gate blocks tracked .wav). Never used in the inference path.
 */
export function encodeWavPcm16(samples: Float32Array | readonly number[], sampleRate: number): Buffer {
  const n = samples.length;
  const dataLen = n * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(FMT_PCM, 20);
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] as number));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
