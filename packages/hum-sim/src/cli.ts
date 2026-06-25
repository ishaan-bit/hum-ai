/**
 * HUM SIMULATOR CLI — `node --import tsx packages/hum-sim/src/cli.ts <command> [flags]`.
 *
 * Commands:
 *   report        Full suite → markdown center-collapse report (default).
 *   fast          Same, reduced sample count (quick iteration).
 *   sweep         Per-control sensitivity Jacobian (extractor fidelity + read response).
 *   fidelity      Fidelity→affect leak table only.
 *   longitudinal  Pin/un-pin + personalization-damp stateful checks only.
 *
 * Flags:
 *   --json <path>   Also write the machine-readable artifact JSON to <path>.
 *   --no-long       Skip the (slower) longitudinal sequences.
 *
 * Pure given its inputs (deterministic synth + deterministic read); the only I/O is the
 * optional JSON artifact write. Exits non-zero if the run produced collapse verdicts, so
 * it can gate a build / surface a regression.
 */
import { writeFileSync } from "node:fs";
import { analyze, renderMarkdown, type AnalyzeOptions } from "./report";
import { extractorFidelity, fidelityLeaks, sweepSensitivities } from "./analysis";
import { reachabilitySweeps, fidelityInvarianceScenarios } from "./scenarios";
import { runBatch } from "./pipeline";
import {
  distinctAcousticZones,
  distinctDisplayZones,
  personalizationDampSequence,
  pinUnpinSequence,
  runSequence,
} from "./longitudinal";

const argv = process.argv.slice(2);
const mode = argv[0] && !argv[0].startsWith("--") ? argv[0] : "report";
const jsonIdx = argv.indexOf("--json");
const jsonPath = jsonIdx >= 0 ? argv[jsonIdx + 1] : null;
const skipLong = argv.includes("--no-long");

function num(x: number, d = 2): string {
  return Number.isFinite(x) ? x.toFixed(d) : "—";
}

async function main(): Promise<void> {
  if (mode === "sweep") {
    const sens = sweepSensitivities(await runBatch(reachabilitySweeps()));
    const rec = extractorFidelity(sens);
    console.log("=== EXTRACTOR FIDELITY (latent control → feature recovery) ===\n");
    for (const r of rec) {
      console.log(`${r.recovered ? "OK " : "XX "} ${r.driver.padEnd(20)} → ${r.feature.replace("feat.", "").padEnd(22)} ${num(r.atLow, 3)} → ${num(r.atHigh, 3)} (expect ${r.expectedSign > 0 ? "↑" : "↓"})`);
    }
    console.log("\n=== READ RESPONSE per control (display valence / arousal span) ===\n");
    for (const s of sens) {
      const v = s.effects["out.displayValence"]?.span ?? 0;
      const a = s.effects["out.displayArousal"]?.span ?? 0;
      console.log(`${s.driver.padEnd(20)} ΔV=${num(v)} ΔA=${num(a)}`);
    }
    return;
  }

  if (mode === "fidelity") {
    const leaks = fidelityLeaks(await runBatch(fidelityInvarianceScenarios()));
    console.log("=== FIDELITY → AFFECT LEAK (mood fixed, recording quality varied) ===\n");
    for (const l of leaks) {
      console.log(`${l.leaks ? "LEAK" : "ok  "} ${l.group.padEnd(28)} ΔV=${num(l.valenceDrift)} ΔA=${num(l.arousalDrift)} zones=${l.zonesVisited}`);
    }
    return;
  }

  if (mode === "longitudinal") {
    const pin = await runSequence(pinUnpinSequence());
    const damp = await runSequence(personalizationDampSequence());
    const acVals = pin.steps.map((s) => s.result.axisAcoustic.valence);
    const dispVals = pin.steps.map((s) => s.result.displayAxis.valence);
    const acSpan = Math.max(...acVals) - Math.min(...acVals);
    const dispSpan = Math.max(...dispVals) - Math.min(...dispVals);
    console.log("=== PIN / UN-PIN (fixed-voice user) ===");
    console.log(`absolute-acoustic zones: ${distinctAcousticZones(pin).size} (valence span ${num(acSpan)})`);
    console.log(`displayed zones:         ${distinctDisplayZones(pin).size} (valence span ${num(dispSpan)})`);
    for (const s of pin.steps) {
      console.log(`  day ${String(s.day).padStart(2)} hist=${String(s.priorAcousticHistory).padStart(2)} ac=(${num(s.result.axisAcoustic.valence)},${num(s.result.axisAcoustic.arousal)}) disp=(${num(s.result.displayAxis.valence)},${num(s.result.displayAxis.arousal)}) ${s.result.zone}`);
    }
    const last = damp.steps[damp.steps.length - 1]!.result;
    console.log("\n=== PERSONALIZATION DAMP (H3) ===");
    console.log(`final strong hum  acoustic=(${num(last.axisAcoustic.valence)},${num(last.axisAcoustic.arousal)}) display=(${num(last.displayAxis.valence)},${num(last.displayAxis.arousal)}) internal=(${num(last.internalDimensional.valence)},${num(last.internalDimensional.arousal)})`);
    return;
  }

  const opts: AnalyzeOptions =
    mode === "fast"
      ? { sweepSteps: 5, sweepReps: 1, archetypeReps: 2, skipLongitudinal: skipLong }
      : { skipLongitudinal: skipLong };

  const artifact = await analyze(opts);
  const md = renderMarkdown(artifact);
  console.log(md);
  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify(artifact, null, 2), "utf8");
    console.error(`\n[hum-sim] wrote artifact → ${jsonPath}`);
  }
  // Gate on the genuine CONTRACT REGRESSION (fidelity manufacturing affect), not on the
  // informational compression observations (which are conservative-by-design, reported for
  // context). A failing fidelity leak means the noise→affect decoupling has regressed.
  const leaks = artifact.diagnosis.failingFidelityLeaks.length;
  if (artifact.diagnosis.verdicts.length > 0) {
    console.error(`\n[hum-sim] ${artifact.diagnosis.verdicts.length} diagnostic observation(s) (see report §1).`);
  }
  if (leaks > 0) {
    console.error(`[hum-sim] REGRESSION: ${leaks} fidelity→affect leak(s) — fidelity must not manufacture affect.`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
