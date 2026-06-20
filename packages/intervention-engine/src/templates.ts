import type { EvidenceLevel } from "@hum-ai/safety-language";
import type { HumRegulationState } from "./states";

/**
 * INTERVENTION TEMPLATE LIBRARY.
 *
 * A small, curated set of practical "small reset" steps — each safe, low-risk, and
 * doable in 1–5 minutes. Quality over quantity. Every string here is plain,
 * non-clinical, and is screened against `@hum-ai/safety-language` by the
 * intervention-of-day self-check and by the package tests.
 *
 * A template is SUPPORT, never treatment: nothing here claims to diagnose, treat,
 * cure, or prevent anything. Music templates are justified as regulation support
 * only (`intervention_support_source`: de Witte et al. — music interventions reduce
 * stress-related outcomes), never as diagnosis or as a depression treatment.
 */

/** User-facing intervention category (the daily-support taxonomy). */
export type InterventionCategory =
  | "breath_regulation"
  | "grounding"
  | "music_regulation"
  | "movement_reset"
  | "rest_recovery"
  | "journaling"
  | "social_check_in"
  | "reduce_load"
  | "repeat_capture"
  | "no_action_needed"
  | "safety_support";

export const INTERVENTION_CATEGORIES: readonly InterventionCategory[] = [
  "breath_regulation",
  "grounding",
  "music_regulation",
  "movement_reset",
  "rest_recovery",
  "journaling",
  "social_check_in",
  "reduce_load",
  "repeat_capture",
  "no_action_needed",
  "safety_support",
];

export type InterventionIntensity = "low" | "moderate";

/**
 * How a music template steers in valence–arousal space. Regulation only — settle a
 * tense state, steady a mixed one, gently lift a low one, maintain a calm one, or
 * support focus for a positive one. Never a clinical target.
 */
export type MusicVaTarget = "settle" | "steady" | "gentle_lift" | "maintain" | "focused_momentum";

export interface InterventionTemplate {
  readonly id: string;
  readonly category: InterventionCategory;
  readonly title: string;
  readonly instruction: string;
  /** The "so ..." clause completing the one-sentence whySuggested (why THIS step helps). */
  readonly whyAction: string;
  readonly targetStates: readonly HumRegulationState[];
  readonly contraindicatedStates: readonly HumRegulationState[];
  /** Minimum qualitative evidence band before this step may be offered. */
  readonly minEvidence: EvidenceLevel;
  /** Whether this step requires an active personal baseline (≥5 eligible hums). */
  readonly requiresBaselineMature: boolean;
  readonly intensity: InterventionIntensity;
  readonly durationMinutes: number;
  readonly safetyNote?: string;
  /**
   * Source ids (from docs/source/INDEX.md) that ground this step — either its
   * content (e.g. music templates → `intervention_support_source`) or the
   * within-user gating that surfaces it (e.g. needs_support → the longitudinal
   * source). Empty when the step is a generic low-risk action needing no source.
   */
  readonly sourceRefs: readonly string[];
  readonly musicTarget?: MusicVaTarget;
}

const MUSIC = ["intervention_support_source"] as const;

/**
 * The library. ~30 templates; each affective and meta state has at least one
 * low-evidence, baseline-not-required fallback so selection never comes up empty.
 */
export const INTERVENTION_TEMPLATES: readonly InterventionTemplate[] = [
  // ---- high_activation_negative: downshift (stress/anxiety/anger/fear region) ----
  {
    id: "breath_long_exhale",
    category: "breath_regulation",
    title: "Lower the load for two minutes",
    instruction:
      "Sit down, relax your jaw, and breathe out slowly six times. Keep each exhale longer than the inhale.",
    whyAction: "a longer exhale helps bring that activation down a notch",
    targetStates: ["high_activation_negative", "mixed_unsettled"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 2,
    safetyNote: "If you feel light-headed, return to normal breathing and stop.",
    sourceRefs: [],
  },
  {
    id: "box_breath",
    category: "breath_regulation",
    title: "A minute of box breathing",
    instruction:
      "Breathe in for four, hold for four, out for four, hold for four. Do this for about a minute, then breathe normally.",
    whyAction: "slow, even breathing is a simple way to ease a more activated moment",
    targetStates: ["high_activation_negative", "mixed_unsettled"],
    contraindicatedStates: ["low_recovery"],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 2,
    safetyNote: "If holding your breath feels uncomfortable, just breathe slowly and evenly instead.",
    sourceRefs: [],
  },
  {
    id: "grounding_5senses",
    category: "grounding",
    title: "A quick 5-4-3-2-1 reset",
    instruction:
      "Name five things you can see, four you can hear, three you can touch, and two you can smell. Then take one slow breath. Take it slowly.",
    whyAction: "a short grounding step steadies things without asking much of you",
    targetStates: ["high_activation_negative", "mixed_unsettled", "low_confidence", "not_enough_history"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 3,
    sourceRefs: [],
  },
  {
    id: "grounding_feet_breath",
    category: "grounding",
    title: "Feet down, one slow breath",
    instruction:
      "Plant both feet on the floor, feel the contact, and take one slow breath in and a longer breath out. Repeat three times.",
    whyAction: "one simple grounding action settles the moment without asking you to analyse it",
    targetStates: [
      "high_activation_negative",
      "mixed_unsettled",
      "needs_support",
      "low_confidence",
      "not_enough_history",
    ],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 2,
    sourceRefs: [],
  },
  {
    id: "music_settle",
    category: "music_regulation",
    title: "Put on something steady and low-key",
    instruction:
      "Play one calm, low-stimulation track and just listen for a few minutes. Pick something steady rather than energising.",
    whyAction: "steady, low-stimulation music is a simple way to help a tense moment settle",
    targetStates: ["high_activation_negative"],
    contraindicatedStates: [],
    minEvidence: "low",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 4,
    sourceRefs: [...MUSIC],
    musicTarget: "settle",
  },
  {
    id: "music_steady",
    category: "music_regulation",
    title: "A steady, low-complexity track",
    instruction:
      "Play one simple, steady track — nothing busy or surprising — and let it run while you do one small thing.",
    whyAction: "a steady, low-complexity track can hold a mixed moment together without adding noise",
    targetStates: ["mixed_unsettled"],
    contraindicatedStates: [],
    minEvidence: "low",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 4,
    sourceRefs: [...MUSIC],
    musicTarget: "steady",
  },
  {
    id: "unclench_walk",
    category: "movement_reset",
    title: "Step away and unclench",
    instruction:
      "Step away for a moment, unclench your jaw and hands, and take a short, brisk walk if you can — even just down the hall.",
    whyAction: "a brief change of place and some easy movement lets a charged moment discharge safely",
    targetStates: ["high_activation_negative"],
    contraindicatedStates: ["low_recovery"],
    minEvidence: "low",
    requiresBaselineMature: false,
    intensity: "moderate",
    durationMinutes: 3,
    sourceRefs: [],
  },
  {
    id: "reduce_load_one_thing",
    category: "reduce_load",
    title: "Take one thing off the next hour",
    instruction:
      "Look at the next hour and remove or postpone one task. Give that time back to a single, simpler thing.",
    whyAction: "lowering demand for a short while is safer than adding more to do",
    targetStates: ["high_activation_negative", "needs_support"],
    contraindicatedStates: [],
    minEvidence: "medium",
    requiresBaselineMature: true,
    intensity: "moderate",
    durationMinutes: 3,
    sourceRefs: [],
  },

  // ---- low_recovery: rest / recovery, avoid energising push ----
  {
    id: "rest_pause",
    category: "rest_recovery",
    title: "Take a short, real pause",
    instruction:
      "Step away from the screen, sit or lie back, and let your shoulders drop for a few minutes. Nothing to achieve here.",
    whyAction: "a short recovery step fits better than pushing for more",
    targetStates: ["low_recovery"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 5,
    sourceRefs: [],
  },
  {
    id: "hydrate_stretch",
    category: "movement_reset",
    title: "Water and a gentle stretch",
    instruction:
      "Drink a glass of water and do one slow, easy stretch — reach up, roll your shoulders, loosen your neck. Keep it gentle.",
    whyAction: "a small, low-effort body reset supports recovery without an energising push",
    targetStates: ["low_recovery", "low_mood"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 2,
    sourceRefs: [],
  },
  {
    id: "tea_reset",
    category: "rest_recovery",
    title: "Make a warm drink, slowly",
    instruction:
      "Make a warm, non-energising drink and take a few minutes to just have it — no screen, no rush.",
    whyAction: "a slow, small comfort step supports recovery when energy is low",
    targetStates: ["low_recovery", "low_mood"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 5,
    sourceRefs: [],
  },
  {
    id: "recovery_reduce_load",
    category: "reduce_load",
    title: "Lower the bar for today",
    instruction:
      "Pick the one thing that actually matters today and let the rest wait. Aim for 'enough', not 'a lot'.",
    whyAction: "a tired-sounding pattern is a cue to ease the load rather than spend energy you may not have",
    targetStates: ["low_recovery"],
    contraindicatedStates: [],
    minEvidence: "medium",
    requiresBaselineMature: true,
    intensity: "moderate",
    durationMinutes: 3,
    sourceRefs: [],
  },

  // ---- low_mood: tiny activation, light movement, daylight, low-effort social ----
  {
    id: "light_movement",
    category: "movement_reset",
    title: "A two-minute gentle move",
    instruction:
      "Stand up and move gently for two minutes — a slow walk, a few easy stretches, or stepping outside. Keep it small and doable.",
    whyAction: "a small, doable movement is a gentle lift when things feel quieter than usual",
    targetStates: ["low_mood"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 2,
    sourceRefs: [],
  },
  {
    id: "sunlight_step",
    category: "grounding",
    title: "Step toward some daylight",
    instruction:
      "If you can, go near a window or step outside for a couple of minutes. Let some light and air reach you.",
    whyAction: "a little daylight and air is an easy, low-effort lift for a lower-mood moment",
    targetStates: ["low_mood"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 3,
    sourceRefs: [],
  },
  {
    id: "social_light",
    category: "social_check_in",
    title: "Send one small hello",
    instruction:
      "Message or call one person for a light, low-pressure check-in. It doesn't need to be deep — just a small connection.",
    whyAction: "a light social check-in is a gentle lift, and it asks very little of you",
    targetStates: ["low_mood"],
    contraindicatedStates: [],
    minEvidence: "low",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 3,
    sourceRefs: [],
  },
  {
    id: "music_gentle_lift",
    category: "music_regulation",
    title: "One song you quietly like",
    instruction:
      "Play a single track you have a soft spot for — something warm rather than high-energy. Just listen.",
    whyAction: "a warm, familiar track is a gentle lift for a quieter moment",
    targetStates: ["low_mood"],
    contraindicatedStates: [],
    minEvidence: "low",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 4,
    sourceRefs: [...MUSIC],
    musicTarget: "gentle_lift",
  },
  {
    id: "tiny_task_done",
    category: "movement_reset",
    title: "Finish one tiny thing",
    instruction:
      "Pick the smallest useful task you can think of — a dish, an email, a tidy corner — and complete just that one.",
    whyAction: "one tiny finished task is a small, doable lift on a lower day",
    targetStates: ["low_mood"],
    contraindicatedStates: [],
    minEvidence: "low",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 3,
    sourceRefs: [],
  },

  // ---- mixed_unsettled: simplify, one grounding action, no complex introspection ----
  {
    id: "simplify_next_ten",
    category: "reduce_load",
    title: "Simplify the next ten minutes",
    instruction:
      "Choose one small, clear thing to do next, and let the rest wait. One step at a time is plenty right now.",
    whyAction: "keeping the next few minutes simple is steadier than trying to untangle it all",
    targetStates: ["mixed_unsettled"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 2,
    sourceRefs: [],
  },
  {
    id: "name_it_note",
    category: "journaling",
    title: "Name it in one line",
    instruction:
      "Write one short line for how the moment feels — just a label, not an essay. Then set it down and move on.",
    whyAction: "naming the moment in one line is a light way to make it feel clearer without overthinking it",
    targetStates: ["mixed_unsettled", "neutral_usual"],
    contraindicatedStates: [],
    minEvidence: "low",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 2,
    sourceRefs: [],
  },

  // ---- calm_regulated / neutral_usual: maintain, do not over-intervene ----
  {
    id: "maintain_rhythm",
    category: "no_action_needed",
    title: "You're steady — keep your rhythm",
    instruction:
      "Nothing needed right now. Carry on with what you were doing, and maybe notice what's working today.",
    whyAction: "the best step is simply to keep your rhythm",
    targetStates: ["calm_regulated", "neutral_usual"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 1,
    sourceRefs: [],
  },
  {
    id: "music_maintain",
    category: "music_regulation",
    title: "Keep the good groove going",
    instruction:
      "If you'd like, put on something that matches your steady mood and let it play in the background.",
    whyAction: "music here is just to match and maintain where you already are",
    targetStates: ["calm_regulated"],
    contraindicatedStates: [],
    minEvidence: "low",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 3,
    sourceRefs: [...MUSIC],
    musicTarget: "maintain",
  },
  {
    id: "gentle_checkin_note",
    category: "journaling",
    title: "A one-line note to yourself",
    instruction:
      "Jot a single line about how today feels so far. No need to make it tidy or deep.",
    whyAction: "a light note is a small way to stay in touch with yourself",
    targetStates: ["neutral_usual", "calm_regulated"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 2,
    sourceRefs: [],
  },
  {
    id: "gratitude_one",
    category: "journaling",
    title: "Note one good thing",
    instruction:
      "Write down one thing that's going okay right now, however small. That's the whole task.",
    whyAction: "noticing one good thing is a light way to keep a steady moment going",
    targetStates: ["calm_regulated", "positive_activation", "neutral_usual"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 1,
    sourceRefs: [],
  },

  // ---- positive_activation: channel energy into one focused thing ----
  {
    id: "channel_one_task",
    category: "journaling",
    title: "Channel it into one task",
    instruction:
      "You've got energy — pick the single task that matters most and give it the next few focused minutes. One thing, not five.",
    whyAction: "channelling that energy into one focused task makes the most of it",
    targetStates: ["positive_activation"],
    contraindicatedStates: ["low_recovery", "needs_support"],
    minEvidence: "low",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 3,
    sourceRefs: [],
  },
  {
    id: "music_focused_momentum",
    category: "music_regulation",
    title: "A track to ride the momentum",
    instruction:
      "Put on one track that helps you focus, and start the thing you've been meaning to begin.",
    whyAction: "music here is to support focus and momentum, not to wind you down",
    targetStates: ["positive_activation"],
    contraindicatedStates: ["low_recovery", "needs_support", "high_activation_negative", "low_mood"],
    minEvidence: "low",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 3,
    sourceRefs: [...MUSIC],
    musicTarget: "focused_momentum",
  },

  // ---- needs_support: safe support; reduce load + reach trusted support if persistent ----
  {
    id: "support_reduce_and_reach",
    category: "safety_support",
    title: "Ease the load, and lean on someone",
    instruction:
      "Take one thing off your plate today, and consider sharing how you've been doing with someone you trust. Small steps count.",
    whyAction: "easing the load and reaching out is a caring next step",
    targetStates: ["needs_support"],
    contraindicatedStates: [],
    minEvidence: "medium",
    requiresBaselineMature: true,
    intensity: "moderate",
    durationMinutes: 4,
    safetyNote:
      "This is a supportive suggestion, not a clinical assessment. If things feel unmanageable or unsafe, please reach out to someone you trust or a local support line.",
    // Grounds the WITHIN-USER gating that surfaces needs_support (DVDSA within-user
    // change), not the reduce-load/reach-out action itself — that is a generic,
    // low-risk support step that needs no clinical source.
    sourceRefs: ["longitudinal_voice_treatment_response_source"],
  },
  {
    id: "slow_minute_rest",
    category: "rest_recovery",
    title: "One slow, unhurried minute",
    instruction:
      "Give yourself one minute with nothing to do. Sit back, soften your breathing, and let the minute simply pass.",
    whyAction: "a single slow minute is a low-effort way to ease pressure when things feel heavy",
    targetStates: ["needs_support", "high_activation_negative", "low_recovery"],
    contraindicatedStates: [],
    minEvidence: "low",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 1,
    sourceRefs: [],
  },

  // ---- poor_capture: repeat the hum, never interpret ----
  {
    id: "repeat_hum",
    category: "repeat_capture",
    title: "Let's try one more hum",
    instruction:
      "That hum was hard to read clearly. When you're ready, find a quieter spot and record a steady twelve-second hum.",
    whyAction: "the most useful next step is simply another one, with no reading into this one",
    targetStates: ["poor_capture"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 1,
    sourceRefs: ["hum_spec"],
  },
  {
    id: "quiet_space_repeat",
    category: "repeat_capture",
    title: "Find a quieter moment to hum",
    instruction:
      "Background noise can blur a hum. When it's calmer around you, record another steady twelve-second hum close to the mic.",
    whyAction: "a quieter retry will give a clearer, more useful read",
    targetStates: ["poor_capture"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 1,
    sourceRefs: ["hum_spec"],
  },

  // ---- low_confidence / not_enough_history: general option, no emotional interpretation ----
  {
    id: "low_conf_grounding",
    category: "grounding",
    title: "A small reset while the read settles",
    instruction:
      "If you'd like a small reset anyway, take three slow breaths with a longer exhale. No need to read anything into today's hum.",
    whyAction: "this is an optional small reset rather than a response to a specific signal",
    targetStates: ["low_confidence"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 2,
    sourceRefs: [],
  },
  {
    id: "baseline_forming_general",
    category: "grounding",
    title: "Still learning your usual — a gentle option",
    instruction:
      "There's nothing to read into yet. If you want a small step, take a slow minute of longer exhales.",
    whyAction: "this is a general option rather than a response to today's hum",
    targetStates: ["not_enough_history"],
    contraindicatedStates: [],
    minEvidence: "early_baseline",
    requiresBaselineMature: false,
    intensity: "low",
    durationMinutes: 1,
    sourceRefs: [],
  },
];
