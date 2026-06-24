/**
 * Personality-signature self-calibration — the user's OWN adjustment of their Big Five (OCEAN)
 * signature, keyed per-trait. Same spirit as the diary context + the mood HiTL correction: the
 * acoustic read is a tentative mirror, so the person can nudge any of the five traits to where it
 * actually feels true for them, and that calibration is remembered. LOCAL-ONLY and never synced —
 * it's a self-report, shown back to the person; it overrides the displayed trait value the same way
 * the mood correction overrides the displayed read.
 */
import type { BigFiveKey } from "@hum-ai/personality-signature";

const KEY = (id: string): string => `hum.signature.override.v1.${id}`;

/** trait key → user-set value in [-1, 1]. Sparse: only traits the user has actually adjusted. */
export type OceanOverride = Partial<Record<BigFiveKey, number>>;

export function loadOceanOverride(id: string): OceanOverride {
  try {
    const raw = localStorage.getItem(KEY(id));
    return raw ? (JSON.parse(raw) as OceanOverride) : {};
  } catch {
    return {};
  }
}

export function saveOceanOverride(id: string, override: OceanOverride): void {
  try {
    localStorage.setItem(KEY(id), JSON.stringify(override));
  } catch {
    /* storage unavailable — the adjustment just doesn't persist */
  }
}

export function clearOceanOverride(id: string): void {
  try {
    localStorage.removeItem(KEY(id));
  } catch {
    /* ignore */
  }
}
