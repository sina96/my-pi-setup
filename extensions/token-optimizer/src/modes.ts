export const OUTPUT_MODES = [
  "off",
  "brief",
  "caveman-lite",
  "caveman-full",
  "caveman-ultra",
] as const;
export type OutputMode = (typeof OUTPUT_MODES)[number];

export const CODING_MODES = [
  "off",
  "ponytail-lite",
  "ponytail-full",
  "ponytail-ultra",
] as const;
export type CodingMode = (typeof CODING_MODES)[number];

export type OptimizerState = {
  output: OutputMode;
  coding: CodingMode;
  rtk: boolean;
};

export const DEFAULT_STATE: OptimizerState = {
  output: "off",
  coding: "off",
  rtk: false,
};

export type OptionGuidance = {
  summary: string;
  bestFor: string;
  tradeoff: string;
  badge?: string;
};

export const OUTPUT_GUIDANCE: Record<OutputMode, OptionGuidance> = {
  off: {
    summary: "Leaves assistant response length and style unchanged.",
    bestFor: "Detailed explanations, learning, and unfamiliar work.",
    tradeoff: "Uses the most output tokens.",
  },
  brief: {
    summary: "Adds the small instruction ‘Be brief.’ without imposing a special writing style.",
    bestFor: "A low-friction default for most sessions.",
    tradeoff: "May omit background detail unless you request it.",
    badge: "suggested default",
  },
  "caveman-lite": {
    summary: "Removes filler and repetition while retaining professional sentences.",
    bestFor: "Readable but consistently compact technical work.",
    tradeoff: "Provides less narrative explanation than normal output.",
  },
  "caveman-full": {
    summary: "Uses terse sentences and fragments when clarity survives.",
    bestFor: "Routine implementation when you already know the domain.",
    tradeoff: "Less conversational and harder to skim for newcomers.",
    badge: "aggressive",
  },
  "caveman-ultra": {
    summary: "Maximizes compression with terse bullets, abbreviations, and fragments.",
    bestFor: "High-volume iteration with an experienced user.",
    tradeoff: "Lowest readability; ask explicitly whenever detail matters.",
    badge: "most aggressive",
  },
};

export const CODING_GUIDANCE: Record<CodingMode, OptionGuidance> = {
  off: {
    summary: "Does not add token-aware implementation guidance.",
    bestFor: "Tasks where architecture or implementation breadth should remain unconstrained.",
    tradeoff: "The agent may create more code, files, or abstractions.",
  },
  "ponytail-lite": {
    summary: "Completes the request normally and briefly notes a materially simpler alternative.",
    bestFor: "A conservative default for everyday coding.",
    tradeoff: "Suggestions may add a small amount of commentary.",
    badge: "suggested default",
  },
  "ponytail-full": {
    summary: "Enforces the smallest maintainable diff and avoids unnecessary ownership.",
    bestFor: "Focused fixes, features, and maintenance work.",
    tradeoff: "May deliberately skip optional scaffolding or extensibility.",
  },
  "ponytail-ultra": {
    summary: "Applies YAGNI aggressively and challenges speculative requirements.",
    bestFor: "Prototype cleanup and strongly constrained changes.",
    tradeoff: "May push back on requested flexibility that appears premature.",
    badge: "most aggressive",
  },
};

export const RTK_GUIDANCE: Record<"off" | "rtk", OptionGuidance> = {
  off: {
    summary: "Runs shell commands normally and places their standard output in model context.",
    bestFor: "Sessions with little shell usage or commands unsupported by RTK.",
    tradeoff: "Verbose command output can consume substantial context.",
  },
  rtk: {
    summary: "Lets RTK rewrite supported shell commands to produce compact tool output.",
    bestFor: "Shell-heavy coding, testing, Git, and repository exploration.",
    tradeoff: "Only future supported commands benefit; rewrites fail open.",
    badge: "shell-heavy sessions",
  },
};

export function optionGuidance(
  key: keyof OptimizerState,
  value: string | boolean,
): OptionGuidance {
  if (key === "output") return OUTPUT_GUIDANCE[value as OutputMode];
  if (key === "coding") return CODING_GUIDANCE[value as CodingMode];
  return RTK_GUIDANCE[value ? "rtk" : "off"];
}

const CAVEMAN_BASE = `CAVEMAN OUTPUT MODE. Compress explanations, not substance.
- Remove pleasantries, filler, repetition, and unnecessary headings.
- Prefer short sentences or fragments. Keep technical terms exact.
- Preserve code, commands, paths, identifiers, and error text exactly.
- State result, reason, and next action directly.`;

const CAVEMAN_INTENSITY: Record<
  Exclude<OutputMode, "off" | "brief">,
  string
> = {
  "caveman-lite":
    "Use complete professional sentences. Remove fluff and redundant explanation.",
  "caveman-full":
    "Fragments are fine. Drop obvious words and articles when clarity survives.",
  "caveman-ultra":
    "Maximum compression. Prefer terse bullets, abbreviations, and arrows for causality.",
};

const CLARITY_ESCAPE =
  "Do not compress away security warnings, irreversible-action confirmation, required steps, caveats that change advice, or requested detail. Expand when brevity would make the answer unsafe or ambiguous.";

const PONYTAIL_BASE = `PONYTAIL CODING MODE. Act like an efficient senior developer: minimize code ownership, not correctness.
Before adding code, use the first option that solves the stated need:
1. Do nothing when the need is speculative (YAGNI).
2. Use the standard library.
3. Use a native platform feature.
4. Reuse an installed dependency.
5. Use the smallest direct implementation.
Avoid unrequested abstractions, scaffolding, dependencies, configuration, and files.`;

const PONYTAIL_INTENSITY: Record<Exclude<CodingMode, "off">, string> = {
  "ponytail-lite":
    "Build what was requested, then mention a materially simpler alternative in one line when one exists.",
  "ponytail-full":
    "Enforce the ladder. Prefer the smallest maintainable diff and briefly name what you deliberately skipped.",
  "ponytail-ultra":
    "YAGNI aggressively. Prefer deletion and one-line/native solutions; challenge speculative requirements while still completing the useful core.",
};

const CODING_SAFETY =
  "Never remove input validation at trust boundaries, security, accessibility, error handling that prevents data loss, explicitly requested behavior, or a necessary verification step.";

export function outputPrompt(mode: OutputMode): string {
  if (mode === "off") return "";
  if (mode === "brief") return "Be brief.";
  return `${CAVEMAN_BASE}\n${CAVEMAN_INTENSITY[mode]}\n${CLARITY_ESCAPE}`;
}

export function codingPrompt(mode: CodingMode): string {
  if (mode === "off") return "";
  return `${PONYTAIL_BASE}\n${PONYTAIL_INTENSITY[mode]}\n${CODING_SAFETY}`;
}

export function isOptimizerState(value: unknown): value is OptimizerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return (
    OUTPUT_MODES.includes(state.output as OutputMode) &&
    CODING_MODES.includes(state.coding as CodingMode) &&
    typeof state.rtk === "boolean"
  );
}
