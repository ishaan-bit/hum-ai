import { fullReport, sweepReport, scenarioReport } from "./report";
import { sweepAll } from "./sweep";

/**
 * SIM-LAB CLI — `node --import tsx packages/sim-lab/src/cli.ts [all|sweep|scenarios]`.
 * Prints the read-path calibration report (sensitivity sweep + scenario batteries +
 * research-contract findings). Exits non-zero if any finding is a `fail`, so it can
 * gate a build. Pure: constructs derived features directly, never touches audio/IO.
 */
const mode = process.argv[2] ?? "all";

if (mode === "sweep") {
  console.log(sweepReport(sweepAll()));
} else if (mode === "scenarios") {
  console.log(scenarioReport());
} else {
  const { markdown, ok, findings } = fullReport();
  console.log(markdown);
  const fails = findings.filter((f) => f.severity === "fail").length;
  if (!ok) {
    console.error(`\nsim-lab: ${fails} calibration FAIL finding(s).`);
    process.exit(1);
  }
  console.log("\nsim-lab: all calibration contracts hold.");
}
