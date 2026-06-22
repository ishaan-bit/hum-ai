/**
 * LONGITUDINAL STUDY DASHBOARD (Workstream 6) — a participant-facing view beyond render.ts's
 * 12-point diaryTrail() sparkline: PHQ-9 and GAD-7 trajectories across administrations, plus
 * the within-user relapse-engine trend output.
 *
 * BLINDED + QUALITATIVE (ADR-0008) during the pilot: NO screening probability is shown (the
 * screening model is offline-only, ADR-0006 — never imported here). The instrument totals ARE
 * the participant's own questionnaire answers, so showing their own trajectory is honest and
 * non-clinical; the trend is described in words (easing / steady / more unsettled), never as a
 * risk score. All copy routes through the screened copy()/esc() chokepoint.
 */
import {
  depressionSeverityBand,
  anxietySeverityBand,
  PHQ9_MAX_TOTAL,
  GAD7_MAX_TOTAL,
  type Phq9Response,
  type Gad7Response,
} from "@hum-ai/affect-model-contracts";
import { estimateTrend, type SeriesPoint, type TrendDirection } from "@hum-ai/relapse-engine";
import { assertSafeUserFacingText } from "@hum-ai/safety-language";
import { loadPhqHistory, loadGad7History } from "./clinical-store";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}
function copy(s: string): string {
  assertSafeUserFacingText(s);
  return esc(s);
}

const W = 300;
const H = 80;
const PAD = 12;

/**
 * A small trajectory sparkline of instrument totals over administrations. Higher score sits
 * LOWER (more symptoms toward the bottom), mirroring the diary trail's "brighter sits higher".
 * Pure geometry in attributes; no number is rendered as text.
 */
function trajectorySvg(points: readonly SeriesPoint[], maxValue: number, tone: string): string {
  const n = points.length;
  if (n === 0) return "";
  const x = (i: number): number => (n <= 1 ? W / 2 : PAD + (i / (n - 1)) * (W - 2 * PAD));
  const y = (v: number): number => {
    const t = Math.max(0, Math.min(1, v / maxValue)); // 0 none → 1 max symptoms
    return PAD + t * (H - 2 * PAD); // more symptoms lower
  };
  const coords = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  const line = n > 1 ? `<polyline class="traj-line" fill="none" points="${coords.join(" ")}"/>` : "";
  const dots = points
    .map((_, i) => {
      const [cx, cy] = coords[i]!.split(",");
      const last = i === n - 1;
      return `<circle class="traj-dot traj-${tone}${last ? " traj-today" : ""}" cx="${cx}" cy="${cy}" r="${last ? "4.2" : "2.8"}"/>`;
    })
    .join("");
  return `<svg class="traj-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Your questionnaire scores over time."><line class="traj-axis" x1="${PAD}" y1="${(H / 2).toFixed(1)}" x2="${W - PAD}" y2="${(H / 2).toFixed(1)}"/>${line}${dots}</svg>`;
}

/** Qualitative direction copy for an instrument trend (lower total = improving). */
const DIR_COPY: Record<TrendDirection, string> = {
  rising: "your recent answers point to a little more difficulty than earlier",
  falling: "your recent answers point to a little more ease than earlier",
  flat: "your recent answers look steady",
};

function bandLabel(s: string): string {
  return s.replace(/_/g, " ");
}

interface Trajectory {
  readonly points: readonly SeriesPoint[];
  readonly latestBand: string | null;
  readonly trendLine: string;
}

function phqTrajectory(history: readonly Phq9Response[]): Trajectory {
  const points: SeriesPoint[] = history.map((r) => ({ t: new Date(r.administeredAt).getTime(), value: r.total }));
  const latest = history[history.length - 1] ?? null;
  const trend = estimateTrend(points);
  return {
    points,
    latestBand: latest ? bandLabel(depressionSeverityBand(latest.total)) : null,
    trendLine: points.length >= 3 ? DIR_COPY[trend.direction] : "the trend sharpens as you complete more check-ins",
  };
}

function gadTrajectory(history: readonly Gad7Response[]): Trajectory {
  const points: SeriesPoint[] = history.map((r) => ({ t: new Date(r.administeredAt).getTime(), value: r.total }));
  const latest = history[history.length - 1] ?? null;
  const trend = estimateTrend(points);
  return {
    points,
    latestBand: latest ? bandLabel(anxietySeverityBand(latest.total)) : null,
    trendLine: points.length >= 3 ? DIR_COPY[trend.direction] : "the trend sharpens as you complete more check-ins",
  };
}

function instrumentBlock(
  heading: string,
  traj: Trajectory,
  maxValue: number,
  tone: string,
): string {
  if (traj.points.length === 0) {
    return `
      <div class="dash-instrument">
        <h4>${copy(heading)}</h4>
        <p class="muted small">${copy("No check-ins yet. Your trajectory appears here once you complete one.")}</p>
      </div>`;
  }
  const band = traj.latestBand
    ? `<p class="dash-band muted small">${copy("Most recent self-report band")}: <strong>${copy(traj.latestBand)}</strong></p>`
    : "";
  return `
    <div class="dash-instrument">
      <h4>${copy(heading)}</h4>
      ${trajectorySvg(traj.points, maxValue, tone)}
      ${band}
      <p class="dash-trend muted small">${copy(traj.trendLine)}</p>
    </div>`;
}

export interface DashboardInput {
  readonly studyId: string;
  readonly participantPseudonym: string;
  /** Optional within-user hum-derived relapse/longitudinal qualitative line, already screened. */
  readonly relapseLine?: string | null;
}

/**
 * Render the longitudinal study dashboard into the given container element. Loads PHQ-9 + GAD-7
 * history for the pseudonym, draws both trajectories, and surfaces a qualitative relapse line
 * when provided. Returns nothing; degrades to "no data yet" when the cloud is unreachable.
 */
export async function renderDashboard(container: HTMLElement, input: DashboardInput): Promise<void> {
  const [phqHistory, gadHistory] = await Promise.all([
    loadPhqHistory(input.studyId, input.participantPseudonym),
    loadGad7History(input.studyId, input.participantPseudonym),
  ]);

  const phq = instrumentBlock("Depression check-ins (PHQ-9)", phqTrajectory(phqHistory), PHQ9_MAX_TOTAL, "phq");
  const gad = instrumentBlock("Anxiety check-ins (GAD-7)", gadTrajectory(gadHistory), GAD7_MAX_TOTAL, "gad");

  // The hum-derived within-user trend (secondary endpoint) — qualitative line only, blinded.
  const relapse = input.relapseLine
    ? `<div class="dash-relapse"><h4>${copy("Your hum pattern over time")}</h4><p class="muted small">${copy(input.relapseLine)}</p></div>`
    : "";

  container.innerHTML = `
    <div class="dashboard">
      <h3>${copy("Your study trajectory")}</h3>
      <p class="muted small">${copy(
        "These are your own questionnaire answers over time, shown as a reflective trajectory. " +
          "Investigational, for research use only — not a diagnosis, and no score is calculated from your hums during the study.",
      )}</p>
      ${phq}
      ${gad}
      ${relapse}
      <p class="disclaimer">${copy(
        "A mirror of what you reported, not a verdict. If you are struggling, please reach out to a clinician or a support line.",
      )}</p>
    </div>`;
}
