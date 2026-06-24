import type { AffectAxisPriors } from "@hum-ai/orchestrator";
import { axisPriorsFromArtifact } from "@hum-ai/native-corpus";
import { hasPromotedPopulationModel, type PopulationArtifact } from "./train";

/**
 * THE CLIENT SEAM — turn a population artifact into orchestrator-ready axis priors, and pick
 * the right prior per axis across the THREE tiers. A population baseline is a NATIVE-domain
 * prior (trained on real hums, just pooled across people), so it slots in through the same
 * `axisPriorsFromArtifact` seam and is in-domain for hums — no far-domain penalty.
 */

/** Population axis priors, but only once the contributor-diversity + axis gates have passed. */
export function populationAxisPriors(artifact: PopulationArtifact | null): AffectAxisPriors {
  if (!hasPromotedPopulationModel(artifact)) return {};
  return axisPriorsFromArtifact(artifact!.axes);
}

export interface AxisPriorTiers {
  /** The user's OWN promoted hum-native prior — most personalized, highest precedence. */
  readonly personal?: AffectAxisPriors;
  /** The population baseline prior — what every new user starts from (middle precedence). */
  readonly population?: AffectAxisPriors;
  /** The shipped far-domain acted-speech prior — fallback (lowest precedence; abstains OOD). */
  readonly farDomain?: AffectAxisPriors;
}

/**
 * Per-axis precedence: a user's own promoted native model > the population baseline > the
 * far-domain prior. So a brand-new user (no personal model yet) reads through the population
 * baseline the whole community improved — and as they confirm their own hums and promote a
 * personal model, the read shifts onto their own. This is "the baseline keeps improving across
 * users, with per-user personalization on top."
 */
export function selectAxisPriors(tiers: AxisPriorTiers): AffectAxisPriors {
  const personal = tiers.personal ?? {};
  const population = tiers.population ?? {};
  const farDomain = tiers.farDomain ?? {};
  return {
    valence: personal.valence ?? population.valence ?? farDomain.valence,
    arousal: personal.arousal ?? population.arousal ?? farDomain.arousal,
  };
}
