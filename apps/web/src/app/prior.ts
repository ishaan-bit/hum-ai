/**
 * Browser loader for the trained affect PRIOR.
 *
 * Mirrors signal-lab's Node `loadLearnedAffectPrior` (runtime-bridge.ts) WITHOUT its
 * `node:fs` machinery: we `fetch` the model JSON + manifest that the build staged under
 * `/models/`, then construct the SAME `LearnedAffectPriorExpert` + descriptor in memory.
 * Only the two PURE signal-lab modules are imported (`./model`, `./expert`) — never the
 * Node-tainted barrel.
 *
 * Governance (ADR-0005): this is a far-domain acted-speech prior (RAVDESS), never hum
 * truth, never clinical. Its 6-class affect target did NOT pass the 80% promotion gate
 * (balanced acc ~47.9%); it is fused under the far-domain cap 0.45 and reported honestly
 * via `gatePassed=false`. When the artifacts are absent the loader returns null and the
 * spine runs its honest heuristic fallback.
 */
import { deserializeModel } from "@hum-ai/signal-lab/model";
import { LearnedAffectPriorExpert } from "@hum-ai/signal-lab/expert";
import { buildAffectAxisPrior, AFFECT_PRIOR_FAR_DOMAIN_CAP, type AxisPriorMeta as SignalAxisPriorMeta } from "@hum-ai/signal-lab/axis-prior";
import type { LearnedAffectPrior, AffectAxisPriors } from "@hum-ai/orchestrator";
import { parsePopulationArtifact, type PopulationArtifact } from "@hum-ai/population-corpus";

export interface PromotionStatus {
  readonly evaluated: boolean;
  readonly gateMetric: string;
  readonly gateThreshold: number;
  readonly affectBalancedAccuracy: number | null;
  readonly affectPassedGate: boolean;
  readonly affectModelRole: string;
  readonly promotedAuxTarget: string | null;
  readonly promotedAuxBalancedAccuracy: number | null;
  readonly note: string;
}

/** Honest per-axis provenance for the two coarse axis priors (for UI labels) — the
 *  UI-facing subset of signal-lab's canonical {@link SignalAxisPriorMeta}. */
export type AxisPriorMeta = Pick<SignalAxisPriorMeta, "balancedAccuracy" | "passedGate">;

export interface LoadedPrior {
  readonly prior: LearnedAffectPrior;
  readonly promotion: PromotionStatus;
  /** Trained coarse valence / arousal axis priors (OOD-aware), when their artifacts exist. */
  readonly axisPriors: AffectAxisPriors;
  /** Honest accuracy + gate status per axis, sourced from the manifest. */
  readonly axisMeta: { valence?: AxisPriorMeta; arousal?: AxisPriorMeta };
}

interface RawManifestTarget {
  id?: string;
  balancedAccuracy?: number;
  passedGate?: boolean;
}

interface RawManifest {
  gate?: { metric?: string; threshold?: number };
  priorAffectModel?: { balancedAccuracy?: number | null; passedGate?: boolean; role?: string };
  promoted?: { targetId?: string; balancedAccuracy?: number } | null;
  targets?: RawManifestTarget[];
  inferenceImpact?: string;
}

function assetUrl(name: string): string {
  return `${import.meta.env.BASE_URL}models/${name}`;
}

function gateNoteFrom(p: PromotionStatus): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const verdict = p.affectPassedGate ? "PASSED" : "did NOT pass";
  const ba = p.affectBalancedAccuracy != null ? ` (balanced acc ${pct(p.affectBalancedAccuracy)})` : "";
  return `${p.affectModelRole}; affect target ${verdict} the ${(p.gateThreshold * 100).toFixed(0)}% ${p.gateMetric} gate${ba}.`;
}

interface LoadedManifest {
  readonly promotion: PromotionStatus;
  readonly targets: RawManifestTarget[];
}

async function loadManifest(): Promise<LoadedManifest> {
  try {
    const res = await fetch(assetUrl("model_manifest.json"));
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const m = (await res.json()) as RawManifest;
    return {
      promotion: {
        evaluated: true,
        gateMetric: m.gate?.metric ?? "balanced_accuracy",
        gateThreshold: m.gate?.threshold ?? 0.8,
        affectBalancedAccuracy: m.priorAffectModel?.balancedAccuracy ?? null,
        affectPassedGate: m.priorAffectModel?.passedGate ?? false,
        affectModelRole: m.priorAffectModel?.role ?? "population_prior",
        promotedAuxTarget: m.promoted?.targetId ?? null,
        promotedAuxBalancedAccuracy: m.promoted?.balancedAccuracy ?? null,
        note: m.inferenceImpact ?? "",
      },
      targets: m.targets ?? [],
    };
  } catch {
    // No manifest: not-evaluated (never claim a gate result we don't have).
    return {
      promotion: {
        evaluated: false,
        gateMetric: "balanced_accuracy",
        gateThreshold: 0.8,
        affectBalancedAccuracy: null,
        affectPassedGate: false,
        affectModelRole: "population_prior",
        promotedAuxTarget: null,
        promotedAuxBalancedAccuracy: null,
        note: "No promotion manifest accompanied the model; gate status unknown.",
      },
      targets: [],
    };
  }
}

/** Fetch + build one coarse-axis prior (or undefined when its artifact is absent). */
async function loadAxisPrior(
  axis: "valence" | "arousal",
  artifact: string,
  meta: AxisPriorMeta | undefined,
): Promise<{ prior?: ReturnType<typeof buildAffectAxisPrior>; meta?: AxisPriorMeta }> {
  try {
    const res = await fetch(assetUrl(artifact));
    if (!res.ok) return {};
    const params = deserializeModel(await res.text());
    const accuracy = meta?.balancedAccuracy ?? 0.5;
    const passedGate = meta?.passedGate ?? false;
    return {
      prior: buildAffectAxisPrior(params, { axis, balancedAccuracy: accuracy, passedGate }),
      meta: { balancedAccuracy: accuracy, passedGate },
    };
  } catch (err) {
    console.warn(`[prior] ${axis} axis model present but unloadable — acoustic axis read only:`, err);
    return {};
  }
}

let cache: Promise<LoadedPrior | null> | undefined;

/**
 * Load the trained prior + honest promotion status, or null when no artifact is served
 * (→ heuristic fallback). Memoized for the session.
 */
export function loadBrowserPrior(): Promise<LoadedPrior | null> {
  if (cache) return cache;
  cache = (async () => {
    let modelText: string;
    try {
      const res = await fetch(assetUrl("model.json"));
      if (!res.ok) return null;
      modelText = await res.text();
    } catch {
      return null;
    }

    let params: ReturnType<typeof deserializeModel>;
    try {
      params = deserializeModel(modelText);
    } catch (err) {
      console.warn("[prior] model.json present but unparseable — heuristic fallback:", err);
      return null;
    }

    const expert = new LearnedAffectPriorExpert(params, { priorDomainPenalty: AFFECT_PRIOR_FAR_DOMAIN_CAP });
    const { promotion, targets } = await loadManifest();
    const prior: LearnedAffectPrior = {
      expert,
      confidenceCap: AFFECT_PRIOR_FAR_DOMAIN_CAP,
      capReason: `affect-prior far-domain penalty ${AFFECT_PRIOR_FAR_DOMAIN_CAP.toFixed(2)} (acted speech; ADR-0005)`,
      artifact: assetUrl("model.json"),
      gatePassed: promotion.evaluated ? promotion.affectPassedGate : undefined,
      gateNote: promotion.evaluated ? gateNoteFrom(promotion) : undefined,
    };

    // The two coarse AXIS priors the read leads with. Their honest accuracy + gate
    // status come from the manifest targets; absent artifacts → acoustic axis read only.
    const targetById = (id: string): AxisPriorMeta | undefined => {
      const t = targets.find((x) => x.id === id);
      return t && t.balancedAccuracy != null ? { balancedAccuracy: t.balancedAccuracy, passedGate: !!t.passedGate } : undefined;
    };
    const [arousal, valence] = await Promise.all([
      loadAxisPrior("arousal", "model.arousal_binary.json", targetById("arousal_binary")),
      loadAxisPrior("valence", "model.valence_binary.json", targetById("valence_binary")),
    ]);
    const axisPriors: AffectAxisPriors = {};
    if (arousal.prior) (axisPriors as { arousal?: typeof arousal.prior }).arousal = arousal.prior;
    if (valence.prior) (axisPriors as { valence?: typeof valence.prior }).valence = valence.prior;

    return {
      prior,
      promotion,
      axisPriors,
      axisMeta: { valence: valence.meta, arousal: arousal.meta },
    };
  })();
  return cache;
}

let popCache: Promise<PopulationArtifact | null> | undefined;

/**
 * Load the POPULATION baseline artifact (ADR-0012) the build staged under `/models/`, or null
 * when none is served (→ the read falls back to the far-domain prior, exactly as before). This
 * is the middle prior tier: a new user with no personal model yet reads through the population
 * baseline the community improved (see `selectAxisPriors`). Memoized for the session. The
 * artifact is derived model params + OCEAN norms only — no raw audio, no PII (parsed/validated
 * by `parsePopulationArtifact`).
 */
export function loadPopulationArtifact(): Promise<PopulationArtifact | null> {
  if (popCache) return popCache;
  popCache = (async () => {
    try {
      const res = await fetch(assetUrl("population-artifact.json"));
      if (!res.ok) return null;
      return parsePopulationArtifact(await res.text());
    } catch {
      return null;
    }
  })();
  return popCache;
}
