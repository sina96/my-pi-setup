import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export type Density = "minimal" | "balanced";

interface StatuslineSettings {
  density: Density;
}

interface UsageTotals {
  input: number;
  output: number;
  cost: number;
}

interface StatuslineSnapshot {
  project: string;
  nodeVersion?: string;
  thinkingLevel: string;
  usage: UsageTotals;
}

const SETTINGS_PATH = join(getAgentDir(), "minimal-statusline.json");
const THINKING_COLORS: Record<string, Parameters<Theme["fg"]>[0]> = {
  off: "thinkingOff",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
  max: "thinkingMax",
};

function isDensity(value: unknown): value is Density {
  return value === "minimal" || value === "balanced";
}

export function loadSettings(path = SETTINGS_PATH): StatuslineSettings {
  try {
    const settings = JSON.parse(readFileSync(path, "utf8")) as Partial<StatuslineSettings>;
    if (isDensity(settings.density)) return { density: settings.density };
  } catch {
    // A missing or invalid settings file uses the balanced default.
  }
  return { density: "balanced" };
}

export function saveSettings(settings: StatuslineSettings, path = SETTINGS_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function hasNodeProject(cwd: string): boolean {
  return ["package.json", ".nvmrc", ".node-version"].some((file) => existsSync(join(cwd, file)));
}

function formatTokens(value: number): string {
  if (value < 1_000) return String(value);
  if (value < 10_000) return `${(value / 1_000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  if (value < 10_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  return `${Math.round(value / 1_000_000)}m`;
}

export function summarizeUsage(ctx: Pick<ExtensionContext, "sessionManager">): UsageTotals {
  const totals: UsageTotals = { input: 0, output: 0, cost: 0 };
  for (const entry of ctx.sessionManager.getEntries()) {
    let usage: AssistantMessage["usage"] | undefined;
    if (entry.type === "message" && entry.message.role === "assistant") {
      usage = entry.message.usage;
    } else if (entry.type === "message" && entry.message.role === "toolResult") {
      usage = entry.message.usage;
    } else if (entry.type === "compaction" || entry.type === "branch_summary") {
      usage = entry.usage;
    }
    if (!usage) continue;
    totals.input += usage.input;
    totals.output += usage.output;
    totals.cost += usage.cost.total;
  }
  return totals;
}

function contextSegment(theme: Theme, ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage();
  const percent = usage?.percent;
  const percentText = percent === null || percent === undefined ? "?%" : `${Math.round(percent)}%`;
  const color = percent !== null && percent !== undefined && percent >= 90
    ? "error"
    : percent !== null && percent !== undefined && percent >= 70
      ? "warning"
      : "success";
  return theme.fg(color, percentText);
}

function thinkingSegment(theme: Theme, level: string): string {
  const color = THINKING_COLORS[level] ?? "thinkingOff";
  return theme.fg("dim", "◆ ") + theme.fg(color, level);
}

function leftSegment(theme: Theme, snapshot: StatuslineSnapshot, branch: string | null, density: Density): string {
  const parts = [theme.bold(theme.fg("text", snapshot.project))];
  if (branch) parts.push(theme.fg("dim", "on ") + theme.fg("accent", ` ${branch}`));
  if (density === "balanced" && snapshot.nodeVersion) {
    parts.push(theme.fg("dim", "via ") + theme.fg("success", ` ${snapshot.nodeVersion}`));
  }
  return parts.join(" ");
}

function rightSegment(
  theme: Theme,
  ctx: ExtensionContext,
  snapshot: StatuslineSnapshot,
  density: Density,
  compact = false,
): string {
  const parts: string[] = [];
  if (ctx.model) {
    const model = theme.bold(theme.fg("accent", ctx.model.name));
    parts.push(density === "balanced" && !compact ? theme.fg("dim", `${ctx.model.provider} → `) + model : model);
  }
  parts.push(thinkingSegment(theme, snapshot.thinkingLevel));
  parts.push(contextSegment(theme, ctx));
  if (density === "balanced" && !compact) {
    parts.push(theme.fg("accent", `↑${formatTokens(snapshot.usage.input)}`) + theme.fg("dim", "/") + theme.fg("success", `↓${formatTokens(snapshot.usage.output)}`));
  }
  parts.push(theme.fg("warning", `$${snapshot.usage.cost.toFixed(3)}`));
  return parts.join("  ");
}

export function renderStatusline(
  theme: Theme,
  ctx: ExtensionContext,
  snapshot: StatuslineSnapshot,
  branch: string | null,
  density: Density,
  width: number,
): string {
  if (width < 1) return "";
  let right = rightSegment(theme, ctx, snapshot, density);
  if (visibleWidth(right) >= width) right = rightSegment(theme, ctx, snapshot, density, true);
  const rightWidth = visibleWidth(right);
  if (rightWidth >= width) return truncateToWidth(right, width, "");

  const left = truncateToWidth(leftSegment(theme, snapshot, branch, density), width - rightWidth - 1, "");
  const gap = " ".repeat(Math.max(1, width - visibleWidth(left) - rightWidth));
  return truncateToWidth(left + gap + right, width, "");
}

export default function minimalStatusline(pi: ExtensionAPI): void {
  let settings = loadSettings();
  let snapshot: StatuslineSnapshot = {
    project: "pi",
    thinkingLevel: "off",
    usage: { input: 0, output: 0, cost: 0 },
  };
  let requestRender: (() => void) | undefined;

  function refresh(ctx: ExtensionContext): void {
    snapshot = {
      ...snapshot,
      thinkingLevel: pi.getThinkingLevel(),
      usage: summarizeUsage(ctx),
    };
    requestRender?.();
  }

  pi.registerCommand("statusline", {
    description: "Choose a minimal or balanced native footer",
    getArgumentCompletions: (prefix) => ["minimal", "balanced"]
      .filter((density) => density.startsWith(prefix.trim().toLowerCase()))
      .map((density) => ({ value: density, label: density })),
    handler: async (args, ctx) => {
      const requested = args.trim().toLowerCase();
      let density: Density | undefined = isDensity(requested) ? requested : undefined;
      if (!requested && ctx.hasUI) {
        const selected = await ctx.ui.select("Statusline density", [
          `balanced — project, Git, Node, provider, model, thinking, usage${settings.density === "balanced" ? " (current)" : ""}`,
          `minimal — project, Git, model, thinking, context, cost${settings.density === "minimal" ? " (current)" : ""}`,
        ]);
        density = selected?.startsWith("minimal") ? "minimal" : selected?.startsWith("balanced") ? "balanced" : undefined;
      }
      if (!density) {
        if (requested) ctx.ui.notify("Usage: /statusline [minimal|balanced]", "warning");
        return;
      }
      settings = { density };
      saveSettings(settings);
      refresh(ctx);
      ctx.ui.notify(`Statusline: ${density}`, "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    settings = loadSettings();
    snapshot = {
      project: basename(ctx.cwd) || ctx.cwd,
      nodeVersion: hasNodeProject(ctx.cwd) ? process.version : undefined,
      thinkingLevel: pi.getThinkingLevel(),
      usage: summarizeUsage(ctx),
    };
    if (ctx.mode !== "tui") return;

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubscribe = footerData.onBranchChange(() => requestRender?.());
      return {
        dispose() {
          unsubscribe();
          requestRender = undefined;
        },
        invalidate() {},
        render(width: number): string[] {
          return [renderStatusline(theme, ctx, snapshot, footerData.getGitBranch(), settings.density, width)];
        },
      };
    });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    requestRender = undefined;
    if (ctx.mode === "tui") ctx.ui.setFooter(undefined);
  });
  pi.on("session_tree", (_event, ctx) => refresh(ctx));
  pi.on("model_select", (_event, ctx) => refresh(ctx));
  pi.on("thinking_level_select", (event) => {
    snapshot = { ...snapshot, thinkingLevel: event.level };
    requestRender?.();
  });
  pi.on("message_end", (_event, ctx) => refresh(ctx));
  pi.on("agent_settled", (_event, ctx) => refresh(ctx));
}
