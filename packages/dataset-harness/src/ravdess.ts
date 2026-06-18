/**
 * Pure RAVDESS filename parser.
 *
 * RAVDESS audio files are named with 7 two-digit fields separated by hyphens:
 *   modality-vocalChannel-emotion-intensity-statement-repetition-actor
 * e.g. `03-01-06-01-02-01-12.wav`
 *
 *   modality:      01 full-AV, 02 video-only, 03 audio-only
 *   vocalChannel:  01 speech, 02 song
 *   emotion:       01 neutral, 02 calm, 03 happy, 04 sad,
 *                  05 angry, 06 fearful, 07 disgust, 08 surprised
 *   intensity:     01 normal, 02 strong (neutral has only normal)
 *   statement:     01 "Kids are talking by the door", 02 "Dogs are sitting by the door"
 *   repetition:    01 first, 02 second
 *   actor:         01-24 (odd = male, even = female)
 *
 * This is research metadata, surfaced factually. The emotion label is the
 * dataset's own categorical annotation, not a Hum AI inference about any person.
 */

export const RAVDESS_DATASET_ID = "ravdess" as const;

export type RavdessModality = "full_av" | "video_only" | "audio_only";
export type RavdessVocalChannel = "speech" | "song";
export type RavdessIntensity = "normal" | "strong";
export type RavdessGender = "male" | "female";

export type RavdessEmotion =
  | "neutral"
  | "calm"
  | "happy"
  | "sad"
  | "angry"
  | "fearful"
  | "disgust"
  | "surprised";

const MODALITY: Record<string, RavdessModality> = {
  "01": "full_av",
  "02": "video_only",
  "03": "audio_only",
};

const VOCAL_CHANNEL: Record<string, RavdessVocalChannel> = {
  "01": "speech",
  "02": "song",
};

const EMOTION: Record<string, RavdessEmotion> = {
  "01": "neutral",
  "02": "calm",
  "03": "happy",
  "04": "sad",
  "05": "angry",
  "06": "fearful",
  "07": "disgust",
  "08": "surprised",
};

const INTENSITY: Record<string, RavdessIntensity> = {
  "01": "normal",
  "02": "strong",
};

/** Structured RAVDESS record parsed from a filename. */
export interface RavdessRecord {
  readonly datasetId: typeof RAVDESS_DATASET_ID;
  readonly modality: RavdessModality;
  readonly vocalChannel: RavdessVocalChannel;
  /** The dataset's categorical emotion annotation (normalized label). */
  readonly emotion: RavdessEmotion;
  readonly intensity: RavdessIntensity;
  /** 1 or 2 — which scripted statement. */
  readonly statement: number;
  /** 1 or 2 — which repetition. */
  readonly repetition: number;
  /** 1-24. */
  readonly actor: number;
  /** Derived from actor parity: odd = male, even = female. */
  readonly gender: RavdessGender;
}

export type RavdessParseError =
  | { ok: false; reason: "empty" }
  | { ok: false; reason: "bad_field_count"; fields: number }
  | { ok: false; reason: "non_numeric_field"; index: number; value: string }
  | { ok: false; reason: "unknown_modality"; value: string }
  | { ok: false; reason: "unknown_vocal_channel"; value: string }
  | { ok: false; reason: "unknown_emotion"; value: string }
  | { ok: false; reason: "unknown_intensity"; value: string }
  | { ok: false; reason: "statement_out_of_range"; value: number }
  | { ok: false; reason: "repetition_out_of_range"; value: number }
  | { ok: false; reason: "actor_out_of_range"; value: number };

export type RavdessParseResult = { ok: true; record: RavdessRecord } | RavdessParseError;

/** Strip a leading directory and any audio extension, leaving the stem. */
function stem(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  return base.replace(/\.[A-Za-z0-9]+$/, "");
}

/**
 * Parse a RAVDESS filename into a structured result. Tolerant of a path prefix
 * and any audio extension. Returns a typed error rather than throwing.
 */
export function parseRavdessFilename(filename: string): RavdessParseResult {
  const name = stem(filename).trim();
  if (name.length === 0) {
    return { ok: false, reason: "empty" };
  }

  const fields = name.split("-");
  if (fields.length !== 7) {
    return { ok: false, reason: "bad_field_count", fields: fields.length };
  }

  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]!;
    if (!/^\d{2}$/.test(f)) {
      return { ok: false, reason: "non_numeric_field", index: i, value: f };
    }
  }

  const [mod, voc, emo, inten, stmt, rep, act] = fields as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const modality = MODALITY[mod];
  if (!modality) return { ok: false, reason: "unknown_modality", value: mod };

  const vocalChannel = VOCAL_CHANNEL[voc];
  if (!vocalChannel) return { ok: false, reason: "unknown_vocal_channel", value: voc };

  const emotion = EMOTION[emo];
  if (!emotion) return { ok: false, reason: "unknown_emotion", value: emo };

  const intensity = INTENSITY[inten];
  if (!intensity) return { ok: false, reason: "unknown_intensity", value: inten };

  const statement = Number(stmt);
  if (statement < 1 || statement > 2) {
    return { ok: false, reason: "statement_out_of_range", value: statement };
  }

  const repetition = Number(rep);
  if (repetition < 1 || repetition > 2) {
    return { ok: false, reason: "repetition_out_of_range", value: repetition };
  }

  const actor = Number(act);
  if (actor < 1 || actor > 24) {
    return { ok: false, reason: "actor_out_of_range", value: actor };
  }

  const gender: RavdessGender = actor % 2 === 1 ? "male" : "female";

  return {
    ok: true,
    record: {
      datasetId: RAVDESS_DATASET_ID,
      modality,
      vocalChannel,
      emotion,
      intensity,
      statement,
      repetition,
      actor,
      gender,
    },
  };
}

/**
 * Convenience: parse and return the record, or `null` for any malformed name.
 * Use `parseRavdessFilename` when you need the typed error reason.
 */
export function parseRavdessOrNull(filename: string): RavdessRecord | null {
  const r = parseRavdessFilename(filename);
  return r.ok ? r.record : null;
}
