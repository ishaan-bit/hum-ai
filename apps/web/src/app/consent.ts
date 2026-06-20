/**
 * Consent state — explicit, scoped, additive, and local-first by default.
 *
 * A brand-new user is granted only `local_processing` (on-device extraction + baseline).
 * Everything that leaves the device is opt-in:
 *   - `derived_feature_sync`    → back up derived-only summaries to Firebase
 *   - `clinical_risk_surfacing` → unlock the consent-gated clinical head + escalation copy
 *                                 + the non-diagnostic longitudinal-monitoring panel (ADR-0006)
 *
 * Persisted in localStorage; never synced (consent is a device-local posture here).
 */
import {
  defaultConsent,
  hasConsent,
  asIsoTimestamp,
  type ConsentScope,
  type ConsentState,
} from "@hum-ai/shared-types";

const KEY = "hum.consent.v1";

/** The two optional scopes this UI exposes as toggles. */
export const TOGGLEABLE_SCOPES = ["derived_feature_sync", "clinical_risk_surfacing"] as const;
export type ToggleableScope = (typeof TOGGLEABLE_SCOPES)[number];

function nowIso() {
  return asIsoTimestamp(new Date().toISOString());
}

export function loadConsent(): ConsentState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultConsent(nowIso());
    const parsed = JSON.parse(raw) as { grantedScopes?: string[] };
    const scopes = new Set<ConsentScope>(["local_processing"]);
    for (const s of parsed.grantedScopes ?? []) scopes.add(s as ConsentScope);
    return { grantedScopes: [...scopes], updatedAt: nowIso() };
  } catch {
    return defaultConsent(nowIso());
  }
}

/** Set one optional scope on/off and persist. `local_processing` is always retained. */
export function setScope(current: ConsentState, scope: ToggleableScope, granted: boolean): ConsentState {
  const scopes = new Set<ConsentScope>(current.grantedScopes);
  scopes.add("local_processing");
  if (granted) scopes.add(scope);
  else scopes.delete(scope);
  const next: ConsentState = { grantedScopes: [...scopes], updatedAt: nowIso() };
  try {
    localStorage.setItem(KEY, JSON.stringify({ grantedScopes: next.grantedScopes }));
  } catch {
    /* storage may be unavailable (private mode) — consent stays in memory */
  }
  return next;
}

export function isGranted(consent: ConsentState, scope: ConsentScope): boolean {
  return hasConsent(consent, scope);
}
