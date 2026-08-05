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
