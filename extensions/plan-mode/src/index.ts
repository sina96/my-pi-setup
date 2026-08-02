import type {
  AssistantMessage,
  TextContent,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

type PlanMode = "off" | "plan" | "execute";

interface PlanState {
  mode: PlanMode;
  plan: string;
}

const ENTRY_TYPE = "simply-plan-mode";
const SHORTCUT = "ctrl+shift+l";
const READ_ONLY_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "bash",
  "ask_user",
  "simply_find",
  "simply_grep",
  "fffind",
  "ffgrep",
  "fff-multi-grep",
  "web_search",
  "fetch_content",
  "get_search_content",
]);

const PLAN_PROMPT = `You are in PLAN mode.

Explore the project and produce a concrete implementation plan, but do not modify files or project state. Use only the available read-only tools. If a material requirement is ambiguous, use ask_user when available or ask one focused question in plain text.

End with a section headed "## Plan". Make each step self-contained: name relevant files, describe exact changes, note important constraints, and include validation commands. Do not claim to have implemented anything.`;

function executePrompt(plan: string): string {
  return `You are in EXECUTE mode. Implement the approved plan below. Work through every step, validate the result, and call plan_complete only after all steps are complete. If the plan is invalidated by new evidence, stop and explain rather than silently changing its intent.

<approved_plan>
${plan}
</approved_plan>`;
}

function extractAssistantText(messages: unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as AssistantMessage;
    if (message?.role !== "assistant" || message.stopReason === "error") continue;
    const text = message.content
      .filter((part): part is TextContent => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return undefined;
}

function isSafeBash(command: string): boolean {
  if (!command.trim()) return false;
  if (/[;><`]|\$\(|\n/.test(command)) return false;
  if (/\b(?:rm|mv|cp|chmod|chown|touch|mkdir|rmdir|kill|sudo|tee)\b/.test(command)) return false;
  if (/(?:--exec(?:-batch)?\b|--pre\b|-delete\b|-exec\b|-ok\b|-fprint\b|-fls\b)/.test(command)) return false;

  const safeCommand = /^\s*(?:pwd|ls|find|fd|rg|grep|cat|head|tail|wc|stat|file|which|type|realpath)\b/;
  const safeGit = /^\s*git\s+(?:status|diff|log|show|branch\s+--show-current|rev-parse|ls-files)\b/;
  return command.split(/\|/).every((part) => safeCommand.test(part) || safeGit.test(part));
}

export default function planMode(pi: ExtensionAPI) {
  let state: PlanState = { mode: "off", plan: "" };
  let savedTools: string[] | undefined;

  const persist = () => pi.appendEntry(ENTRY_TYPE, { ...state });

  const restore = (ctx: ExtensionContext) => {
    state = { mode: "off", plan: "" };
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
      const data = entry.data as Partial<PlanState> | undefined;
      if (data?.mode === "off" || data?.mode === "plan" || data?.mode === "execute") {
        state = { mode: data.mode, plan: typeof data.plan === "string" ? data.plan : "" };
      }
    }
  };

  const updateUi = (ctx: ExtensionContext) => {
    (globalThis as Record<string, unknown>).__simplyPlanMode = { mode: state.mode };
    pi.events.emit("plan-mode:state", { mode: state.mode });
    if (!ctx.hasUI) return;
    if (state.mode === "off") {
      ctx.ui.setStatus("plan-mode", undefined);
      ctx.ui.setWidget("plan-mode", undefined);
      return;
    }
    const label = state.mode === "plan" ? "PLAN · read-only" : "EXECUTE · approved plan";
    const color = state.mode === "plan" ? "accent" : "success";
    ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg(color, label));
    ctx.ui.setWidget("plan-mode", [ctx.ui.theme.fg(color, `◆ ${label}`)]);
  };

  const configuredTools = () => pi.getActiveTools().filter((name) => name !== "plan_complete");

  const goalIsActive = () =>
    ((globalThis as Record<string, unknown>).__simplyGoal as { active?: boolean } | undefined)?.active === true;

  const enterPlan = (ctx: ExtensionContext, preservePlan = false) => {
    if (goalIsActive()) {
      ctx.ui.notify("Pause or finish the active goal before entering plan mode", "warning");
      return;
    }
    if (!savedTools) savedTools = configuredTools();
    state = { mode: "plan", plan: preservePlan ? state.plan : "" };
    pi.setActiveTools(savedTools.filter((name) => READ_ONLY_TOOLS.has(name)));
    persist();
    updateUi(ctx);
    ctx.ui.notify("Plan mode: read-only exploration", "info");
  };

  const enterExecute = (ctx: ExtensionContext) => {
    if (goalIsActive()) {
      ctx.ui.notify("Pause or finish the active goal before entering execute mode", "warning");
      return false;
    }
    if (!state.plan.trim()) {
      ctx.ui.notify("No captured plan yet. Finish a planning turn first.", "warning");
      return false;
    }
    const baseline = savedTools ?? configuredTools();
    savedTools = baseline;
    state.mode = "execute";
    pi.setActiveTools([...new Set([...baseline, "plan_complete"])]);
    persist();
    updateUi(ctx);
    ctx.ui.notify("Execute mode: tools restored", "info");
    return true;
  };

  const enterOff = (ctx: ExtensionContext, message = "Plan mode off") => {
    state.mode = "off";
    const baseline = savedTools ?? configuredTools();
    pi.setActiveTools(baseline.filter((name) => name !== "plan_complete"));
    savedTools = undefined;
    persist();
    updateUi(ctx);
    ctx.ui.notify(message, "info");
  };

  pi.registerTool({
    name: "plan_complete",
    label: "Plan Complete",
    description: "Finish the active approved plan. Call only in EXECUTE mode after every plan step and validation are complete.",
    parameters: Type.Object({}),
    async execute(_id, _params, _signal, _update, ctx) {
      if (state.mode !== "execute") throw new Error("plan_complete is only available in execute mode");
      enterOff(ctx, "Plan complete");
      return {
        content: [{ type: "text", text: "Plan completed. Execute mode is now off." }],
        details: { completed: true },
        terminate: true,
      };
    },
  });

  pi.on("session_start", (event, ctx) => {
    restore(ctx);
    savedTools = configuredTools();

    if (event.reason === "startup" && pi.getFlag("plan") === true) {
      enterPlan(ctx, false);
      return;
    }
    if (state.mode === "plan") {
      pi.setActiveTools(savedTools.filter((name) => READ_ONLY_TOOLS.has(name)));
    } else if (state.mode === "execute") {
      pi.setActiveTools([...new Set([...savedTools, "plan_complete"])]);
    } else {
      pi.setActiveTools(savedTools);
      savedTools = undefined;
    }
    updateUi(ctx);
  });

  pi.on("before_agent_start", (event) => {
    if (state.mode === "plan") {
      const previous = state.plan
        ? `\n\nA previous draft exists. Revise it only when the user's latest request asks for refinement:\n\n<previous_plan>\n${state.plan}\n</previous_plan>`
        : "";
      return { systemPrompt: `${event.systemPrompt}\n\n${PLAN_PROMPT}${previous}` };
    }
    if (state.mode === "execute") {
      return { systemPrompt: `${event.systemPrompt}\n\n${executePrompt(state.plan)}` };
    }
  });

  pi.on("tool_call", (event) => {
    if (event.toolName === "plan_complete" && state.mode !== "execute") {
      return { block: true, reason: "plan_complete is only allowed in execute mode" };
    }
    if (state.mode !== "plan" || event.toolName !== "bash") return;
    const command = String((event.input as { command?: unknown }).command ?? "");
    if (!isSafeBash(command)) {
      return { block: true, reason: `Plan mode blocked a non-read-only command: ${command}` };
    }
  });

  pi.on("agent_end", (event, ctx) => {
    if (state.mode !== "plan") return;
    const text = extractAssistantText(event.messages);
    if (!text) return;
    state.plan = text;
    persist();
    updateUi(ctx);
    if (ctx.hasUI) ctx.ui.notify("Plan captured. Run /plan execute or ask for refinement.", "info");
  });

  pi.on("session_tree", (_event, ctx) => {
    restore(ctx);
    if (state.mode === "plan") {
      if (!savedTools) savedTools = configuredTools();
      pi.setActiveTools(savedTools.filter((name) => READ_ONLY_TOOLS.has(name)));
    } else if (state.mode === "execute") {
      if (!savedTools) savedTools = configuredTools();
      pi.setActiveTools([...new Set([...savedTools, "plan_complete"])]);
    } else {
      const baseline = savedTools ?? configuredTools();
      pi.setActiveTools(baseline.filter((name) => name !== "plan_complete"));
      savedTools = undefined;
    }
    updateUi(ctx);
  });

  pi.registerCommand("plan", {
    description: "Plan workflow: /plan [on|execute|off|status]",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (!action) {
        if (state.mode === "off") enterPlan(ctx);
        else enterOff(ctx);
        return;
      }
      if (action === "on") {
        enterPlan(ctx);
        return;
      }
      if (action === "execute") {
        enterExecute(ctx);
        return;
      }
      if (action === "off") {
        enterOff(ctx);
        return;
      }
      if (action === "status") {
        ctx.ui.notify(
          `Plan mode: ${state.mode}${state.plan ? ` · ${state.plan.length} captured characters` : " · no captured plan"}`,
          "info",
        );
        return;
      }
      ctx.ui.notify("Usage: /plan [on|execute|off|status]", "warning");
    },
  });

  pi.registerShortcut(SHORTCUT, {
    description: "Toggle plan mode",
    handler: async (ctx) => {
      if (state.mode === "off") enterPlan(ctx);
      else enterOff(ctx);
    },
  });

  pi.registerFlag("plan", {
    type: "boolean",
    description: "Start in read-only plan mode",
  });
}
