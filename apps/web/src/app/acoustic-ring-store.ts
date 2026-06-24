/**
 * Acoustic axis ring — the user's recent RAW ACOUSTIC valence/arousal reads, kept on-device so
 * the displayed read can be re-referenced against THEIR own usual (see the orchestrator's
 * `reReferenceDisplayRead`). This is what cancels the fixed per-person+mic offset that otherwise
 * pins every hum to the same zone.
 *
 * Why a dedicated ring (not the relapse history): the relapse ring stores the PERSONALIZED
 * dimensional point (damped toward origin), whereas the re-reference must subtract the user's own
 * RAW acoustic centre — so we keep the transparent `axis.<axis>.acousticValue` of each hum here.
 * Local-only and derived (two numbers in [-1,1]); same privacy posture as the diary-context store.
 */
import type { AcousticAxisSample } from "@hum-ai/orchestrator";

const KEY = (id: string): string => `hum.acousticAxis.v1.${id}`;
/** A "last couple of months" window — enough for a robust personal centre + spread, bounded. */
export const ACOUSTIC_RING_MAX = 64;

export function loadAcousticRing(id: string): AcousticAxisSample[] {
  try {
    const raw = localStorage.getItem(KEY(id));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (s): s is AcousticAxisSample =>
          !!s && typeof s === "object" &&
          Number.isFinite((s as AcousticAxisSample).valence) &&
          Number.isFinite((s as AcousticAxisSample).arousal),
      )
      .slice(-ACOUSTIC_RING_MAX);
  } catch {
    return [];
  }
}

/** Append one raw acoustic read and persist the bounded ring (most-recent last). Pure-ish (returns the new ring). */
export function appendAcousticRing(id: string, ring: readonly AcousticAxisSample[], sample: AcousticAxisSample): AcousticAxisSample[] {
  const next = [...ring, { valence: sample.valence, arousal: sample.arousal }].slice(-ACOUSTIC_RING_MAX);
  try {
    localStorage.setItem(KEY(id), JSON.stringify(next));
  } catch {
    /* storage unavailable — in-memory only for this session */
  }
  return next;
}

export function clearAcousticRing(id: string): void {
  try {
    localStorage.removeItem(KEY(id));
  } catch {
    /* ignore */
  }
}
