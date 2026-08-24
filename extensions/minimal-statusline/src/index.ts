import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { spawnSync } from "node:child_process";
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

export interface RuntimeVersion {
  icon: string;
  name: string;
  version: string;
}

interface StatuslineSnapshot {
  project: string;
  runtimes: RuntimeVersion[];
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

function readProjectFile(cwd: string, file: string): string | undefined {
  try {
    return readFileSync(join(cwd, file), "utf8");
  } catch {
    return undefined;
  }
}

function firstMatch(text: string | undefined, pattern: RegExp): string | undefined {
  return text?.match(pattern)?.[1]?.trim();
}

function currentJavaVersion(): string | undefined {
  const result = spawnSync("java", ["-version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) return undefined;
  const output = `${result.stdout}\n${result.stderr}`;
  return firstMatch(output, /version ["']([^"']+)/) ?? firstMatch(output, /\b(?:openjdk|java)\s+(\d+(?:\.\d+)+|\d+)/i);
}

/** Detect project-declared toolchains, with Java falling back to the installed JVM. */
export function detectRuntimeVersions(cwd: string, nodeVersion = process.version, installedJavaVersion?: string): RuntimeVersion[] {
  const has = (files: string[]) => files.some((file) => existsSync(join(cwd, file)));
  const runtimes: RuntimeVersion[] = [];

  // Lockfiles count: npm, pnpm, Yarn, and Bun projects still run on Node.
  if (has(["package.json", ".nvmrc", ".node-version", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock", "bun.lock", "bun.lockb"])) {
    runtimes.push({ icon: "", name: "Node", version: nodeVersion });
  }

  const goVersion = firstMatch(readProjectFile(cwd, "go.mod"), /^go\s+([^\s]+)$/m);
  if (goVersion) runtimes.push({ icon: "", name: "Go", version: goVersion });

  const toolVersions = readProjectFile(cwd, ".tool-versions");
  const gradle = `${readProjectFile(cwd, "build.gradle") ?? ""}\n${readProjectFile(cwd, "build.gradle.kts") ?? ""}`;
  const declaredJavaVersion = readProjectFile(cwd, ".java-version")?.trim()
    ?? firstMatch(toolVersions, /^java\s+([^\s]+)$/m)
    ?? firstMatch(readProjectFile(cwd, "pom.xml"), /<maven\.compiler\.(?:release|target)>([^<]+)</)
    ?? firstMatch(gradle, /JavaVersion\.VERSION_(\d+)/)
    ?? firstMatch(gradle, /JavaLanguageVersion\.of\((\d+)\)/);
  const isKotlin = has(["build.gradle.kts"]) || /\bkotlin(?:\(|\s*\{|\s*=)/.test(gradle);
  const isJava = declaredJavaVersion !== undefined || has(["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"]);
  const javaVersion = declaredJavaVersion ?? (isJava ? installedJavaVersion ?? currentJavaVersion() : undefined);
  if (isJava && javaVersion) runtimes.push({ icon: isKotlin ? "" : "", name: isKotlin ? "Kotlin/JVM" : "Java", version: javaVersion });

  const cargo = readProjectFile(cwd, "Cargo.toml");
  const rustVersion = firstMatch(readProjectFile(cwd, "rust-toolchain"), /^\s*([^#\s]+)\s*$/m)
    ?? firstMatch(readProjectFile(cwd, "rust-toolchain.toml"), /^channel\s*=\s*["']([^"']+)/m)
    ?? firstMatch(cargo, /^rust-version\s*=\s*["']([^"']+)/m);
  if (rustVersion && (cargo || has(["rust-toolchain", "rust-toolchain.toml"]))) runtimes.push({ icon: "", name: "Rust", version: rustVersion });

  const pyproject = readProjectFile(cwd, "pyproject.toml");
  const pythonVersion = readProjectFile(cwd, ".python-version")?.trim().split(/\s+/)[0]
    ?? firstMatch(toolVersions, /^python\s+([^\s]+)$/m)
    ?? firstMatch(pyproject, /^requires-python\s*=\s*["']([^"']+)/m)
    ?? firstMatch(readProjectFile(cwd, "uv.lock"), /^requires-python\s*=\s*["']([^"']+)/m);
  if (pythonVersion && (pyproject || has(["uv.lock", "requirements.txt", "requirements-dev.txt", "Pipfile", "poetry.lock", ".python-version"]))) {
    runtimes.push({ icon: "", name: "Python", version: pythonVersion });
  }

  return runtimes;
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
  if (density === "balanced") {
    for (const runtime of snapshot.runtimes) {
      parts.push(theme.fg("dim", "via ") + theme.fg("success", `${runtime.icon} ${runtime.version}`));
    }
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
    runtimes: [],
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
          `balanced — project, Git, project runtimes, provider, model, thinking, usage${settings.density === "balanced" ? " (current)" : ""}`,
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
      runtimes: detectRuntimeVersions(ctx.cwd),
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
