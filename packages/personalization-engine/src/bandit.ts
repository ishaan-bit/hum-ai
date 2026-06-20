import { clamp01 } from "@hum-ai/shared-types";
import type { InterventionType } from "@hum-ai/affect-model-contracts";

/**
 * PERSONALIZED INTERVENTION POLICY (v2) — a contextual bandit over the user's own
 * intervention responses.
 *
 * v1 stored a flat EMA of "did this intervention help". A bandit does better: it
 * tracks each intervention's mean reward AND its uncertainty (how many times the
 * user has actually tried it), then selects to balance EXPLOIT (what has worked
 * for this person) against EXPLORE (what is under-tried). This is the standard
 * machinery behind modern personalized recommendation.
 *
 *  - Reward = risk reduction after the intervention (−riskDelta): >0 helped.
 *  - Per-arm stats use Welford's online mean/variance (numerically stable).
 *  - `selectByUCB` is deterministic (default, reproducible). `selectByThompson`
 *    is stochastic via an injected RNG (no hidden global randomness).
 *
 * The policy is *learned* in `ingestHum`; the read layer / intervention engine can
 * use it to personalize which supportive suggestion to surface among the options
 * the rule-based safety policy already allows.
 */

export interface ArmStats {
  readonly count: number;
  readonly mean: number;
  /** Welford sum of squared deviations (variance = m2/(count−1)). */
  readonly m2: number;
}

export type InterventionPolicy = Partial<Record<InterventionType, ArmStats>>;

export const newArm = (): ArmStats => ({ count: 0, mean: 0, m2: 0 });

/** Fold one reward into an arm's online mean/variance (Welford). */
export function updateArm(prev: ArmStats | undefined, reward: number): ArmStats {
  const a = prev ?? newArm();
  if (!Number.isFinite(reward)) return a;
  const count = a.count + 1;
  const delta = reward - a.mean;
  const mean = a.mean + delta / count;
  const m2 = a.m2 + delta * (reward - mean);
  return { count, mean, m2 };
}

/** Posterior mean, shrunk toward `priorMean` when the arm is under-sampled. */
export function armMean(a: ArmStats | undefined, priorMean = 0, priorStrength = 1): number {
  if (!a || a.count === 0) return priorMean;
  return (a.mean * a.count + priorMean * priorStrength) / (a.count + priorStrength);
}

/** Variance of the arm's reward (falls back to `priorVar` when under-sampled). */
export function armVariance(a: ArmStats | undefined, priorVar = 0.25): number {
  if (!a || a.count < 2) return priorVar;
  return a.m2 / (a.count - 1);
}

export interface ArmChoice {
  readonly type: InterventionType;
  /** Selection score (UCB index, or sampled value for Thompson). */
  readonly score: number;
  /** Posterior mean reward for transparency. */
  readonly mean: number;
  /** Times the user has tried this intervention. */
  readonly count: number;
}

export interface UcbOptions {
  /** Exploration weight c in mean + c·√(ln N / n). */
  readonly explore?: number;
  readonly priorMean?: number;
}

/**
 * Deterministic UCB1 selection among the allowed candidates. Under-tried arms get
 * an optimism bonus so the policy explores; well-tried high-reward arms win once
 * earned. Returns the full ranking, best first. Empty candidates ⇒ null.
 */
export function selectByUCB(
  policy: InterventionPolicy,
  candidates: readonly InterventionType[],
  opts: UcbOptions = {},
): { best: ArmChoice; ranking: readonly ArmChoice[] } | null {
  if (candidates.length === 0) return null;
  const c = opts.explore ?? 1;
  const priorMean = opts.priorMean ?? 0;
  let totalN = 0;
  for (const t of candidates) totalN += policy[t]?.count ?? 0;
  const lnN = Math.log(Math.max(totalN, 1) + 1);

  const ranking = candidates
    .map((type): ArmChoice => {
      const arm = policy[type];
      const n = arm?.count ?? 0;
      const mean = armMean(arm, priorMean);
      // Untried arms get a large but finite optimism bonus (∝ √lnN) so they're explored first.
      const bonus = c * Math.sqrt(lnN / (n + 1));
      return { type, score: mean + bonus, mean, count: n };
    })
    .sort((a, b) => b.score - a.score);

  return { best: ranking[0]!, ranking };
}

/** Box–Muller normal sample from an injected uniform RNG. */
export function gaussianSample(rng: () => number, mean: number, std: number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + std * z;
}

/**
 * Thompson sampling: draw a reward sample from each arm's Gaussian posterior and
 * pick the max. Stochastic — the RNG is injected so callers control reproducibility
 * (tests pass a seeded RNG; never a hidden global). Empty candidates ⇒ null.
 */
export function selectByThompson(
  policy: InterventionPolicy,
  candidates: readonly InterventionType[],
  rng: () => number,
  opts: { priorMean?: number; priorVar?: number } = {},
): { best: ArmChoice; ranking: readonly ArmChoice[] } | null {
  if (candidates.length === 0) return null;
  const priorMean = opts.priorMean ?? 0;
  const priorVar = opts.priorVar ?? 0.25;

  const ranking = candidates
    .map((type): ArmChoice => {
      const arm = policy[type];
      const n = arm?.count ?? 0;
      const mean = armMean(arm, priorMean);
      // Posterior std of the mean shrinks with n; under-tried arms sample widely.
      const postStd = Math.sqrt(armVariance(arm, priorVar) / (n + 1));
      return { type, score: gaussianSample(rng, mean, postStd), mean, count: n };
    })
    .sort((a, b) => b.score - a.score);

  return { best: ranking[0]!, ranking };
}

/** Confidence in the policy's current best pick (how much it has been explored). */
export function policyConfidence(policy: InterventionPolicy, candidates: readonly InterventionType[]): number {
  let tried = 0;
  for (const t of candidates) if ((policy[t]?.count ?? 0) > 0) tried++;
  const explored = candidates.length > 0 ? tried / candidates.length : 0;
  let totalN = 0;
  for (const t of candidates) totalN += policy[t]?.count ?? 0;
  return clamp01(0.5 * explored + 0.5 * clamp01(totalN / 12));
}
