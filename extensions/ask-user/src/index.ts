import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

const MAX_OPTIONS = 8;
const DEFAULT_TIMEOUT_MS = 0;
const FREEFORM_LABEL = "Write my own answer…";

const OptionSchema = Type.Object({
  label: Type.String({ description: "Short answer label" }),
  description: Type.Optional(Type.String({ description: "Optional short explanation" })),
});

const AskUserSchema = Type.Object({
  question: Type.String({ description: "One focused question to ask the user" }),
  context: Type.Optional(Type.String({ description: "Short context that helps the user decide" })),
  options: Type.Optional(Type.Array(OptionSchema, {
    maxItems: MAX_OPTIONS,
    description: "Optional answer choices. Omit for a freeform-only question.",
  })),
  allowFreeform: Type.Optional(Type.Boolean({ description: "Allow a custom text answer. Default: true" })),
  timeout: Type.Optional(Type.Integer({
    minimum: 1_000,
    maximum: 600_000,
    description: "Optional auto-cancel timeout in milliseconds",
  })),
});

type AskUserInput = Static<typeof AskUserSchema>;

interface AskUserDetails {
  question: string;
  options: string[];
  answer: string | null;
  kind: "selection" | "freeform" | "cancelled" | "unavailable";
}

function optionDisplay(option: { label: string; description?: string }): string {
  return option.description ? `${option.label} — ${option.description}` : option.label;
}

function result(
  params: AskUserInput,
  answer: string | null,
  kind: AskUserDetails["kind"],
  message: string,
) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: {
      question: params.question,
      options: (params.options ?? []).map((option) => option.label),
      answer,
      kind,
    } satisfies AskUserDetails,
  };
}

export default function askUser(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description: "Ask the user one focused question, optionally with up to eight choices and a freeform answer. Use this when requirements are ambiguous or a meaningful decision needs explicit user input.",
    promptSnippet: "Ask one focused question with optional choices and a freeform response",
    promptGuidelines: [
      "Use ask_user when requirements are ambiguous, multiple valid choices have meaningful trade-offs, or explicit approval is needed.",
      "Ask exactly one focused question per ask_user call; gather relevant evidence before asking.",
      "Do not use ask_user for trivial choices that can be inferred safely from the user's request or project conventions.",
    ],
    parameters: AskUserSchema,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const options = params.options ?? [];
      const allowFreeform = params.allowFreeform !== false;
      const timeout = params.timeout ?? DEFAULT_TIMEOUT_MS;

      if (options.length === 0 && !allowFreeform) {
        throw new Error("ask_user needs at least one option when freeform answers are disabled");
      }
      if (signal?.aborted) {
        return result(params, null, "cancelled", "Question cancelled before it was shown.");
      }
      if (!ctx.hasUI) {
        return result(
          params,
          null,
          "unavailable",
          `Interactive UI is unavailable. Ask the user in plain text instead: ${params.question}`,
        );
      }

      pi.events.emit("herdr:blocked", { active: true, label: "Waiting for user response" });
      try {
        const dialogOptions = {
          ...(timeout > 0 ? { timeout } : {}),
          ...(signal ? { signal } : {}),
        };
        let answer: string | undefined;
        let kind: AskUserDetails["kind"] = "freeform";

        if (options.length === 0) {
          answer = await ctx.ui.input(params.question, params.context ?? "Type your answer", dialogOptions);
        } else {
          const choices = options.map(optionDisplay);
          if (allowFreeform) choices.push(FREEFORM_LABEL);
          const title = params.context ? `${params.question}\n${params.context}` : params.question;
          const selected = await ctx.ui.select(title, choices, dialogOptions);
          if (!selected) {
            return result(params, null, "cancelled", "User dismissed the question without answering. Do not assume a choice.");
          }

          if (selected === FREEFORM_LABEL) {
            answer = await ctx.ui.input(params.question, "Type your answer", dialogOptions);
          } else {
            const selectedIndex = choices.indexOf(selected);
            answer = options[selectedIndex]?.label;
            kind = "selection";
          }
        }

        const normalized = answer?.trim();
        if (!normalized) {
          return result(params, null, "cancelled", "User dismissed the question without answering. Do not assume a choice.");
        }
        return result(
          params,
          normalized,
          kind,
          kind === "selection" ? `User selected: ${normalized}` : `User answered: ${normalized}`,
        );
      } finally {
        pi.events.emit("herdr:blocked", { active: false });
      }
    },

    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("ask_user "));
      text += theme.fg("muted", args.question);
      if (args.context) text += `\n${theme.fg("dim", args.context)}`;
      if (args.options?.length) {
        text += `\n${theme.fg("dim", args.options.map((option, index) => `${index + 1}. ${option.label}`).join("  "))}`;
      }
      return new Text(text, 0, 0);
    },

    renderResult(toolResult, _options, theme) {
      const details = toolResult.details as AskUserDetails | undefined;
      if (!details || !details.answer) {
        return new Text(theme.fg("warning", "✗ no answer"), 0, 0);
      }
      const prefix = details.kind === "selection" ? "selected" : "answered";
      return new Text(
        theme.fg("success", "✓ ") + theme.fg("muted", `${prefix}: `) + theme.fg("accent", details.answer),
        0,
        0,
      );
    },
  });
}
