/**
 * RESEARCH-UPLOAD CHANNEL (Workstream 1) — the ONLY sanctioned raw-audio egress.
 *
 * This is the first and only place raw audio may ever leave the device. It is PHYSICALLY
 * ISOLATED from the derived-sync paths (store.ts / corpus-store.ts / clinical-store.ts):
 * those write derived features to FIRESTORE; this writes the ephemeral waveform to FIREBASE
 * STORAGE, under a study bucket keyed by `studies/{studyId}/raw-audio/{pseudonym}/{captureId}`.
 *
 * GOVERNANCE (load-bearing):
 *   - Gated on `research_audio_upload` consent — the caller MUST check before invoking, and
 *     we re-check defensively here. Default posture is derived-only; raw audio is a separate,
 *     additional opt-in (the model-dev subset / FDA-CE door).
 *   - Taps capture.ts's ephemeral AudioInput buffer BEFORE release — we encode the Float32
 *     PCM to a WAV Blob in-memory and upload it; nothing is persisted on-device.
 *   - The raw audio is keyed ONLY by the participant pseudonym (never email/uid), so it can be
 *     deleted on withdrawal alongside the Firestore data.
 *   - This module NEVER touches Firestore and NEVER imports @hum-ai/screening-model.
 */
import { ref, uploadBytes, deleteObject, listAll } from "firebase/storage";
import type { AudioInput } from "@hum-ai/audio-features";
import { isGranted } from "./consent";
import type { ConsentState } from "@hum-ai/shared-types";
import { getFirebase } from "./firebase";

/** Storage path for one capture's raw audio — pseudonym-keyed so withdrawal can delete it. */
function rawAudioPath(studyId: string, pseudonym: string, captureId: string): string {
  return `studies/${studyId}/raw-audio/${pseudonym}/${captureId}.wav`;
}

/** The prefix that holds ALL of one participant's raw-audio objects (for bulk deletion). */
function participantAudioPrefix(studyId: string, pseudonym: string): string {
  return `studies/${studyId}/raw-audio/${pseudonym}`;
}

/**
 * Encode mono Float32 PCM ([-1,1]) to a 16-bit PCM WAV Blob, entirely in-memory. The decoded
 * buffer from capture.ts is dropped once the Blob is built; nothing is written to disk.
 */
export function pcmToWavBlob(input: AudioInput): Blob {
  const { sampleRate, samples } = input;
  const numFrames = samples.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += bytesPerSample;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export interface RawAudioUploadInput {
  readonly studyId: string;
  readonly participantPseudonym: string;
  readonly captureId: string;
  readonly audio: AudioInput;
  readonly consent: ConsentState;
}

export type RawAudioUploadResult =
  | { readonly status: "uploaded"; readonly path: string }
  | { readonly status: "skipped"; readonly reason: "no_consent" | "no_backend" }
  | { readonly status: "failed"; readonly error: string };

/**
 * Upload one capture's raw audio to the research bucket — the ONLY raw-audio egress.
 *
 * Hard-gated on `research_audio_upload` consent (re-checked here even though the caller
 * checks too); returns `skipped:no_consent` otherwise. Never throws — a failed research
 * upload must never break the on-device read. The waveform is encoded to WAV in-memory and
 * uploaded; the buffer is not retained.
 */
export async function uploadRawAudio(input: RawAudioUploadInput): Promise<RawAudioUploadResult> {
  // Defensive gate: this is the load-bearing consent check for the only raw-audio egress.
  if (!isGranted(input.consent, "research_audio_upload")) {
    return { status: "skipped", reason: "no_consent" };
  }
  const fb = getFirebase();
  if (!fb) return { status: "skipped", reason: "no_backend" };
  try {
    const path = rawAudioPath(input.studyId, input.participantPseudonym, input.captureId);
    const blob = pcmToWavBlob(input.audio);
    await uploadBytes(ref(fb.storage, path), blob, {
      contentType: "audio/wav",
      customMetadata: {
        studyId: input.studyId,
        participantPseudonym: input.participantPseudonym,
        captureId: input.captureId,
      },
    });
    return { status: "uploaded", path };
  } catch (err) {
    console.warn("[research-upload] raw-audio upload failed:", err);
    return { status: "failed", error: (err as Error).message };
  }
}

/**
 * Delete ALL of a participant's raw audio from Storage (right-to-deletion, Storage side).
 * Called by withdrawParticipant alongside the Firestore deletion. Returns whether it
 * completed (true also when there is no backend — nothing to delete).
 */
export async function deleteParticipantAudio(studyId: string, pseudonym: string): Promise<boolean> {
  const fb = getFirebase();
  if (!fb) return true;
  try {
    const dir = ref(fb.storage, participantAudioPrefix(studyId, pseudonym));
    const listing = await listAll(dir);
    await Promise.all(listing.items.map((item) => deleteObject(item)));
    return true;
  } catch (err) {
    console.warn("[research-upload] raw-audio deletion failed:", err);
    return false;
  }
}
