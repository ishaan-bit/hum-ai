import { createHash } from "node:crypto";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { computeFeatures, type AcousticFeatures } from "@hum-ai/audio-features";
import { parseRavdessOrNull } from "@hum-ai/dataset-harness";
import type { FusionLabel } from "@hum-ai/affect-model-contracts";
import { ZipArchive, type ZipEntry } from "./zip";
import { decodeWav } from "./wav";
import { rawDatasetDir } from "./paths";
import { RAVDESS_EMOTION_MAPPING, fusionLabelForEmotion } from "./labels";
import type { DatasetAvailability } from "./datasets";

/**
 * Feature extraction for pretraining. Reads audio zip-direct (no extraction into
 * the repo), runs the REAL extractor `computeFeatures` from `@hum-ai/audio-features`
 * (never a second extractor), and emits one signal row per sample. Rows mirror the
 * existing `data/processed/model-signal-lab/combined.signals.jsonl` conventions but
 * carry REAL extracted `AcousticFeatures` (`modelSource: hum_dsp_extractor`) plus
 * the harmonized fusion-label target.
 */

const AUDIO_EXTS = new Set([".wav"]); // only WAV is decodable dependency-free today

/**
 * AppleDouble / macOS resource-fork junk. The VocalSound zip was authored on
 * macOS and carries a `__MACOSX/…/._<name>.wav` 212-byte resource fork next to
 * every real `…/<name>.wav` — so ~half its `.wav` entries are non-audio metadata
 * that (a) fail RIFF decoding and (b) would otherwise burn the sampling budget and
 * inflate the "decode failure" count. These are NOT real decode failures; they are
 * non-audio entries and must be excluded before sampling.
 */
function isAppleDoubleJunk(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith("__macosx/") || lower.includes("/__macosx/")) return true;
  const base = name.slice(name.lastIndexOf("/") + 1);
  return base.startsWith("._");
}

export interface SignalRow {
  readonly signalId: string;
  readonly sourceDataset: string;
  readonly sourceSampleId: string;
  readonly audioDomain: string;
  readonly taskFamily: string;
  readonly labelFamily: "categorical_emotion" | "none";
  /** The dataset's own annotation (e.g. RAVDESS emotion), or null. */
  readonly sourceLabel: string | null;
  /** Harmonized training target in FUSION_LABELS, or null (unlabeled / excluded). */
  readonly fusionLabel: FusionLabel | null;
  readonly mappingStrength: string | null;
  /** Grouping key for leakage-safe CV (RAVDESS actor); null if unknown. */
  readonly group: string | null;
  readonly domainGap: string;
  readonly domainPenalty: number;
  readonly modelSource: string;
  readonly features: AcousticFeatures;
  readonly extra?: Readonly<Record<string, string | number | null>>;
}

export interface ExtractionSummary {
  readonly datasetId: string;
  readonly status: string;
  readonly archivesRead: number;
  readonly entriesSeen: number;
  readonly decoded: number;
  readonly featureRows: number;
  readonly labeledRows: number;
  readonly excludedByMapping: number;
  readonly decodeFailures: number;
  readonly parseFailures: number;
  /** Non-audio AppleDouble/`__MACOSX` entries excluded before sampling (not failures). */
  readonly junkEntriesSkipped: number;
  readonly capped: boolean;
  readonly perFusionLabel: Readonly<Record<string, number>>;
  readonly notes: readonly string[];
}

export interface ExtractOptions {
  /** Hard cap on rows produced per dataset (bounds runtime + artifact size). */
  readonly maxPerDataset?: number;
  /** Deterministic stride sampling when a dataset exceeds the cap. */
  readonly env?: NodeJS.ProcessEnv;
  readonly onRow?: (row: SignalRow) => void;
  readonly onProgress?: (datasetId: string, done: number, total: number) => void;
}

function shortId(dataset: string, relPath: string): string {
  return `${dataset}:${createHash("sha1").update(relPath).digest("hex").slice(0, 12)}`;
}

function isWav(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && AUDIO_EXTS.has(name.slice(dot).toLowerCase());
}

/**
 * Best-effort WITHIN-corpus speaker/singer group from an entry path, so grouped
 * CV is leakage-safe even on the unlabeled corpora (used by the cross-corpus
 * domain experiment). RAVDESS keeps its actor group (parsed separately).
 *  - vocalset:   `FULL/<female9|male3>/…`  → singer id
 *  - vocalsound: `audio_16k/<f1236|m0805>_…` → speaker id
 * Returns null when no id can be parsed (caller falls back to a per-dataset key).
 */
function speakerGroupFor(datasetId: string, name: string): string | null {
  if (datasetId === "vocalset") {
    const seg = name.split("/").find((p) => /^(male|female)\d+$/i.test(p));
    return seg ? `singer_${seg.toLowerCase()}` : null;
  }
  if (datasetId === "vocalsound") {
    const base = name.slice(name.lastIndexOf("/") + 1);
    const m = base.match(/^([fm]\d+)_/i);
    return m ? `spk_${m[1]!.toLowerCase()}` : null;
  }
  return null;
}

/** Even-stride sample down to `cap` items (deterministic, preserves coverage). */
function strideSample<T>(items: readonly T[], cap: number): { sampled: T[]; capped: boolean } {
  if (items.length <= cap) return { sampled: [...items], capped: false };
  const step = items.length / cap;
  const out: T[] = [];
  for (let i = 0; i < cap; i++) out.push(items[Math.floor(i * step)]!);
  return { sampled: out, capped: true };
}

/**
 * Extract feature rows for one dataset. Never throws on a single bad entry — a
 * decode/parse failure is counted and skipped. Returns the rows + an honest
 * summary. Unlabeled datasets (vocalset/vocalsound) still extract features (for
 * distribution / domain artifacts) with `fusionLabel: null`.
 */
export function extractDataset(av: DatasetAvailability, opts: ExtractOptions = {}): {
  rows: SignalRow[];
  summary: ExtractionSummary;
} {
  const cap = opts.maxPerDataset ?? 6000;
  const notes: string[] = [];
  const rows: SignalRow[] = [];
  const perFusionLabel: Record<string, number> = {};
  let entriesSeen = 0;
  let decoded = 0;
  let decodeFailures = 0;
  let parseFailures = 0;
  let excludedByMapping = 0;
  let labeledRows = 0;
  let archivesRead = 0;
  let junkEntriesSkipped = 0;

  if (!av.usableForFeatureExtraction) {
    return {
      rows,
      summary: {
        datasetId: av.datasetId,
        status: av.status,
        archivesRead: 0,
        entriesSeen: 0,
        decoded: 0,
        featureRows: 0,
        labeledRows: 0,
        excludedByMapping: 0,
        decodeFailures: 0,
        parseFailures: 0,
        junkEntriesSkipped: 0,
        capped: false,
        perFusionLabel,
        notes: [`skipped — status '${av.status}', no decodable audio present`],
      },
    };
  }

  const dir = rawDatasetDir(av.datasetId, opts.env);
  const isRavdess = av.datasetId === "ravdess";

  // Collect WAV entries across all readable archives (with their archive handle).
  const archiveHandles: { zip: ZipArchive; entries: ZipEntry[] }[] = [];
  for (const arc of av.archives) {
    if (!arc.readable) continue;
    const p = arc.path && existsSync(arc.path) ? arc.path : join(dir, arc.path);
    try {
      const zip = ZipArchive.open(p);
      const wavLike = zip.files().filter((e) => isWav(e.name));
      const entries = wavLike.filter((e) => !isAppleDoubleJunk(e.name));
      junkEntriesSkipped += wavLike.length - entries.length;
      archiveHandles.push({ zip, entries });
      archivesRead++;
    } catch (e) {
      notes.push(`archive open failed: ${arc.path} (${(e as Error).message})`);
    }
  }

  try {
    // Build a flat list of (archiveIndex, entry) then stride-sample to the cap.
    const flat: { ai: number; entry: ZipEntry }[] = [];
    for (let ai = 0; ai < archiveHandles.length; ai++) {
      for (const entry of archiveHandles[ai]!.entries) flat.push({ ai, entry });
    }
    const { sampled, capped } = strideSample(flat, cap);
    const total = sampled.length;

    for (let i = 0; i < sampled.length; i++) {
      const { ai, entry } = sampled[i]!;
      entriesSeen++;
      let features: AcousticFeatures;
      try {
        const bytes = archiveHandles[ai]!.zip.read(entry);
        const wav = decodeWav(bytes);
        features = computeFeatures(wav.audio);
        decoded++;
      } catch {
        decodeFailures++;
        continue;
      }

      let sourceLabel: string | null = null;
      let fusionLabel: FusionLabel | null = null;
      let mappingStrength: string | null = null;
      let group: string | null = null;
      const extra: Record<string, string | number | null> = {};

      if (isRavdess) {
        const rec = parseRavdessOrNull(entry.name);
        if (!rec) {
          parseFailures++;
        } else {
          sourceLabel = rec.emotion;
          fusionLabel = fusionLabelForEmotion(rec.emotion);
          mappingStrength = RAVDESS_EMOTION_MAPPING[rec.emotion].strength;
          group = `actor_${rec.actor}`;
          extra.vocalChannel = rec.vocalChannel;
          extra.intensity = rec.intensity;
          extra.gender = rec.gender;
          if (fusionLabel === null) excludedByMapping++;
        }
      } else {
        group = speakerGroupFor(av.datasetId, entry.name);
      }

      const row: SignalRow = {
        signalId: shortId(av.datasetId, entry.name),
        sourceDataset: av.datasetId,
        sourceSampleId: entry.name,
        audioDomain: av.audioDomain,
        taskFamily: av.taskFamily,
        labelFamily: isRavdess ? "categorical_emotion" : "none",
        sourceLabel,
        fusionLabel,
        mappingStrength,
        group,
        domainGap: av.domainGap,
        domainPenalty: av.domainPenalty,
        modelSource: "hum_dsp_extractor",
        features,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      };
      rows.push(row);
      if (fusionLabel) {
        labeledRows++;
        perFusionLabel[fusionLabel] = (perFusionLabel[fusionLabel] ?? 0) + 1;
      }
      opts.onRow?.(row);
      if (opts.onProgress && (i % 100 === 0 || i === total - 1)) opts.onProgress(av.datasetId, i + 1, total);
    }

    if (capped) notes.push(`capped to ${cap} rows (dataset had ${flat.length} real WAV entries)`);
    if (junkEntriesSkipped > 0)
      notes.push(`skipped ${junkEntriesSkipped} AppleDouble/__MACOSX non-audio entries (not decode failures)`);

    return {
      rows,
      summary: {
        datasetId: av.datasetId,
        status: av.status,
        archivesRead,
        entriesSeen,
        decoded,
        featureRows: rows.length,
        labeledRows,
        excludedByMapping,
        decodeFailures,
        parseFailures,
        junkEntriesSkipped,
        capped,
        perFusionLabel,
        notes,
      },
    };
  } finally {
    for (const h of archiveHandles) h.zip.close();
  }
}
