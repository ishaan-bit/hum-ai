import {
  driversFor,
  sweepAll,
  OUTPUT_KEYS,
  DEAD_SPAN,
  type FeatureSensitivity,
  type OutputKey,
} from "./sweep";
import {
  runMoodScenarios,
  runFidelityInvariance,
  runPinReReference,
  FIDELITY_VALENCE_TOLERANCE,
} from "./scenarios";
import { runHybridLayers } from "./hybrid";

/** A calibration finding the harness surfaces (consumed by the report + the regression test). */
export interface Finding {
  readonly severity: "fail" | "warn" | "info";
  readonly area: string;
  readonly message: string;
}

/**
 * (feature → output) plateaus that are PERCEPTUALLY CORRECT, not miscalibration: the cue
 * genuinely saturates at the physical extreme of the range. Documented (with the research
 * reason) so the report can downgrade them from `warn` to `info` instead of reading as bugs.
 * Anything NOT on this list that saturates is a real "window too narrow" finding (as the
 * openness pitch-range window was, before its 2026-06-24 widening — it clipped at the MIDDLE
 * of the realistic range, not the extreme).
 */
const EXPECTED_SATURATION: ReadonlyArray<{ feature: string; output: OutputKey; why: string }> = [
  { feature: "meanRms", output: "arousal", why: "loudness plateaus in arousal perception beyond a strong hum (Russell V-A circumplex)" },
  { feature: "spectralFlux", output: "arousal", why: "timbre-change animation plateaus once a hum is highly active" },
  { feature: "meanRms", output: "extraversion", why: "loudness is the extraversion cue but bounded (Mairesse 2007; Schuller 2012)" },
  { feature: "peakAmplitude", output: "extraversion", why: "energy is the extraversion cue but bounded" },
  { feature: "activeFrameRatio", output: "extraversion", why: "voiced-activity is the extraversion cue but bounded" },
  { feature: "spectralCentroidHz", output: "extraversion", why: "brightness contribution saturates for very bright tones" },
  { feature: "spectralCentroidHz", output: "agreeableness", why: "a very bright tone reads minimally warm (bounded inverse cue)" },
  { feature: "pitchStability", output: "conscientiousness", why: "vocal control has a perceptual floor — a very wavering hum reads minimally controlled (Schuller 2012; Mohammadi 2012)" },
  { feature: "amplitudeStability", output: "conscientiousness", why: "intensity evenness has a perceptual floor" },
  { feature: "amplitudeStability", output: "emotional_stability", why: "intensity steadiness has a perceptual floor" },
  { feature: "jitter", output: "emotional_stability", why: "high pitch perturbation reads maximally unsteady — bounded ceiling (Saeedi 2023)" },
  { feature: "shimmerProxy", output: "conscientiousness", why: "high amplitude perturbation reads minimally controlled — bounded (Saeedi 2023)" },
  { feature: "shimmerProxy", output: "emotional_stability", why: "high amplitude perturbation reads maximally unsteady — bounded" },
];

function expectedSaturation(feature: string, output: OutputKey): string | null {
  return EXPECTED_SATURATION.find((e) => e.feature === feature && e.output === output)?.why ?? null;
}

const AXIS_OUTPUTS: readonly OutputKey[] = ["valence", "arousal"];
const OCEAN_OUTPUTS: readonly OutputKey[] = [
  "openness", "conscientiousness", "extraversion", "agreeableness", "emotional_stability",
];

/** Minimum live drivers an axis must have so it is not pinned to a near-constant. */
export const MIN_AXIS_DRIVERS = 3;

/**
 * Compute the research-contract findings from a completed sweep + scenario run. These
 * are the calibration QA facts: fidelity leaks into affect, dead/under-driven axes,
 * saturated windows, mood mis-ordering, fidelity zone flips, and a still-pinned read.
 */
export function computeFindings(sensitivities: readonly FeatureSensitivity[]): Finding[] {
  const findings: Finding[] = [];

  // 1. CONTRACT: no fidelity (mic/room) parameter may move valence or arousal.
  for (const s of sensitivities) {
    if (s.kind !== "fidelity") continue;
    for (const out of AXIS_OUTPUTS) {
      const e = s.effects[out];
      if (e.span >= DEAD_SPAN) {
        findings.push({
          severity: "fail",
          area: "fidelity-leak",
          message: `${s.feature} (fidelity) moves ${out} by ${e.span.toFixed(3)} — fidelity must not drive the affect read (valence-fidelity-decoupling).`,
        });
      }
    }
  }

  // 2. Each affect axis must have enough live drivers (not pinned to a constant).
  for (const out of AXIS_OUTPUTS) {
    const drivers = driversFor(sensitivities, out);
    if (drivers.length < MIN_AXIS_DRIVERS) {
      findings.push({
        severity: "fail",
        area: "under-driven",
        message: `${out} has only ${drivers.length} live driver(s) (need ≥${MIN_AXIS_DRIVERS}) — the axis is near-pinned.`,
      });
    }
  }

  // 3. Every OCEAN trait should respond to at least one parameter.
  for (const out of OCEAN_OUTPUTS) {
    const drivers = driversFor(sensitivities, out);
    if (drivers.length === 0) {
      findings.push({
        severity: "warn",
        area: "ocean-dead",
        message: `OCEAN trait ${out} has no live driver in the sweep — it is constant for every hum.`,
      });
    }
  }

  // 4. A parameter that is supposed to drive an axis but saturates across most of its
  //    realistic range (window too narrow vs the realistic feature range).
  for (const s of sensitivities) {
    for (const out of [...AXIS_OUTPUTS, ...OCEAN_OUTPUTS]) {
      const e = s.effects[out];
      if (e.span >= DEAD_SPAN && (e.saturatedLow || e.saturatedHigh)) {
        const where = e.saturatedLow && e.saturatedHigh ? "both ends" : e.saturatedLow ? "the low end" : "the high end";
        const expected = expectedSaturation(s.feature, out);
        findings.push({
          severity: expected ? "info" : "warn",
          area: "saturation",
          message: expected
            ? `${s.feature} → ${out} plateaus at ${where} (expected: ${expected}).`
            : `${s.feature} → ${out} saturates at ${where} of its realistic range (${s.min}–${s.max}); the normalization window is narrower than the feature actually varies.`,
        });
      }
    }
  }

  return findings;
}

/**
 * Findings from the scenario batteries: a mood that lands in the wrong quadrant, a mic
 * change that flips the affect zone, or a read that stays pinned despite the re-reference.
 */
export function computeScenarioFindings(): Finding[] {
  const findings: Finding[] = [];

  for (const r of runMoodScenarios()) {
    if (!r.valenceOk || !r.arousalOk) {
      findings.push({
        severity: "fail",
        area: "mood-ordering",
        message: `${r.label} read as valence ${r.valence.toFixed(2)}, arousal ${r.arousal.toFixed(2)} (zone ${r.zone}) — wrong ${!r.valenceOk ? "valence" : ""}${!r.valenceOk && !r.arousalOk ? " & " : ""}${!r.arousalOk ? "arousal" : ""} direction.`,
      });
    }
  }

  for (const f of runFidelityInvariance()) {
    if (Math.abs(f.deltaValence) > FIDELITY_VALENCE_TOLERANCE || !f.zoneStable) {
      findings.push({
        severity: "fail",
        area: "fidelity-invariance",
        message: `mood ${f.mood}: clean→noisy mic moved valence by ${f.deltaValence.toFixed(3)} (zone ${f.cleanZone}→${f.noisyZone}) — fidelity must not change the affect read.`,
      });
    }
  }

  const pin = runPinReReference();
  if (!pin.unpinned) {
    findings.push({
      severity: "fail",
      area: "pin",
      message: `within-user re-reference did not unpin the read (displayed zones ${pin.displayedZoneCount}, valence span ${pin.displayedValenceSpan.toFixed(2)} vs absolute span ${pin.acousticValenceSpan.toFixed(2)}).`,
    });
  }

  // HYBRID CONTRACT: ML priors refine the rule-based backbone, never override it.
  const hy = runHybridLayers();
  if (!hy.inDomainNative.moved || !hy.inDomainNative.bounded) {
    findings.push({
      severity: "fail",
      area: "hybrid",
      message: `in-domain native prior should nudge the read toward its lean but stay bounded (moved=${hy.inDomainNative.moved}, bounded=${hy.inDomainNative.bounded}): acoustic ${hy.inDomainNative.acoustic.toFixed(2)} → ${hy.inDomainNative.refined.toFixed(2)} (prior ${hy.inDomainNative.priorValue.toFixed(2)}).`,
    });
  }
  if (!hy.outOfDomain.unchanged) {
    findings.push({ severity: "fail", area: "hybrid", message: `out-of-domain prior must abstain (read should equal the acoustic backbone), got ${hy.outOfDomain.refined.toFixed(3)} vs ${hy.outOfDomain.acoustic.toFixed(3)}.` });
  }
  if (!hy.gateFailed.unchanged) {
    findings.push({ severity: "fail", area: "hybrid", message: `gate-failed prior must be held (read should equal the acoustic backbone), got ${hy.gateFailed.refined.toFixed(3)} vs ${hy.gateFailed.acoustic.toFixed(3)}.` });
  }

  return findings;
}

function driverTable(sensitivities: readonly FeatureSensitivity[], out: OutputKey): string {
  const rows = driversFor(sensitivities, out)
    .slice(0, 8)
    .map((d) => {
      const dir = d.slopeSign > 0 ? "↑" : d.slopeSign < 0 ? "↓" : "·";
      const flags = [d.monotonic ? "" : "non-mono", d.saturated ? "saturated" : ""].filter(Boolean).join(", ");
      return `| ${d.feature} | ${d.kind} | ${dir} | ${d.span.toFixed(3)} | ${flags || "—"} |`;
    });
  if (rows.length === 0) return `_no live driver_\n`;
  return ["| feature | kind | dir | span | flags |", "|---|---|---|---|---|", ...rows].join("\n") + "\n";
}

/** The full sensitivity sweep section. */
export function sweepReport(sensitivities: readonly FeatureSensitivity[]): string {
  const lines: string[] = ["## Parameter → output sensitivity (rule-based read + OCEAN)\n"];
  for (const out of OUTPUT_KEYS) {
    lines.push(`### ${out}\n`);
    lines.push(driverTable(sensitivities, out));
  }
  return lines.join("\n");
}

/** The scenario battery section. */
export function scenarioReport(): string {
  const lines: string[] = [];

  lines.push("## Mood ordering (rule-based acoustic read)\n");
  lines.push("| scenario | valence | arousal | zone | valence ok | arousal ok |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of runMoodScenarios()) {
    lines.push(`| ${r.label} | ${r.valence.toFixed(2)} | ${r.arousal.toFixed(2)} | ${r.zone} | ${r.valenceOk ? "✅" : "❌"} | ${r.arousalOk ? "✅" : "❌"} |`);
  }
  lines.push("");

  lines.push(`## Fidelity invariance (clean vs noisy mic, |Δvalence| ≤ ${FIDELITY_VALENCE_TOLERANCE})\n`);
  lines.push("| mood | Δvalence | Δarousal | clean zone | noisy zone | zone stable |");
  lines.push("|---|---|---|---|---|---|");
  for (const f of runFidelityInvariance()) {
    const ok = Math.abs(f.deltaValence) <= FIDELITY_VALENCE_TOLERANCE && f.zoneStable;
    lines.push(`| ${f.mood} | ${f.deltaValence.toFixed(3)} | ${f.deltaArousal.toFixed(3)} | ${f.cleanZone} | ${f.noisyZone} | ${ok ? "✅" : "❌"} |`);
  }
  lines.push("");

  const pin = runPinReReference();
  lines.push("## Pin / within-user re-reference (same voice+mic, 5 moods)\n");
  lines.push(`- absolute acoustic read visits **${pin.acousticZoneCount}** zone(s), valence span ${pin.acousticValenceSpan.toFixed(2)}`);
  lines.push(`- displayed (re-referenced) read visits **${pin.displayedZoneCount}** zone(s), valence span ${pin.displayedValenceSpan.toFixed(2)}`);
  lines.push(`- unpinned: ${pin.unpinned ? "✅ yes" : "❌ no"}`);
  lines.push("");
  lines.push("| mood | acoustic zone | displayed zone |");
  lines.push("|---|---|---|");
  for (let i = 0; i < pin.acoustic.length; i++) {
    lines.push(`| ${pin.acoustic[i]!.id} | ${pin.acoustic[i]!.zone} | ${pin.displayed[i]!.zone} |`);
  }
  lines.push("");

  const hy = runHybridLayers();
  lines.push("## Hybrid layers (rule-based backbone + ML axis prior)\n");
  lines.push("| regime | acoustic | prior lean | refined | refines? | bounded? | unchanged? |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const c of [hy.inDomainNative, hy.outOfDomain, hy.gateFailed]) {
    lines.push(`| ${c.label} | ${c.acoustic.toFixed(2)} | ${c.priorValue.toFixed(2)} | ${c.refined.toFixed(2)} | ${c.moved ? "✅" : "—"} | ${c.bounded ? "✅" : "—"} | ${c.unchanged ? "✅" : "—"} |`);
  }
  lines.push("");

  return lines.join("\n");
}

function findingsReport(findings: readonly Finding[]): string {
  const lines: string[] = ["## Calibration findings\n"];
  const fails = findings.filter((f) => f.severity === "fail");
  const warns = findings.filter((f) => f.severity === "warn");
  lines.push(`**${fails.length} fail · ${warns.length} warn**\n`);
  for (const f of findings) {
    const icon = f.severity === "fail" ? "❌" : f.severity === "warn" ? "⚠️" : "ℹ️";
    lines.push(`- ${icon} \`${f.area}\` ${f.message}`);
  }
  if (findings.length === 0) lines.push("- ✅ no contract violations");
  lines.push("");
  return lines.join("\n");
}

/** The complete report: findings + sweep + scenarios. Returns markdown + a pass flag. */
export function fullReport(): { markdown: string; findings: Finding[]; ok: boolean } {
  const sensitivities = sweepAll();
  const findings = [...computeFindings(sensitivities), ...computeScenarioFindings()];
  const ok = findings.every((f) => f.severity !== "fail");
  const markdown = [
    "# Hum AI — read-path calibration report\n",
    findingsReport(findings),
    sweepReport(sensitivities),
    scenarioReport(),
  ].join("\n");
  return { markdown, findings, ok };
}
