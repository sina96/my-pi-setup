import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { registerChildReporter } from "./child.ts";
import { checkHerdr } from "./herdr.ts";
import { getManager, resolveTrust } from "./manager.ts";
import {
  THINKING_LEVELS,
  type SubagentDetails,
  type SubagentRun,
} from "./types.ts";

const EXTENSION_PATH = fileURLToPath(import.meta.url);
const CHILD_REPORTER_KEY = Symbol.for(
  "simply-herdr-subagents/child-reporter-v1",
);
const TOOL_NAMES = [
  "subagent_spawn",
  "subagent_check",
  "subagent_cancel",
  "subagent_wait",
  "subagent_list",
] as const;
const TOOL_NAME_SET = new Set<string>(TOOL_NAMES);

function duration(startedAt: number, finishedAt = Date.now()): string {
  const seconds = Math.max(0, Math.floor((finishedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function icon(status: SubagentRun["status"]): string {
  if (status === "completed") return "✓";
  if (status === "failed") return "✗";
  if (status === "interrupted") return "!";
  if (status === "starting") return "◦";
  return "●";
}

function describe(run: SubagentRun): string {
  const elapsed = duration(run.startedAt, run.finishedAt);
  return `${run.id} [${run.status}] "${run.name}" (${run.provider}/${run.model}, ${elapsed}, ${run.cwd})`;
}

function details(run: SubagentRun): SubagentDetails {
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    cwd: run.cwd,
    paneId: run.paneId,
    provider: run.provider,
    model: run.model,
    thinking: run.thinking,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    output: run.output,
    error: run.error,
    sessionFile: run.sessionFile,
  };
}

function completionText(run: SubagentRun): string {
  const lines = [
    `Subagent ${run.id} "${run.name}" ${run.status === "completed" ? "finished" : "failed"} after ${duration(run.startedAt, run.finishedAt)}.`,
    `Model: ${run.provider}/${run.model} (${run.thinking})`,
  ];
  if (run.sessionFile) lines.push(`Child session: ${run.sessionFile}`);
  if (run.error) lines.push(`Error: ${run.error}`);
  if (run.output) lines.push("", run.output);
  return lines.join("\n");
}

function resolveModel(
  ctx: ExtensionContext,
  providerOverride: string | undefined,
  modelOverride: string | undefined,
): { provider: string; model: string } {
  const explicitProvider = providerOverride?.trim();
  const explicitModel = modelOverride?.trim();
  let provider = explicitProvider || ctx.model?.provider || "";
  let model = explicitModel || ctx.model?.id || "";
  const slash = explicitModel?.indexOf("/") ?? -1;
  if (explicitModel && slash > 0 && !explicitProvider) {
    provider = explicitModel.slice(0, slash);
    model = explicitModel.slice(slash + 1);
  } else if (
    explicitModel &&
    slash > 0 &&
    explicitProvider === explicitModel.slice(0, slash)
  ) {
    model = explicitModel.slice(slash + 1);
  }
  if (!provider || !model)
    throw new Error("No model is active; provide both provider and model");
  return { provider, model };
}

export default function herdrSubagents(pi: ExtensionAPI): void {
  if (process.env.PI_HERDR_SUBAGENT_CHILD === "1") {
    const resultPath = process.env.PI_HERDR_SUBAGENT_RESULT;
    if (!resultPath) {
      console.error(
        "[herdr-subagents] PI_HERDR_SUBAGENT_RESULT is required in child mode",
      );
      return;
    }
    const global = globalThis as Record<PropertyKey, unknown>;
    if (!global[CHILD_REPORTER_KEY]) {
      global[CHILD_REPORTER_KEY] = true;
      registerChildReporter(pi, resultPath);
    }
    return;
  }

  const manager = getManager();
  let enabled = manager.enabled;
  let sessionCtx: ExtensionContext | undefined;
  let unsubscribe: (() => void) | undefined;

  const applyTools = () => {
    const active = pi
      .getActiveTools()
      .filter((name) => !TOOL_NAME_SET.has(name));
    pi.setActiveTools(
      enabled ? [...new Set([...active, ...TOOL_NAMES])] : active,
    );
  };

  const updateUi = () => {
    const ctx = sessionCtx;
    if (!ctx?.hasUI) return;
    const runs = manager.list();
    const active = runs.filter(
      (run) => run.status !== "completed" && run.status !== "failed",
    );
    if (!enabled && active.length === 0) {
      ctx.ui.setStatus("herdr-subagents", undefined);
      ctx.ui.setWidget("herdr-subagents", undefined);
      return;
    }
    const state = enabled
      ? ctx.ui.theme.fg("success", "subagents:on")
      : ctx.ui.theme.fg("warning", "subagents:off");
    ctx.ui.setStatus(
      "herdr-subagents",
      `${state}${active.length ? ` · ${active.length} running` : ""}`,
    );
    if (active.length === 0) {
      ctx.ui.setWidget("herdr-subagents", undefined);
      return;
    }
    const lines = active.map((run) => {
      const color =
        run.status === "interrupted"
          ? "warning"
          : run.status === "starting"
            ? "muted"
            : "accent";
      return `${ctx.ui.theme.fg(color, icon(run.status))} ${run.id} · ${run.name} · ${run.status} · ${duration(run.startedAt)}`;
    });
    ctx.ui.setWidget("herdr-subagents", lines, { placement: "aboveEditor" });
  };

  const deliver = (run: SubagentRun) => {
    pi.sendMessage(
      {
        customType: "herdr-subagent-result",
        content: completionText(run),
        display: true,
        details: details(run),
      },
      { deliverAs: "followUp", triggerTurn: true },
    );
  };

  const requireEnabled = () => {
    if (!enabled)
      throw new Error("herdr-subagents is off. Run /subagents on first");
  };

  pi.registerMessageRenderer(
    "herdr-subagent-result",
    (message, { expanded, outputPad }, theme) => {
      const run = message.details as SubagentDetails | undefined;
      const content =
        typeof message.content === "string" ? message.content : "";
      if (!run) return new Text(content, outputPad, 0);
      const lines = content.split("\n");
      const body = expanded ? lines : lines.slice(0, 9);
      let rendered = `${run.status === "completed" ? theme.fg("success", "✓") : theme.fg("error", "✗")} `;
      rendered += theme.fg("accent", theme.bold(`${run.id} · ${run.name}`));
      rendered += theme.fg("muted", ` · ${run.status}`);
      if (body.length > 1) rendered += `\n${body.slice(1).join("\n")}`;
      if (!expanded && lines.length > body.length)
        rendered += `\n${theme.fg("muted", "… (Ctrl+O to expand)")}`;
      return new Text(rendered, outputPad, 0);
    },
  );

  const spawnSchema = Type.Object({
    name: Type.String({
      description: "Short display name for the delegated task",
    }),
    task: Type.String({
      description: "Complete, self-contained task for the child Pi agent",
    }),
    cwd: Type.Optional(
      Type.String({
        description: "Working directory, relative to the parent cwd by default",
      }),
    ),
    provider: Type.Optional(
      Type.String({
        description: "Provider override; defaults to the parent provider",
      }),
    ),
    model: Type.Optional(
      Type.String({
        description:
          "Model or provider/model override; defaults to the parent model",
      }),
    ),
    thinking: Type.Optional(
      StringEnum(THINKING_LEVELS, {
        description: "Thinking level; defaults to the parent",
      }),
    ),
  });

  pi.registerTool({
    name: "subagent_spawn",
    label: "Spawn Herdr Subagent",
    description:
      "Start an asynchronous Pi subagent in a dedicated Herdr tab. Returns immediately. Results are delivered automatically; do not poll, sleep, or invent a result while waiting. At most four runs may be active.",
    promptSnippet:
      "Delegate an independent task to an observable Pi agent in a Herdr tab",
    promptGuidelines: [
      "Use subagent_spawn for independent, self-contained work that can proceed concurrently.",
      "After subagent_spawn returns, do not poll for completion or assume its result; continue independent work or end the turn because herdr-subagents delivers results automatically.",
    ],
    parameters: spawnSchema,
    async execute(_id, params, _signal, _update, ctx) {
      requireEnabled();
      await checkHerdr(pi);
      const name = params.name.trim().slice(0, 120) || "Subagent";
      const cwd = resolve(ctx.cwd, params.cwd?.trim() || ".");
      const selected = resolveModel(ctx, params.provider, params.model);
      const run = await manager.spawn({
        name,
        task: params.task,
        cwd,
        provider: selected.provider,
        model: selected.model,
        thinking: params.thinking ?? pi.getThinkingLevel(),
        trusted: resolveTrust(ctx.cwd, cwd, ctx.isProjectTrusted()),
        extensionPath: EXTENSION_PATH,
        parentSessionId: ctx.sessionManager.getSessionId(),
      });
      return {
        content: [
          {
            type: "text",
            text: `Started ${run.id} "${run.name}" in Herdr. Its result will be delivered automatically; do not poll.`,
          },
        ],
        details: details(run),
      };
    },
    renderCall(args, theme) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("subagent_spawn "))}${theme.fg("dim", args.name || "…")}`,
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const run = result.details as SubagentDetails | undefined;
      const text = result.content.find((part) => part.type === "text");
      if (!run) return new Text(text?.type === "text" ? text.text : "", 0, 0);
      return new Text(
        `${theme.fg("success", "●")} ${theme.fg("accent", run.id)} · ${run.name} · ${run.status}`,
        0,
        0,
      );
    },
  });

  pi.registerTool({
    name: "subagent_check",
    label: "Check Herdr Subagent",
    description:
      "Check one Herdr subagent without waiting or consuming its eventual automatic result.",
    parameters: Type.Object({
      id: Type.String({ description: "Subagent id, for example sa-1" }),
    }),
    async execute(_id, params) {
      requireEnabled();
      const run = manager.get(params.id);
      if (!run) throw new Error(`Unknown subagent id: ${params.id}`);
      const preview = run.output?.slice(0, 2_000);
      return {
        content: [
          {
            type: "text",
            text: `${describe(run)}${run.error ? `\nError: ${run.error}` : ""}${preview ? `\n\n${preview}` : ""}`,
          },
        ],
        details: details(run),
      };
    },
  });

  pi.registerTool({
    name: "subagent_cancel",
    label: "Cancel Herdr Subagent",
    description:
      "Cancel a child by sending Escape to its active turn, or close its Herdr pane immediately.",
    parameters: Type.Object({
      id: Type.String({ description: "Subagent id" }),
      mode: Type.Optional(
        StringEnum(["interrupt", "close"] as const, {
          description:
            "Default interrupt cancels the active turn; close terminates the pane immediately",
        }),
      ),
    }),
    async execute(_id, params) {
      requireEnabled();
      const run =
        params.mode === "close"
          ? await manager.close(params.id)
          : await manager.interrupt(params.id);
      return {
        content: [
          {
            type: "text",
            text: `${params.mode === "close" ? "Closed" : "Interrupted"} ${run.id} "${run.name}".`,
          },
        ],
        details: details(run),
      };
    },
  });

  pi.registerTool({
    name: "subagent_wait",
    label: "Wait for Herdr Subagents",
    description:
      "Wait for specific subagents only when their results are required before proceeding. Waiting consumes their automatic delivery.",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), { minItems: 1, maxItems: 16 }),
    }),
    async execute(_id, params, signal, onUpdate) {
      requireEnabled();
      const runs = await manager.wait(params.ids, signal, (pending) => {
        onUpdate?.({
          content: [
            { type: "text", text: `Waiting for ${pending.join(", ")}…` },
          ],
          details: { pending },
        });
      });
      return {
        content: [
          { type: "text", text: runs.map(completionText).join("\n\n---\n\n") },
        ],
        details: { runs: runs.map(details) },
      };
    },
  });

  pi.registerTool({
    name: "subagent_list",
    label: "List Herdr Subagents",
    description: "List Herdr subagents tracked by the current parent process.",
    parameters: Type.Object({}),
    async execute() {
      requireEnabled();
      const runs = manager.list();
      return {
        content: [
          {
            type: "text",
            text: runs.length
              ? runs.map(describe).join("\n")
              : "No subagents tracked.",
          },
        ],
        details: { runs: runs.map(details) },
      };
    },
  });

  pi.registerCommand("subagents", {
    description: "Herdr subagents: /subagents [on|off|status|list|stop-all]",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase() || (enabled ? "off" : "on");
      if (action === "on") {
        if (process.env.HERDR_ENV !== "1") {
          ctx.ui.notify(
            "Cannot enable herdr-subagents: Pi is not running inside Herdr",
            "error",
          );
          return;
        }
        try {
          await checkHerdr(pi);
        } catch (error) {
          ctx.ui.notify(
            error instanceof Error ? error.message : String(error),
            "error",
          );
          return;
        }
        enabled = true;
        manager.enabled = true;
        applyTools();
        updateUi();
        ctx.ui.notify("herdr-subagents enabled for this session", "info");
        return;
      }
      if (action === "off") {
        enabled = false;
        manager.enabled = false;
        applyTools();
        updateUi();
        ctx.ui.notify(
          manager.runningCount()
            ? `herdr-subagents disabled; ${manager.runningCount()} existing run(s) continue`
            : "herdr-subagents disabled",
          "info",
        );
        return;
      }
      if (action === "status") {
        ctx.ui.notify(
          `herdr-subagents: ${enabled ? "on" : "off"} · ${manager.runningCount()} running · ${manager.list().length} tracked`,
          "info",
        );
        return;
      }
      if (action === "list") {
        const runs = manager.list();
        ctx.ui.notify(
          runs.length ? runs.map(describe).join("\n") : "No subagents tracked",
          "info",
        );
        return;
      }
      if (action === "stop-all") {
        await manager.stopAll("Stopped with /subagents stop-all");
        updateUi();
        ctx.ui.notify("Stopped all active Herdr subagents", "info");
        return;
      }
      ctx.ui.notify(
        "Usage: /subagents [on|off|status|list|stop-all]",
        "warning",
      );
    },
  });

  pi.on("session_start", (event, ctx) => {
    sessionCtx = ctx;
    if (event.reason !== "reload") {
      enabled = false;
      manager.enabled = false;
    } else {
      enabled = manager.enabled;
    }
    manager.adopt(pi, ctx, deliver);
    unsubscribe?.();
    unsubscribe = manager.subscribe(updateUi);
    applyTools();
    updateUi();
  });

  pi.on("agent_settled", () => manager.flushDeliveries());

  pi.on("session_shutdown", async (event, ctx) => {
    unsubscribe?.();
    unsubscribe = undefined;
    ctx.ui.setStatus("herdr-subagents", undefined);
    ctx.ui.setWidget("herdr-subagents", undefined);
    sessionCtx = undefined;
    if (event.reason === "reload") {
      manager.detach();
      return;
    }
    enabled = false;
    manager.enabled = false;
    await manager.stopAll("Parent Pi session closed", true);
    manager.reset();
    manager.detach();
  });
}
