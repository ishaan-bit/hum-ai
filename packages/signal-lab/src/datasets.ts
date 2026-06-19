import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AUDIO_DOMAINS,
  DEFAULT_DOMAIN_GAP,
  DOMAIN_GAP_PENALTY,
  type AudioDomain,
  type DomainGap,
} from "@hum-ai/shared-types";
import { DOMAIN_FORBIDDEN_USES, type ModelUse } from "@hum-ai/dataset-registry";
import { rawDatasetDir, manifestsDir, resolveDataDir } from "./paths";
import { ZipArchive } from "./zip";

/**
 * Dataset availability + manifest reconciliation (ADR-0005 governance, honest
 * local availability). This layer NEVER fails because one dataset is incomplete;
 * each dataset gets an honest status, and the rest of the pipeline keys off
 * `usableForFeatureExtraction`.
 *
 * Sources reconciled:
 *  - a tracked catalog (`KNOWN_DATASETS`) grounding each id to a canonical
 *    `AudioDomain` + task family (from `data/processed/model-signal-lab/signal_manifest.json`
 *    and `@hum-ai/dataset-registry`), so governance is available even in CI where
 *    the git-ignored `data/` tree is absent;
 *  - the hand-authored `data/manifests/<id>.manifest.json` (license / declared
 *    uses / notes), when present;
 *  - the actual bytes on disk under `data/raw/<id>/` (archives + readability).
 *
 * Domain gap + penalty come from the authoritative `DEFAULT_DOMAIN_GAP` /
 * `DOMAIN_GAP_PENALTY` (`@hum-ai/shared-types`); governance-forbidden uses come
 * from `DOMAIN_FORBIDDEN_USES` (`@hum-ai/dataset-registry`).
 */

export type MediaExpectation = "audio_archive" | "audio_files" | "annotations_only" | "metadata_only";

export interface KnownDataset {
  readonly id: string;
  readonly name: string;
  readonly audioDomain: AudioDomain;
  readonly taskFamily: string;
  readonly expectation: MediaExpectation;
  /** Archive filenames (relative to data/raw/<id>) that carry audio, if any. */
  readonly audioArchives: readonly string[];
}

/**
 * Catalog of datasets prepared (or planned) under `data/raw/`. Grounded in the
 * signal-lab inventory + registry. Only the entries with locally-present
 * audio/annotations/metadata are listed; access-pending corpora with no bytes are
 * surfaced at runtime if a manifest exists, but are not hard-coded here.
 */
export const KNOWN_DATASETS: readonly KnownDataset[] = [
  {
    id: "ravdess",
    name: "RAVDESS — acted emotional speech & song",
    audioDomain: "acted_speech_emotion",
    taskFamily: "affect_prior",
    expectation: "audio_archive",
    audioArchives: ["Audio_Speech_Actors_01-24.zip", "Audio_Song_Actors_01-24.zip"],
  },
  {
    id: "vocalset",
    name: "VocalSet — singing technique / sustained phonation",
    audioDomain: "singing_or_sustained_phonation",
    taskFamily: "singing_phonation_prior",
    expectation: "audio_archive",
    audioArchives: ["VocalSet11.zip"],
  },
  {
    id: "vocalsound",
    name: "VocalSound — nonverbal vocal bursts (16k)",
    audioDomain: "vocal_burst_or_nonverbal_expression",
    taskFamily: "invalid_nonhum_guard",
    expectation: "audio_archive",
    audioArchives: ["vocalsound_16k.zip"],
  },
  {
    id: "deam",
    name: "DEAM — music valence/arousal annotations",
    audioDomain: "music_emotion",
    taskFamily: "music_regulation_prior",
    expectation: "annotations_only",
    audioArchives: [],
  },
  {
    id: "mtg_jamendo",
    name: "MTG-Jamendo — music mood/theme metadata",
    audioDomain: "music_emotion",
    taskFamily: "music_regulation_prior",
    expectation: "metadata_only",
    audioArchives: [],
  },
  {
    id: "crema_d",
    name: "CREMA-D — acted emotional speech (audio via LFS)",
    audioDomain: "acted_speech_emotion",
    taskFamily: "affect_prior",
    expectation: "audio_files",
    audioArchives: [],
  },
];

export type AvailabilityStatus =
  | "audio_available"
  | "archive_present_unreadable"
  | "annotations_only"
  | "metadata_only"
  | "missing";

export interface PresentArchive {
  readonly path: string;
  readonly sizeMb: number;
  readonly audioEntries: number | null;
  readonly readable: boolean;
}

export interface DatasetAvailability {
  readonly datasetId: string;
  readonly name: string;
  readonly audioDomain: AudioDomain;
  readonly taskFamily: string;
  readonly domainGap: DomainGap;
  readonly domainPenalty: number;
  readonly expectation: MediaExpectation;
  readonly status: AvailabilityStatus;
  readonly usableForFeatureExtraction: boolean;
  readonly archives: readonly PresentArchive[];
  readonly looseAudioFiles: number;
  readonly otherFiles: number;
  readonly governanceForbiddenUse: readonly ModelUse[];
  readonly allowedModelUse: readonly ModelUse[];
  readonly prohibitedModelUse: readonly ModelUse[];
  readonly manifestPresent: boolean;
  readonly license: string | null;
  readonly limitations: readonly string[];
}

interface AuthoredManifest {
  readonly license?: string;
  readonly allowed_model_use?: string[];
  readonly prohibited_model_use?: string[];
  readonly notes?: string;
  readonly domain?: string;
}

const AUDIO_EXTS = new Set([".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac", ".opus"]);
const MODEL_USE_SET = new Set<string>([
  "pretraining",
  "evaluation",
  "recommendation",
  "clinical_prior",
  "affect_prior",
  "hum_finetune",
  "personalization",
  "relapse_tracking",
  "market_research_only",
]);

function asModelUses(values: readonly string[] | undefined): ModelUse[] {
  if (!values) return [];
  return values.filter((v): v is ModelUse => MODEL_USE_SET.has(v));
}

function readAuthoredManifest(datasetId: string, env?: NodeJS.ProcessEnv): AuthoredManifest | null {
  const path = join(manifestsDir(env), `${datasetId}.manifest.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AuthoredManifest;
  } catch {
    return null;
  }
}

function countLooseAudioAndOther(dir: string): { audio: number; other: number } {
  let audio = 0;
  let other = 0;
  const walk = (current: string, depth: number): void => {
    if (depth > 4) return;
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === ".git") continue;
      const full = join(current, name);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(full, depth + 1);
        continue;
      }
      const lower = name.toLowerCase();
      const dot = lower.lastIndexOf(".");
      const ext = dot >= 0 ? lower.slice(dot) : "";
      if (AUDIO_EXTS.has(ext)) audio++;
      else other++;
    }
  };
  walk(dir, 0);
  return { audio, other };
}

function probeArchive(path: string): PresentArchive {
  const sizeMb = Math.round((statSync(path).size / (1024 * 1024)) * 10) / 10;
  try {
    const zip = ZipArchive.open(path);
    try {
      const audioEntries = zip
        .files()
        .filter((e) => AUDIO_EXTS.has(e.name.slice(e.name.lastIndexOf(".")).toLowerCase())).length;
      return { path, sizeMb, audioEntries, readable: true };
    } finally {
      zip.close();
    }
  } catch {
    return { path, sizeMb, audioEntries: null, readable: false };
  }
}

function normalizeDomain(declared: string | undefined, fallback: AudioDomain): AudioDomain {
  if (!declared) return fallback;
  if ((AUDIO_DOMAINS as readonly string[]).includes(declared)) return declared as AudioDomain;
  for (const d of AUDIO_DOMAINS) if (declared.includes(d)) return d;
  return fallback;
}

/** Assess one known dataset against disk + its authored manifest. */
export function assessDataset(known: KnownDataset, env?: NodeJS.ProcessEnv): DatasetAvailability {
  const dir = rawDatasetDir(known.id, env);
  const manifest = readAuthoredManifest(known.id, env);
  const audioDomain = normalizeDomain(manifest?.domain, known.audioDomain);
  const domainGap = DEFAULT_DOMAIN_GAP[audioDomain];
  const domainPenalty = DOMAIN_GAP_PENALTY[domainGap];
  const governanceForbiddenUse = DOMAIN_FORBIDDEN_USES[audioDomain];

  const archives: PresentArchive[] = [];
  if (existsSync(dir)) {
    for (const arc of known.audioArchives) {
      const p = join(dir, arc);
      if (existsSync(p)) archives.push(probeArchive(p));
    }
  }
  const counts = existsSync(dir) ? countLooseAudioAndOther(dir) : { audio: 0, other: 0 };

  const decodableArchive = archives.some((a) => a.readable && (a.audioEntries ?? 0) > 0);
  const hasLooseAudio = counts.audio > 0;
  const dirExists = existsSync(dir);

  let status: AvailabilityStatus;
  if (decodableArchive || hasLooseAudio) status = "audio_available";
  else if (archives.length > 0) status = "archive_present_unreadable";
  else if (dirExists && counts.other > 0) {
    status = known.expectation === "annotations_only" ? "annotations_only" : "metadata_only";
  } else status = "missing";

  const usableForFeatureExtraction = status === "audio_available";

  // Governance-aware allowed/prohibited: prefer the authored manifest, else derive
  // a conservative prior set (every prior use not forbidden for this domain).
  const declaredAllowed = asModelUses(manifest?.allowed_model_use);
  const declaredProhibited = asModelUses(manifest?.prohibited_model_use);
  const allowedModelUse =
    declaredAllowed.length > 0
      ? declaredAllowed.filter((u) => !governanceForbiddenUse.includes(u))
      : (["pretraining", "evaluation", "affect_prior"] as ModelUse[]).filter(
          (u) => !governanceForbiddenUse.includes(u),
        );
  const prohibitedModelUse = Array.from(new Set<ModelUse>([...declaredProhibited, ...governanceForbiddenUse]));

  const limitations: string[] = [];
  if (status === "metadata_only") limitations.push("metadata only — no audio present locally");
  if (status === "annotations_only") limitations.push("annotations only — audio is a separate download");
  if (status === "archive_present_unreadable")
    limitations.push("archive present but not readable as a 32-bit zip (possibly ZIP64 or LFS pointer)");
  if (status === "missing") limitations.push("no local bytes present");
  if (domainGap === "far") limitations.push("far domain gap to hum (penalty 0.45) — affect prior only, never hum truth");
  if (audioDomain === "music_emotion")
    limitations.push("music affect ≠ user affect — recommendation support only, never user-state diagnosis");

  return {
    datasetId: known.id,
    name: known.name,
    audioDomain,
    taskFamily: known.taskFamily,
    domainGap,
    domainPenalty,
    expectation: known.expectation,
    status,
    usableForFeatureExtraction,
    archives,
    looseAudioFiles: counts.audio,
    otherFiles: counts.other,
    governanceForbiddenUse,
    allowedModelUse,
    prohibitedModelUse,
    manifestPresent: manifest !== null,
    license: manifest?.license ?? null,
    limitations,
  };
}

export interface AvailabilityReport {
  readonly dataRoot: string;
  readonly datasets: readonly DatasetAvailability[];
  readonly summary: {
    readonly total: number;
    readonly usable: number;
    readonly usableIds: readonly string[];
    readonly byStatus: Readonly<Record<AvailabilityStatus, number>>;
  };
}

/** Build the full availability report across the known catalog. */
export function buildAvailabilityReport(env?: NodeJS.ProcessEnv): AvailabilityReport {
  const datasets = KNOWN_DATASETS.map((k) => assessDataset(k, env));
  const byStatus: Record<AvailabilityStatus, number> = {
    audio_available: 0,
    archive_present_unreadable: 0,
    annotations_only: 0,
    metadata_only: 0,
    missing: 0,
  };
  for (const d of datasets) byStatus[d.status]++;
  const usable = datasets.filter((d) => d.usableForFeatureExtraction);
  return {
    dataRoot: resolveDataDir(env),
    datasets,
    summary: {
      total: datasets.length,
      usable: usable.length,
      usableIds: usable.map((d) => d.datasetId),
      byStatus,
    },
  };
}
