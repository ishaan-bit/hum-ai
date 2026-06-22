/**
 * "Save today's Aura" — the share artifact.
 *
 * Mints a gallery-grade 9:16 poster from a single read: the orb in full glow on its
 * state-coloured atmosphere wash, the date, the qualitative affect-lean phrase, a tiny
 * generative signature mark, and an honesty watermark. By design the card carries NO numbers,
 * NO axis values, and NO clinical language — only derived colour + a safety-screened caption —
 * so the brag travels WITH the honesty, and virality reinforces trust instead of overclaiming.
 *
 * Uses the Web Share API where available (file share sheet on iOS/Android), and falls back to a
 * plain download everywhere else. Never auto-shares — always an explicit user action.
 */
import type { StateVisual } from "./theme";
import { isConfidenceCopySafe, validateUserFacingText } from "@hum-ai/safety-language";

export interface AuraCardInput {
  readonly visual: StateVisual;
  /** A safety-screened qualitative phrase (uf.innerState ?? uf.headline) — never a number. */
  readonly caption: string;
  /** A human date label like "22 June 2026". */
  readonly dateLabel: string;
}

export type ShareOutcome = "shared" | "downloaded" | "failed";

const TAU = Math.PI * 2;
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

function hsl(v: StateVisual, dl: number, alpha: number): string {
  const l = clamp(v.light + dl, 4, 94);
  return `hsla(${v.hue.toFixed(1)}, ${v.sat.toFixed(1)}%, ${l.toFixed(1)}%, ${alpha.toFixed(3)})`;
}

/** A tiny deterministic hash → seed, so the same read paints the same signature mark. */
function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

function drawPoster(ctx: CanvasRenderingContext2D, W: number, H: number, input: AuraCardInput): void {
  const { visual: v, caption, dateLabel } = input;
  const cx = W / 2;
  const cy = H * 0.4;
  const R = W * 0.3;

  // Base + atmosphere wash.
  ctx.fillStyle = "#0a0b0f";
  ctx.fillRect(0, 0, W, H);
  const wash = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, H * 0.85);
  wash.addColorStop(0, hsl(v, 6, 0.5 * v.evidence));
  wash.addColorStop(0.45, hsl(v, -4, 0.22 * v.evidence));
  wash.addColorStop(1, "rgba(8,9,14,0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  // Orb halo + core (static, full glow).
  ctx.globalCompositeOperation = "lighter";
  const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * (1 + v.reach * 1.8));
  halo.addColorStop(0, hsl(v, 22, 0.45 * v.evidence));
  halo.addColorStop(0.5, hsl(v, 6, 0.18 * v.evidence));
  halo.addColorStop(1, hsl(v, 0, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, R * (1 + v.reach * 1.8), 0, TAU);
  ctx.fill();

  const postureY = -v.valence * R * 0.26;
  const core = ctx.createRadialGradient(cx, cy + postureY - R * 0.18, R * 0.05, cx, cy + postureY, R);
  const a = 0.5 + v.evidence * 0.46;
  core.addColorStop(0, hsl(v, 42, a));
  core.addColorStop(0.55, hsl(v, 14, a * 0.92));
  core.addColorStop(0.9, hsl(v, -2, a * 0.5));
  core.addColorStop(1, hsl(v, -6, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy + postureY, R, 0, TAU);
  ctx.fill();

  // Rim — crisp when evidence is high, diffuse when developing (confidence made physical).
  ctx.lineWidth = 1 + v.evidence * 4;
  ctx.strokeStyle = hsl(v, 20 + v.evidence * 26, 0.12 + v.evidence * 0.7);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.stroke();

  // Generative signature: a small constellation seeded from the caption+date.
  const seed = seedFrom(caption + dateLabel);
  let s = seed;
  const rng = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const sigX = W * 0.5;
  const sigY = H * 0.86;
  for (let i = 0; i < 7; i++) {
    const ang = rng() * TAU;
    const rad = rng() * W * 0.12;
    ctx.fillStyle = hsl(v, 40, 0.5);
    ctx.beginPath();
    ctx.arc(sigX + Math.cos(ang) * rad, sigY + Math.sin(ang) * rad * 0.5, 2 + rng() * 3, 0, TAU);
    ctx.fill();
  }

  // Text.
  ctx.globalCompositeOperation = "source-over";
  ctx.textAlign = "center";

  ctx.fillStyle = "rgba(232,234,240,0.55)";
  ctx.font = "600 30px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("HUM AI", cx, H * 0.085);

  ctx.fillStyle = "rgba(232,234,240,0.6)";
  ctx.font = "500 30px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText(dateLabel.toUpperCase(), cx, cy + R + H * 0.07);

  // The caption — the editorial serif reveal line, wrapped.
  ctx.fillStyle = "rgba(244,245,248,0.96)";
  const lines = wrap(ctx, caption, W * 0.82, "italic 600 64px 'Iowan Old Style', Georgia, 'Times New Roman', serif");
  ctx.font = "italic 600 64px 'Iowan Old Style', Georgia, 'Times New Roman', serif";
  const startY = cy + R + H * 0.13;
  lines.forEach((ln, i) => ctx.fillText(ln, cx, startY + i * 78));

  // Honesty watermark.
  ctx.fillStyle = "rgba(180,186,196,0.5)";
  ctx.font = "500 26px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("A reflection from a 12-second hum · on-device · non-clinical · not a diagnosis", cx, H * 0.955);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, font: string): string[] {
  ctx.font = font;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

/** Render the poster to a Blob (9:16, 1080×1920). */
export function renderAuraBlob(input: AuraCardInput): Promise<Blob | null> {
  // Defense-in-depth: the caption is already screened by the spine, but the poster is the one
  // user-visible surface with no pixel-level test — re-verify it carries no number/clinical phrase.
  if (!isConfidenceCopySafe(input.caption) || !validateUserFacingText(input.caption).ok) {
    return Promise.resolve(null);
  }
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  drawPoster(ctx, W, H, input);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

/** Mint + share/download the poster. Must be called from a user gesture. */
export async function saveAuraCard(input: AuraCardInput): Promise<ShareOutcome> {
  try {
    const blob = await renderAuraBlob(input);
    if (!blob) return "failed";
    const file = new File([blob], "my-aura.png", { type: "image/png" });

    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
      share?: (data: ShareData) => Promise<void>;
    };
    if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share({
          files: [file],
          title: "My Aura",
          text: "My inner state today, from a 12-second hum. · Hum AI",
        });
        return "shared";
      } catch {
        // User cancelled the share sheet, or it failed — fall through to download.
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "my-aura.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "downloaded";
  } catch {
    return "failed";
  }
}
