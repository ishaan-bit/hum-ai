import type { UnitInterval } from "./numeric";

/**
 * Input modalities, following the TriSense three-stream design
 * (`trisense_architecture`): visual face, vocal audio, and linguistic text.
 *
 * For Hum, `audio` is the primary and usually only modality (the 12-second hum).
 * `face` and `text` are optional companions reserved for the multimodal future
 * path — most hum sessions are audio-only.
 */
export const MODALITIES = ["audio", "face", "text"] as const;
export type Modality = (typeof MODALITIES)[number];

/**
 * Per-modality reliability weight in [0, 1], used by the fusion meta-learner to
 * down-weight noisy or missing channels (the "modality dominance" problem from
 * the TriSense paper). A value of 0 means the modality is effectively absent.
 */
export type ModalityReliability = Record<Modality, UnitInterval>;

export function emptyModalityReliability(): ModalityReliability {
  return { audio: 0, face: 0, text: 0 };
}
