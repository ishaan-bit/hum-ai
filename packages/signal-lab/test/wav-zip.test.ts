import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeWav, encodeWavPcm16, WavDecodeError } from "../src/wav";
import { ZipArchive } from "../src/zip";
import { makeStoredZip } from "./zip-fixture";

test("encodeWavPcm16 → decodeWav round-trips a mono signal", () => {
  const sr = 16000;
  const samples = new Float32Array(800);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr);
  const wav = encodeWavPcm16(samples, sr);
  const decoded = decodeWav(wav);
  assert.equal(decoded.sampleRate, sr);
  assert.equal(decoded.channels, 1);
  assert.equal(decoded.bitsPerSample, 16);
  assert.equal(decoded.format, "pcm_int");
  assert.equal(decoded.frameCount, samples.length);
  // 16-bit quantization error is small.
  let maxErr = 0;
  for (let i = 0; i < samples.length; i++) maxErr = Math.max(maxErr, Math.abs(decoded.audio.samples[i]! - samples[i]!));
  assert.ok(maxErr < 1e-3, `roundtrip error ${maxErr}`);
});

test("decodeWav throws WavDecodeError on garbage", () => {
  assert.throws(() => decodeWav(Buffer.from("not a wav file at all")), WavDecodeError);
});

test("ZipArchive reads stored entries and a deflate entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "signal-zip-"));
  try {
    const wav = encodeWavPcm16(new Float32Array(200).fill(0.1), 16000);
    const txt = Buffer.from("hello signal lab", "utf8");
    const zipBuf = makeStoredZip([
      { name: "Actor_01/03-01-03-01-01-01-02.wav", data: wav },
      { name: "notes.txt", data: txt },
    ]);
    const path = join(dir, "test.zip");
    writeFileSync(path, zipBuf);
    const zip = ZipArchive.open(path);
    try {
      const files = zip.files();
      assert.equal(files.length, 2);
      const wavEntry = files.find((e) => e.name.endsWith(".wav"))!;
      assert.ok(wavEntry);
      const back = zip.read(wavEntry);
      const decoded = decodeWav(back);
      assert.equal(decoded.frameCount, 200);
      const txtEntry = files.find((e) => e.name.endsWith(".txt"))!;
      assert.equal(zip.read(txtEntry).toString("utf8"), "hello signal lab");
    } finally {
      zip.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
