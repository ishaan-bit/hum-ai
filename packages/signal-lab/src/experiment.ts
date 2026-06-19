import type { FusionLabel } from "@hum-ai/affect-model-contracts";
import { buildAvailabilityReport, type AvailabilityReport, type DatasetAvailability } from "./datasets";
import { extractDataset, type ExtractionSummary, type SignalRow } from "./extract";
import { featureVectorNames, toFeatureVector } from "./feature-schema";
import { trainLogReg, serializeModel, type LogRegParams } from "./model";
import { supportedFusionLabels } from "./labels";
import { EXPERIMENT_TARGETS, targetSnapshot, type TargetDef, type TargetSnapshot } from "./targets";
import {
  defaultCohort,
  logRegSpec,
  type CohortModelSpec,
} from "./cohort";
import {
  evaluateCohort,
  permutationPValueBalanced,
  promotionGate,
  selectiveCurve,
  cvPredictions,
  type CohortMetrics,
  type CohortSample,
  type PermutationResult,
  type PromotionGateResult,
  type SelectivePoint,
} from "./cohort-eval";
import { featureImportanceReport, type FeatureImportanceReport } from "./feature-importance";
import type { EvidenceTier } from "./evaluate";
import {
  buildDomainSamples,
  ablateFeatures,
  corpusHumLikeness,
  RATE_SENSITIVE_FEATURES,
  DOMAIN_CORPUS,
  type CorpusHumLikeness,
} from "./domain-experiment";
import {
  ensureArtifactsDir,
  writeArtifactJson,
  writeArtifactText,
} from "./report";

/**
 * The multi-dataset modeling experiment orchestrator. It answers, honestly:
 *   1. Are multiple datasets actually used, and how (supervised vs domain/OOD)?
 *   2. For each inference TARGET, does a model COHORT clear the 80% promotion gate
 *      under leakage-safe grouped CV — or not?
 *   3. What is statistically supported vs only a population prior?
 *
 * It writes git-ignored artifacts + a markdown report. It promotes NOTHING on its
 * own; the caller decides based on `result.promoted`.
 */

export interface TargetExperimentResult {
  readonly target: TargetSnapshot;
  readonly n: number;
  readonly groupCount: number;
  readonly classCounts: Readonly<Record<string, number>>;
  readonly cohort: readonly CohortMetrics[];
  readonly best: CohortMetrics;
  readonly permutation: PermutationResult;
  readonly permutationModel: string;
  readonly gate: PromotionGateResult;
  readonly tier: EvidenceTier;
  readonly selective: readonly SelectivePoint[];
  readonly featureImportance: FeatureImportanceReport;
}

export interface DomainExperimentResult {
  readonly classCounts: Readonly<Record<string, number>>;
  readonly groupCount: number;
  readonly cohortAllFeatures: readonly CohortMetrics[];
  readonly cohortAblated: readonly CohortMetrics[];
  readonly ablationDropped: readonly string[];
  readonly humLikeness: readonly CorpusHumLikeness[];
  readonly confoundNote: string;
}

export interface ExperimentResult {
  readonly availability: AvailabilityReport;
  readonly extractions: readonly ExtractionSummary[];
  readonly datasetsUsedForSupervised: readonly string[];
  readonly datasetsUsedForDomainOod: readonly string[];
  readonly labeledCount: number;
  readonly gateThreshold: number;
  readonly targets: readonly TargetExperimentResult[];
  readonly domain: DomainExperimentResult | null;
  readonly anyTargetPassedGate: boolean;
  readonly promoted: { readonly targetId: string; readonly model: string; readonly balancedAccuracy: number } | null;
  readonly artifactsDir: string | null;
  readonly artifacts: readonly string[];
}

export interface ExperimentOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly write?: boolean;
  readonly onLog?: (m: string) => void;
  /** Cap on RAVDESS rows extracted (default: all). */
  readonly ravdessCap?: number;
  /** Cap on each non-RAVDESS corpus (default 800). */
  readonly otherCap?: number;
  readonly folds?: number;
  readonly permutations?: number;
  readonly gateThreshold?: number;
}

function tierFor(balAcc: number, balChance: number, p: number, ece: number, n: number): EvidenceTier {
  const lift = balAcc - balChance;
  if (n < 60) return "insufficient";
  if (p >= 0.05 || lift < 0.05) return "weak";
  if (lift >= 0.15 && p < 0.01 && ece <= 0.15) return "supported";
  return "moderate";
}

function pickBest(cohort: readonly CohortMetrics[]): CohortMetrics {
  return [...cohort].sort(
    (a, b) => b.balancedAccuracy - a.balancedAccuracy || b.macroF1 - a.macroF1 || a.ece - b.ece,
  )[0]!;
}

function buildTargetSamples(rows: readonly SignalRow[], target: TargetDef): { samples: CohortSample[]; counts: Record<string, number> } {
  const samples: CohortSample[] = [];
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.fusionLabel) continue;
    const cls = target.classOf(r.fusionLabel as FusionLabel);
    if (cls === null) continue;
    samples.push({ vector: toFeatureVector(r.features), label: cls, group: r.group ?? "nogroup" });
    counts[cls] = (counts[cls] ?? 0) + 1;
  }
  return { samples, counts };
}

function runTarget(
  rows: readonly SignalRow[],
  target: TargetDef,
  specs: readonly CohortModelSpec[],
  opts: { folds: number; permutations: number; gateThreshold: number; log: (m: string) => void },
): TargetExperimentResult | null {
  const featureNames = featureVectorNames();
  const { samples, counts } = buildTargetSamples(rows, target);
  if (samples.length < 60 || new Set(samples.map((s) => s.label)).size < 2) {
    opts.log(`  target ${target.id}: only ${samples.length} samples / ${new Set(samples.map((s) => s.label)).size} classes — skipped (insufficient).`);
    return null;
  }
  const groupCount = new Set(samples.map((s) => s.group)).size;
  opts.log(`  target ${target.id}: ${samples.length} samples, ${Object.keys(counts).length} classes, ${groupCount} groups — running cohort…`);

  const cohort = evaluateCohort(samples, specs, { labels: target.classes, featureNames, folds: opts.folds }).sort(
    (a, b) => b.balancedAccuracy - a.balancedAccuracy,
  );
  const best = pickBest(cohort);

  // Significance uses a fast LINEAR null-reference (logreg, 150it) — it tests
  // whether the TARGET carries learnable feature↔label signal, the standard
  // permutation interpretation, and keeps the test tractable across permutations.
  const bestSpec = specs.find((s) => s.name === best.model);
  const permSpec = logRegSpec({ name: "logreg_null_ref", iterations: 150 });
  const permutationModel = "logreg(150it) linear null-reference";
  const permutation = permutationPValueBalanced(samples, permSpec, {
    labels: target.classes,
    featureNames,
    folds: opts.folds,
    permutations: opts.permutations,
  });

  const gate = promotionGate(best, permutation, { threshold: opts.gateThreshold });
  const tier = tierFor(best.balancedAccuracy, best.chance.balancedChance, permutation.pValue, best.ece, samples.length);

  const bestPreds = cvPredictions(samples, bestSpec ?? logRegSpec(), { labels: target.classes, featureNames, folds: opts.folds });
  const selective = selectiveCurve(bestPreds.yTrue, bestPreds.yPred, bestPreds.pTop, target.classes);

  const fi = featureImportanceReport(samples.map((s) => s.vector), samples.map((s) => s.label), featureNames, target.id);

  opts.log(
    `    best=${best.model} balAcc=${(best.balancedAccuracy * 100).toFixed(1)}% (chance ${(best.chance.balancedChance * 100).toFixed(1)}%) ` +
      `macroF1=${best.macroF1.toFixed(3)} ECE=${best.ece.toFixed(3)} p=${permutation.pValue.toFixed(3)} tier=${tier} gate=${gate.passed ? "PASS" : "fail"}`,
  );

  return {
    target: targetSnapshot(target),
    n: samples.length,
    groupCount,
    classCounts: counts,
    cohort,
    best,
    permutation,
    permutationModel,
    gate,
    tier,
    selective,
    featureImportance: fi,
  };
}

function runDomain(
  rowsByDataset: Readonly<Record<string, readonly SignalRow[]>>,
  model: LogRegParams | null,
  specs: readonly CohortModelSpec[],
  opts: { folds: number; log: (m: string) => void },
): Promise<DomainExperimentResult | null> {
  const featureNames = featureVectorNames();
  const samples = buildDomainSamples(rowsByDataset);
  const counts: Record<string, number> = {};
  for (const s of samples) counts[s.label] = (counts[s.label] ?? 0) + 1;
  const classes = Array.from(new Set(samples.map((s) => s.label)));
  if (samples.length < 60 || classes.length < 2) {
    opts.log("  domain experiment: insufficient corpora present — skipped.");
    return Promise.resolve(null);
  }
  const groupCount = new Set(samples.map((s) => s.group)).size;
  opts.log(`  domain experiment: ${samples.length} samples over ${classes.length} corpora (${groupCount} speaker groups)…`);

  const cohortAllFeatures = evaluateCohort(samples, specs, { labels: classes, featureNames, folds: opts.folds }).sort(
    (a, b) => b.balancedAccuracy - a.balancedAccuracy,
  );
  const ablated = ablateFeatures(samples, RATE_SENSITIVE_FEATURES);
  const cohortAblated = evaluateCohort(ablated.samples, specs, { labels: classes, featureNames: ablated.featureNames, folds: opts.folds }).sort(
    (a, b) => b.balancedAccuracy - a.balancedAccuracy,
  );
  opts.log(
    `    all-features best balAcc=${(cohortAllFeatures[0]!.balancedAccuracy * 100).toFixed(1)}% ; ` +
      `ablated(no rate-sensitive spectral) best balAcc=${(cohortAblated[0]!.balancedAccuracy * 100).toFixed(1)}%`,
  );

  return corpusHumLikeness(rowsByDataset, model).then((humLikeness) => {
    for (const h of humLikeness) {
      opts.log(
        `    hum-likeness ${h.datasetId} (${h.registryGap}): P(hum)=${h.meanPHum.toFixed(2)} compat=${h.meanHumCompatibility.toFixed(2)}` +
          (h.affectMeanOod !== null ? ` affectOOD=${h.affectMeanOod.toFixed(2)} affectMatch=${h.affectMeanDomainMatch!.toFixed(2)}` : ""),
      );
    }
    return {
      classCounts: counts,
      groupCount,
      cohortAllFeatures,
      cohortAblated,
      ablationDropped: RATE_SENSITIVE_FEATURES,
      humLikeness,
      confoundNote:
        "Each domain class is a SINGLE corpus, so domain == corpus == recording conditions (sample rate 48k/44.1k/16k). " +
        "A high score may be corpus fingerprinting, not vocalization-type recognition. Speaker-grouped CV controls speaker " +
        "leakage but NOT this corpus confound; the ablation removes rate-sensitive spectral features as a partial check. " +
        "This target is NEVER promoted as an inference capability.",
    };
  });
}

export async function runExperiment(opts: ExperimentOptions = {}): Promise<ExperimentResult> {
  const log = opts.onLog ?? (() => {});
  const write = opts.write ?? true;
  const folds = opts.folds ?? 5;
  const permutations = opts.permutations ?? 150; // floor p ≈ 1/151 ≈ 0.0066, so p<0.01 is reachable
  const gateThreshold = opts.gateThreshold ?? 0.8;

  const availability = buildAvailabilityReport(opts.env);
  const usable = availability.datasets.filter((d) => d.usableForFeatureExtraction);
  log(`Usable datasets: ${usable.map((d) => d.datasetId).join(", ") || "none"}.`);

  // 1. Extract every usable dataset (real extractor). Cap non-RAVDESS for runtime.
  const rowsByDataset: Record<string, SignalRow[]> = {};
  const extractions: ExtractionSummary[] = [];
  for (const d of usable) {
    const cap = d.datasetId === "ravdess" ? opts.ravdessCap : (opts.otherCap ?? 800);
    log(`Extracting ${d.datasetId}${cap ? ` (cap ${cap})` : ""}…`);
    const { rows, summary } = extractDataset(d as DatasetAvailability, { maxPerDataset: cap, env: opts.env });
    rowsByDataset[d.datasetId] = rows;
    extractions.push(summary);
    log(`  ${d.datasetId}: ${summary.featureRows} rows (${summary.labeledRows} labeled, decode-fail ${summary.decodeFailures}, junk-skipped ${summary.junkEntriesSkipped}).`);
  }

  const ravdessRows = rowsByDataset["ravdess"] ?? [];
  const labeledRows = ravdessRows.filter((r) => r.fusionLabel);

  // 2. Train the canonical affect prior (full fusion target) for the inference path + OOD probe.
  const featureNames = featureVectorNames();
  let priorModel: LogRegParams | null = null;
  {
    const { samples } = buildTargetSamples(labeledRows, EXPERIMENT_TARGETS[0]!);
    const distinct = new Set(samples.map((s) => s.label));
    if (samples.length >= 60 && distinct.size >= 2) {
      const trainLabels = supportedFusionLabels().filter((l) => distinct.has(l));
      priorModel = trainLogReg(samples.map((s) => s.vector), samples.map((s) => s.label), { labels: trainLabels, featureNames });
    }
  }

  // 3. Cohort over each supervised target (RAVDESS-labeled).
  const specs = defaultCohort();
  log(`Cohort: ${specs.map((s) => s.name).join(", ")}.`);
  const targets: TargetExperimentResult[] = [];
  log("Supervised targets (RAVDESS affect labels):");
  for (const t of EXPERIMENT_TARGETS) {
    const res = runTarget(labeledRows, t, specs, { folds, permutations, gateThreshold, log });
    if (res) targets.push(res);
  }

  // 4. Cross-corpus domain + hum-likeness probe (all usable corpora).
  log("Cross-corpus domain / OOD experiment:");
  const domain = await runDomain(rowsByDataset, priorModel, specs, { folds, log });

  const passing = targets.filter((t) => t.gate.passed);
  const anyTargetPassedGate = passing.length > 0;
  const promoted = anyTargetPassedGate
    ? (() => {
        const top = [...passing].sort((a, b) => b.best.balancedAccuracy - a.best.balancedAccuracy)[0]!;
        return { targetId: top.target.id, model: top.best.model, balancedAccuracy: top.best.balancedAccuracy };
      })()
    : null;

  const datasetsUsedForSupervised = labeledRows.length > 0 ? ["ravdess"] : [];
  const datasetsUsedForDomainOod = DOMAIN_CORPUS.map((c) => c.datasetId).filter((id) => (rowsByDataset[id]?.length ?? 0) > 0);

  const result: ExperimentResult = {
    availability,
    extractions,
    datasetsUsedForSupervised,
    datasetsUsedForDomainOod,
    labeledCount: labeledRows.length,
    gateThreshold,
    targets,
    domain,
    anyTargetPassedGate,
    promoted,
    artifactsDir: null,
    artifacts: [],
  };

  if (write) {
    const dir = ensureArtifactsDir(opts.env);
    const artifacts: string[] = [];
    artifacts.push(writeArtifactJson("multidataset_experiment.json", result, opts.env));
    artifacts.push(writeArtifactText("MULTIDATASET_EXPERIMENT.md", buildExperimentMarkdown(result), opts.env));
    artifacts.push(writeArtifactText("SIGNIFICANCE_REPORT.md", buildSignificanceMarkdown(result), opts.env));

    // Persist a promoted target's deployable model (LogReg — serializable + interpretable)
    // ONLY if a target cleared the gate. The 6-class affect prior is unchanged.
    if (result.promoted) {
      const promotedTarget = EXPERIMENT_TARGETS.find((t) => t.id === result.promoted!.targetId);
      if (promotedTarget) {
        const { samples } = buildTargetSamples(labeledRows, promotedTarget);
        const distinct = new Set(samples.map((s) => s.label));
        const model = trainLogReg(samples.map((s) => s.vector), samples.map((s) => s.label), {
          labels: promotedTarget.classes.filter((c) => distinct.has(c)),
          featureNames,
          version: `signal-lab-${promotedTarget.id}/0.1.0`,
        });
        artifacts.push(writeArtifactText(`model.${promotedTarget.id}.json`, serializeModel(model), opts.env));
      }
    }

    artifacts.push(writeArtifactJson("model_manifest.json", buildModelManifest(result, priorModel), opts.env));
    return { ...result, artifactsDir: dir, artifacts };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Reports (kept here to avoid a report.ts ↔ experiment.ts type cycle).
// ---------------------------------------------------------------------------
function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export function buildExperimentMarkdown(r: ExperimentResult): string {
  const l: string[] = [];
  l.push("# Signal-Lab — Multi-Dataset Modeling Experiment\n");
  l.push("> Artifacts git-ignored. Reproduce: `npm run signal:experiment`. No fabricated numbers; re-run if local data changes.\n");
  l.push("## 1. Dataset usage (this run)\n");
  l.push(`- Supervised (affect labels): **${r.datasetsUsedForSupervised.join(", ") || "none"}** — ${r.labeledCount} labeled rows.`);
  l.push(`- Domain / OOD only (unlabeled): **${r.datasetsUsedForDomainOod.filter((d) => d !== "ravdess").join(", ") || "none"}**.`);
  l.push("- Per-dataset extraction:");
  for (const e of r.extractions) {
    l.push(`  - \`${e.datasetId}\`: ${e.featureRows} rows, ${e.labeledRows} labeled, decode-fail ${e.decodeFailures}, junk-skipped ${e.junkEntriesSkipped}.`);
  }
  l.push(`\n## 2. Promotion gate (EXPERIMENTAL): balanced accuracy ≥ ${pct(r.gateThreshold)} ∧ permutation p<0.01 ∧ ECE≤0.15, grouped CV\n`);
  l.push("| target | n | classes | best model | balanced acc | chance | macro-F1 | ECE | perm p | tier | GATE |");
  l.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const t of r.targets) {
    l.push(
      `| \`${t.target.id}\` | ${t.n} | ${t.target.classes.length} | ${t.best.model} | **${pct(t.best.balancedAccuracy)}** | ${pct(t.best.chance.balancedChance)} | ${t.best.macroF1.toFixed(3)} | ${t.best.ece.toFixed(3)} | ${t.permutation.pValue.toFixed(3)} | ${t.tier} | ${t.gate.passed ? "✅ PASS" : "❌ fail"} |`,
    );
  }
  l.push(`\n**Outcome:** ${r.anyTargetPassedGate ? `promoted target \`${r.promoted!.targetId}\` (${r.promoted!.model}, balAcc ${pct(r.promoted!.balancedAccuracy)}).` : "**no target reached the 80% gate.**"}\n`);

  for (const t of r.targets) {
    l.push(`\n### Target: \`${t.target.id}\` — ${t.target.description}\n`);
    l.push(`Derivation: ${t.target.source}. Class assignment: ${Object.entries(t.target.assignment).map(([k, v]) => `${k}→${v}`).join(", ")}.\n`);
    l.push("Cohort (grouped CV, sorted by balanced accuracy):\n");
    l.push("| model | family | balanced acc | accuracy | macro-F1 | ECE |");
    l.push("|---|---|---|---|---|---|");
    for (const m of t.cohort) {
      l.push(`| ${m.model} | ${m.family} | ${pct(m.balancedAccuracy)} | ${pct(m.accuracy)} | ${m.macroF1.toFixed(3)} | ${m.ece.toFixed(3)} |`);
    }
    l.push(`\nSignificance: permutation null balAcc ${pct(t.permutation.nullMean)}±${(t.permutation.nullStd * 100).toFixed(1)}pp, p=${t.permutation.pValue.toFixed(3)} (model: ${t.permutationModel}). Gate: ${t.gate.reasons.join("; ")}.`);
    l.push(`\nSelective prediction (abstain below threshold) — best model:`);
    l.push("| pTop ≥ | coverage | balanced acc |");
    l.push("|---|---|---|");
    for (const s of t.selective) l.push(`| ${s.threshold.toFixed(2)} | ${pct(s.coverage)} | ${pct(s.balancedAccuracy)} |`);
  }

  if (r.domain) {
    l.push("\n## 3. Cross-corpus domain / OOD (genuinely multi-dataset)\n");
    l.push(`Corpora → domain class: ${DOMAIN_CORPUS.map((c) => `${c.datasetId}→${c.domainClass}`).join(", ")}. Class counts: ${Object.entries(r.domain.classCounts).map(([k, v]) => `${k}=${v}`).join(", ")} over ${r.domain.groupCount} speaker groups.\n`);
    l.push(`⚠ **Confound:** ${r.domain.confoundNote}\n`);
    l.push(`- All-features best: **${pct(r.domain.cohortAllFeatures[0]!.balancedAccuracy)}** (${r.domain.cohortAllFeatures[0]!.model}).`);
    l.push(`- Ablated (dropped ${r.domain.ablationDropped.join(", ")}): **${pct(r.domain.cohortAblated[0]!.balancedAccuracy)}** (${r.domain.cohortAblated[0]!.model}).`);
    l.push("\n### Hum-likeness probe (NO training; validates the repo's own domain guard)\n");
    l.push("Per ADR-0002 `DEFAULT_DOMAIN_GAP`, sustained phonation (VocalSet, near) should read MOST hum-like.\n");
    l.push("| corpus | registry gap | mean P(hum) | predicted-hum rate | hum-compatibility | affect OOD | affect domain-match |");
    l.push("|---|---|---|---|---|---|---|");
    for (const h of r.domain.humLikeness) {
      l.push(
        `| \`${h.datasetId}\` | ${h.registryGap} | ${h.meanPHum.toFixed(2)} | ${pct(h.predictedHumRate)} | ${h.meanHumCompatibility.toFixed(2)} | ${h.affectMeanOod?.toFixed(2) ?? "—"} | ${h.affectMeanDomainMatch?.toFixed(2) ?? "—"} |`,
      );
    }
    const vs = r.domain.humLikeness.find((h) => h.datasetId === "vocalsound");
    if (vs?.burstTypes) l.push(`\nVocalSound nonverbal burst types present: ${Object.entries(vs.burstTypes).map(([k, v]) => `${k}=${v}`).join(", ")}.`);
  }

  l.push("\n## 4. Governance\n");
  l.push("- All public datasets are PRIORS (ADR-0005); only `native_hum` is hum truth (none present). RAVDESS affect = acted, far-domain (penalty 0.45).");
  l.push("- Coarse targets (arousal/valence) only change the QUESTION, not the governance — still acted-speech priors, never hum truth, never clinical.");
  l.push("- The 80% gate is EXPERIMENTAL (the repo defines no numeric bar); balanced accuracy chosen so a skewed prior cannot inflate it.");
  return l.join("\n");
}

export function buildSignificanceMarkdown(r: ExperimentResult): string {
  const l: string[] = [];
  l.push("# Signal-Lab — Significance & Evidence Report\n");
  l.push("> Evidence tiers: **supported** (real, well-calibrated lift) / **moderate** / **weak** / **insufficient**. PRIOR-domain only.\n");

  l.push("## Target-level evidence\n");
  l.push("| target | best balAcc | lift over chance | perm p | ECE | tier | reaches 80%? |");
  l.push("|---|---|---|---|---|---|---|");
  for (const t of r.targets) {
    const lift = t.best.balancedAccuracy - t.best.chance.balancedChance;
    l.push(`| \`${t.target.id}\` | ${pct(t.best.balancedAccuracy)} | +${(lift * 100).toFixed(1)}pp | ${t.permutation.pValue.toFixed(3)} | ${t.best.ece.toFixed(3)} | **${t.tier}** | ${t.gate.passed ? "yes" : "no"} |`);
  }

  l.push("\n## Strongest / weakest features per target (model-agnostic ANOVA-F)\n");
  for (const t of r.targets) {
    l.push(`\n**\`${t.target.id}\`** — strongest: ${t.featureImportance.strongest.slice(0, 8).map((f) => `${f.feature}(${f.score.toFixed(1)})`).join(", ")}`);
    l.push(`  weakest: ${t.featureImportance.weakest.slice(0, 6).map((f) => `${f.feature}(${f.score.toFixed(2)})`).join(", ")}`);
  }

  l.push("\n## Model-level comparison (which family wins each target)\n");
  for (const t of r.targets) {
    const ranked = [...t.cohort].sort((a, b) => b.balancedAccuracy - a.balancedAccuracy);
    l.push(`- \`${t.target.id}\`: ${ranked.map((m) => `${m.model} ${pct(m.balancedAccuracy)}`).join(" > ")}`);
  }

  l.push("\n## Dataset-level contribution\n");
  l.push(`- **RAVDESS** — the ONLY affect-labeled corpus; carries every supervised target. ${r.labeledCount} labeled rows.`);
  if (r.domain) {
    for (const h of r.domain.humLikeness) {
      const role =
        h.datasetId === "ravdess"
          ? "supervised affect + speech-domain anchor"
          : h.datasetId === "vocalset"
            ? "nearest-to-hum domain (sustained phonation) + OOD calibration"
            : "vocal-burst negative / OOD calibration";
      l.push(`- **${h.datasetId}** — ${role}; mean P(hum)=${h.meanPHum.toFixed(2)}, hum-compat=${h.meanHumCompatibility.toFixed(2)} (registry gap ${h.registryGap}).`);
    }
  }

  l.push("\n## Where multi-dataset training helps vs hurts\n");
  if (r.domain) {
    const help = r.domain.cohortAblated[0]!.balancedAccuracy >= 0.6;
    l.push(`- **Helps:** the existing domain guard + OOD calibration genuinely uses all corpora; hum-likeness ordering ${orderingHolds(r.domain.humLikeness) ? "MATCHES" : "does NOT match"} the registry's near/moderate/far expectation.`);
    l.push(`- **Confounded (neither clearly helps nor is trustworthy):** cross-corpus domain classification (${pct(r.domain.cohortAllFeatures[0]!.balancedAccuracy)} all-features, ${pct(r.domain.cohortAblated[0]!.balancedAccuracy)} ablated) — ${help ? "separation partly survives the ablation but" : "drops under ablation, so"} it is corpus-confounded and not promoted.`);
  }
  l.push("- **Hurts / not yet possible:** pooling corpora for SUPERVISED affect — only RAVDESS has affect labels, so there is no honest multi-corpus affect training set. VocalSet/VocalSound cannot supply fusion-label targets.");

  l.push("\n## What is supported vs only a population prior vs unproven\n");
  const supported = r.targets.filter((t) => t.tier === "supported").map((t) => t.target.id);
  const weak = r.targets.filter((t) => t.tier === "weak" || t.tier === "insufficient").map((t) => t.target.id);
  l.push(`- **Statistically supported (real PRIOR-domain signal, p<0.01):** ${supported.join(", ") || "none"}.`);
  l.push(`- **Population prior only (above chance but below the 80% bar):** ${r.targets.filter((t) => !t.gate.passed && t.tier !== "weak" && t.tier !== "insufficient").map((t) => t.target.id).join(", ") || "none"}.`);
  l.push(`- **Weak / insufficient:** ${weak.join(", ") || "none"}.`);
  l.push("- **Unproven for real user hums:** ALL of the above — every number is acted-speech / singing / burst PRIOR. No native-hum corpus exists; nothing here is hum truth or clinical (ADR-0005).");
  return l.join("\n");
}

export interface ModelManifest {
  readonly version: string;
  readonly generatedBy: string;
  readonly gate: {
    readonly status: "EXPERIMENTAL";
    readonly metric: "balanced_accuracy";
    readonly threshold: number;
    readonly eceCap: number;
    readonly maxPValue: number;
    readonly validation: string;
    readonly rationale: string;
  };
  readonly datasets: { readonly supervised: readonly string[]; readonly domainOod: readonly string[] };
  readonly priorAffectModel: {
    readonly name: string;
    readonly version: string;
    readonly target: string;
    readonly balancedAccuracy: number | null;
    readonly passedGate: boolean;
    readonly role: string;
  };
  readonly targets: readonly {
    readonly id: string;
    readonly bestModel: string;
    readonly balancedAccuracy: number;
    readonly ece: number;
    readonly pValue: number;
    readonly tier: string;
    readonly passedGate: boolean;
    readonly artifact: string | null;
  }[];
  readonly promoted: {
    readonly targetId: string;
    readonly model: string;
    readonly balancedAccuracy: number;
    readonly artifact: string;
    readonly note: string;
  } | null;
  readonly inferenceImpact: string;
}

/** A repo-convention model manifest recording every gate outcome — the "update the manifest" deliverable. */
export function buildModelManifest(r: ExperimentResult, priorModel: LogRegParams | null): ModelManifest {
  const affect = r.targets.find((t) => t.target.id === "affect_fusion_label");
  return {
    version: "signal-lab-model-manifest/0.1.0",
    generatedBy: "@hum-ai/signal-lab runExperiment",
    gate: {
      status: "EXPERIMENTAL",
      metric: "balanced_accuracy",
      threshold: r.gateThreshold,
      eceCap: 0.15,
      maxPValue: 0.01,
      validation: "speaker/actor-grouped 5-fold CV + label-permutation significance + top-class ECE",
      rationale:
        "The repo defines no numeric promotion bar; balanced accuracy is chosen (over raw accuracy) so a skewed class prior cannot inflate the score — consistent with evaluate.ts reporting majority-class accuracy as chance.",
    },
    datasets: { supervised: r.datasetsUsedForSupervised, domainOod: r.datasetsUsedForDomainOod },
    priorAffectModel: {
      name: "signal-lab-logreg",
      version: priorModel?.version ?? "untrained",
      target: "affect_fusion_label",
      balancedAccuracy: affect?.best.balancedAccuracy ?? null,
      passedGate: affect?.gate.passed ?? false,
      role: "population_prior — KEPT (far-domain acted speech, penalty 0.45; did not reach the 80% gate; never hum truth / clinical, ADR-0005)",
    },
    targets: r.targets.map((t) => ({
      id: t.target.id,
      bestModel: t.best.model,
      balancedAccuracy: t.best.balancedAccuracy,
      ece: t.best.ece,
      pValue: t.permutation.pValue,
      tier: t.tier,
      passedGate: t.gate.passed,
      artifact: t.gate.passed ? `model.${t.target.id}.json` : null,
    })),
    promoted: r.promoted
      ? {
          targetId: r.promoted.targetId,
          model: r.promoted.model,
          balancedAccuracy: r.promoted.balancedAccuracy,
          artifact: `model.${r.promoted.targetId}.json`,
          note:
            "EXPERIMENTAL far-domain PRIOR that cleared the 80% gate. It is NOT wired to change the runtime affect/intervention read: it is acted-speech (penalty 0.45), a coarse axis, and not hum truth. Surfaced as an auxiliary, gate-passed prior only.",
        }
      : null,
    inferenceImpact: r.promoted
      ? `Target '${r.promoted.targetId}' cleared the experimental gate as a far-domain prior; the 6-class affect head + interventions are UNCHANGED (the 6-class prior did not pass). Inference reports gate status honestly.`
      : "No target passed the gate; the learned 6-class affect prior is retained as a population prior and inference reports the fallback honestly.",
  };
}

function orderingHolds(h: readonly CorpusHumLikeness[]): boolean {
  const vocalset = h.find((x) => x.datasetId === "vocalset")?.meanPHum ?? -1;
  const ravdess = h.find((x) => x.datasetId === "ravdess")?.meanPHum ?? -1;
  const vocalsound = h.find((x) => x.datasetId === "vocalsound")?.meanPHum ?? -1;
  return vocalset >= ravdess && vocalset >= vocalsound;
}
