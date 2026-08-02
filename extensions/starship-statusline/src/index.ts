import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const extensionDir = dirname(dirname(fileURLToPath(import.meta.url)));
const bundledConfigPath = join(extensionDir, "presets", "default.toml");
const settingsPath = join(getAgentDir(), "starship-statusline.json");
const inheritedUserConfig = process.env.STARSHIP_CONFIG;

type ConfigMode = "default" | "user" | "custom";
interface StatuslineSettings {
  mode: ConfigMode;
  customConfig?: string;
  github: boolean;
  showModel: boolean;
  showGit: boolean;
}

interface PullRequestInfo {
  number: number;
  url: string;
}

function loadSettings(): StatuslineSettings {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as Partial<StatuslineSettings>;
    const common = {
      github: parsed.github === true,
      showModel: parsed.showModel !== false,
      showGit: parsed.showGit !== false,
    };
    if (parsed.mode === "user" || parsed.mode === "default") return { mode: parsed.mode, ...common };
    if (parsed.mode === "custom" && typeof parsed.customConfig === "string") {
      return { mode: "custom", customConfig: parsed.customConfig, ...common };
    }
  } catch {
    // Missing or malformed settings use the bundled default.
  }
  return { mode: "default", github: false, showModel: true, showGit: true };
}

function saveSettings(settings: StatuslineSettings): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function expandPath(value: string, cwd: string): string {
  const expanded = value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function selectedConfigPath(settings: StatuslineSettings): string | undefined {
  if (settings.mode === "default") return bundledConfigPath;
  if (settings.mode === "custom") return settings.customConfig;
  return inheritedUserConfig;
}

function userConfigPath(): string {
  if (inheritedUserConfig) return inheritedUserConfig;
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "starship.toml");
}

const gitlessConfigPath = join(getAgentDir(), "starship-statusline-gitless.toml");
const gitModules = ["git_branch", "git_commit", "git_state", "git_metrics", "git_status"];
let gitlessConfigKey = "";
let gitlessConfigPromise: Promise<string> | undefined;

async function configPathForPrompt(settings: StatuslineSettings): Promise<string | undefined> {
  const selected = selectedConfigPath(settings);
  if (settings.showGit) return selected;

  const source = selected ?? userConfigPath();
  const sourceStat = existsSync(source) ? statSync(source) : undefined;
  const key = `${source}:${sourceStat?.mtimeMs ?? 0}:${sourceStat?.size ?? 0}`;
  if (gitlessConfigPromise && gitlessConfigKey === key) return gitlessConfigPromise;

  gitlessConfigKey = key;
  gitlessConfigPromise = (async () => {
    mkdirSync(dirname(gitlessConfigPath), { recursive: true });
    if (sourceStat?.isFile()) copyFileSync(source, gitlessConfigPath);
    else writeFileSync(gitlessConfigPath, "", "utf8");

    const env = { ...process.env, STARSHIP_CONFIG: gitlessConfigPath };
    for (const moduleName of gitModules) {
      await execFileAsync("starship", ["config", `${moduleName}.disabled`, "true"], {
        env,
        timeout: 3000,
      });
    }
    return gitlessConfigPath;
  })();
  return gitlessConfigPromise;
}

/** Render Starship using only local working-tree information. */
async function getStarshipPrompt(cwd: string, width: number, settings: StatuslineSettings): Promise<string> {
  try {
    const env = { ...process.env, PWD: cwd, STARSHIP_SHELL: "bash" };
    const configPath = await configPathForPrompt(settings);
    if (configPath) env.STARSHIP_CONFIG = configPath;
    else delete env.STARSHIP_CONFIG;

    const { stdout } = await execFileAsync(
      "starship",
      [
        "prompt",
        `--terminal-width=${Math.max(20, width)}`,
        "--status=0",
        "--pipestatus=0",
        "--cmd-duration=0",
        "--jobs=0",
        "--keymap=",
      ],
      { cwd, timeout: 3000, env },
    );

    const lines = stdout.split("\n").map((line) =>
      line
        .replace(/\\\[|\\\]|%\{|%\}/g, "")
        .replace(/(\x1b\[[0-9;]*m)+$/g, "")
        .trimEnd(),
    );

    // Supports formats that begin with a newline while dropping the prompt
    // character line from conventional two-line prompts.
    return lines.find((line) => line.replace(/\x1b\[[0-9;]*m/g, "").trim()) ?? "";
  } catch {
    return "";
  }
}

async function getPullRequest(cwd: string): Promise<PullRequestInfo | null> {
  try {
    const { stdout } = await execFileAsync("gh", ["pr", "view", "--json", "number,url"], {
      cwd,
      timeout: 5000,
    });
    const parsed = JSON.parse(stdout.trim()) as Partial<PullRequestInfo>;
    if (
      typeof parsed.number === "number" &&
      typeof parsed.url === "string" &&
      /^https:\/\/github\.com\//.test(parsed.url)
    ) {
      return { number: parsed.number, url: parsed.url };
    }
  } catch {
    // gh is optional; missing auth, executable, or PR all mean no segment.
  }
  return null;
}

function hyperlink(url: string, text: string): string {
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

export default function starshipStatusline(pi: ExtensionAPI) {
  let settings = loadSettings();
  let prompt = "";
  let pullRequest: PullRequestInfo | null = null;
  let renderWidth = 120;
  let thinkingLevel = "off";
  let requestRender: (() => void) | undefined;
  let refreshSequence = 0;
  let activeCwd = "";

  async function refresh(cwd: string, width = renderWidth): Promise<void> {
    const sequence = ++refreshSequence;
    const [nextPrompt, nextPullRequest] = await Promise.all([
      getStarshipPrompt(cwd, width, settings),
      settings.github && settings.showGit ? getPullRequest(cwd) : Promise.resolve(null),
    ]);
    if (sequence !== refreshSequence) return;
    prompt = nextPrompt;
    pullRequest = nextPullRequest;
    requestRender?.();
  }

  async function chooseMode(args: string, ctx: ExtensionCommandContext) {
    const [requestedMode, ...pathParts] = args.trim().split(/\s+/).filter(Boolean);
    let mode = requestedMode as ConfigMode | "";

    if (!mode) {
      const selected = await ctx.ui.select("Starship statusline config", [
        "default — Catppuccin Mocha with Nerd Font symbols",
        "user — normal Starship user config",
        "custom — select another TOML file",
      ]);
      if (!selected) return;
      mode = selected.split(" ")[0] as ConfigMode;
    }

    if (mode !== "default" && mode !== "user" && mode !== "custom") {
      ctx.ui.notify("Usage: /starship-statusline [default|user|custom [path]]", "warning");
      return;
    }

    let next: StatuslineSettings;
    if (mode === "custom") {
      let customPath = pathParts.join(" ");
      if (!customPath) {
        customPath = (await ctx.ui.input("Custom Starship config", "Path to a .toml file"))?.trim() ?? "";
      }
      if (!customPath) return;

      const resolvedPath = expandPath(customPath, ctx.cwd);
      if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
        ctx.ui.notify(`Config file not found: ${resolvedPath}`, "error");
        return;
      }
      next = { ...settings, mode: "custom", customConfig: resolvedPath };
    } else {
      next = { ...settings, mode, customConfig: undefined };
    }

    settings = next;
    saveSettings(settings);
    await refresh(ctx.cwd);
    const detail = settings.mode === "custom" ? `: ${settings.customConfig}` : "";
    ctx.ui.notify(`Starship statusline mode: ${settings.mode}${detail}`, "info");
  }

  async function chooseGitHub(args: string, ctx: ExtensionCommandContext) {
    let choice = args.trim().toLowerCase();
    if (!choice) {
      const selected = await ctx.ui.select("GitHub pull request segment", [
        `on — show PR link using gh${settings.github ? " (current)" : ""}`,
        `off — no GitHub integration${settings.github ? "" : " (current)"}`,
      ]);
      if (!selected) return;
      choice = selected.split(" ")[0];
    }

    if (choice !== "on" && choice !== "off") {
      ctx.ui.notify("Usage: /starship-statusline-github [on|off]", "warning");
      return;
    }

    settings = { ...settings, github: choice === "on" };
    saveSettings(settings);
    await refresh(ctx.cwd);
    ctx.ui.notify(
      settings.github
        ? "GitHub PR segment enabled (requires an authenticated gh CLI)"
        : "GitHub integration disabled",
      "info",
    );
  }

  async function chooseSegments(args: string, ctx: ExtensionCommandContext) {
    const [segment, value] = args.trim().toLowerCase().split(/\s+/);
    if (segment || value) {
      if ((segment !== "model" && segment !== "git") || (value !== "on" && value !== "off")) {
        ctx.ui.notify("Usage: /starship-statusline-segments [model|git] [on|off]", "warning");
        return;
      }
      settings = {
        ...settings,
        ...(segment === "model" ? { showModel: value === "on" } : { showGit: value === "on" }),
      };
      saveSettings(settings);
      await refresh(ctx.cwd);
      ctx.ui.notify(`${segment} segment: ${value}`, "info");
      return;
    }

    while (true) {
      const selected = await ctx.ui.select("Starship statusline segments", [
        `model — ${settings.showModel ? "on" : "off"}`,
        `git — ${settings.showGit ? "on" : "off"}`,
        "done",
      ]);
      if (!selected || selected === "done") return;
      if (selected.startsWith("model")) settings = { ...settings, showModel: !settings.showModel };
      if (selected.startsWith("git")) settings = { ...settings, showGit: !settings.showGit };
      saveSettings(settings);
      await refresh(ctx.cwd);
    }
  }

  pi.registerCommand("starship-statusline", {
    description: "Select default, user, or custom Starship configuration",
    handler: chooseMode,
  });

  pi.registerCommand("starship-statusline-segments", {
    description: "Show or hide model and Git statusline segments",
    handler: chooseSegments,
  });

  pi.registerCommand("starship-statusline-github", {
    description: "Enable or disable optional GitHub PR integration",
    handler: chooseGitHub,
  });

  pi.registerCommand("starship-statusline-refresh", {
    description: "Refresh the Starship statusline",
    handler: async (_args, ctx) => {
      await refresh(ctx.cwd);
      ctx.ui.notify("Starship statusline refreshed", "info");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    activeCwd = ctx.cwd;
    thinkingLevel = pi.getThinkingLevel();
    void refresh(activeCwd);

    ctx.ui.setFooter((tui, theme, footerData) => {
      requestRender = () => tui.requestRender();
      const unsubscribeBranch = footerData.onBranchChange(() => void refresh(activeCwd));

      return {
        dispose() {
          unsubscribeBranch();
          requestRender = undefined;
        },
        invalidate() {},
        render(width: number): string[] {
          if (width !== renderWidth) {
            renderWidth = width;
            void refresh(activeCwd, width);
          }

          let totalCost = 0;
          for (const entry of ctx.sessionManager.getBranch()) {
            if (entry.type !== "message" || entry.message.role !== "assistant") continue;
            const message = entry.message as AssistantMessage;
            totalCost += message.usage.cost.total;
          }
          const contextUsage = ctx.getContextUsage();

          const leftParts = prompt ? [prompt] : [];
          if (settings.showGit && pullRequest) {
            const label = theme.bold(theme.fg("accent", `PR #${pullRequest.number}`));
            leftParts.push(hyperlink(pullRequest.url, label));
          }
          const leftContent = leftParts.join("  ");

          const rightParts: string[] = [];
          if (settings.showModel && ctx.model) {
            rightParts.push(
              theme.fg("dim", `${ctx.model.provider} → `) + theme.bold(theme.fg("accent", ctx.model.name)),
            );
          }
          rightParts.push(theme.fg("dim", "◆ ") + theme.fg("accent", thinkingLevel));

          const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow;
          if (contextWindow) {
            const percent = contextUsage?.percent ?? (contextUsage ? null : 0);
            const percentText = percent === null ? "?%" : `${Math.round(percent)}%`;
            const percentColor =
              percent !== null && percent >= 90 ? "error" : percent !== null && percent >= 70 ? "warning" : "success";
            const usedTokens = contextUsage?.tokens ?? (contextUsage ? null : 0);
            const used = usedTokens === null ? "?" : formatTokens(usedTokens);
            const limit = formatTokens(contextWindow);

            rightParts.push(
              theme.fg(percentColor, percentText) +
                " " +
                theme.fg("accent", `↑${used}`) +
                theme.fg("dim", "/") +
                theme.fg("success", `↓${limit}`) +
                " " +
                theme.fg("warning", `$${totalCost.toFixed(3)}`),
            );
          }

          const right = rightParts.join("  ");
          const rightWidth = visibleWidth(right);
          const leftBudget = Math.max(0, width - rightWidth - 1);
          const left = truncateToWidth(leftContent, leftBudget, "");
          const gap = " ".repeat(Math.max(1, width - visibleWidth(left) - rightWidth));
          return [truncateToWidth(left + gap + right, width, "")];
        },
      };
    });
  });

  pi.on("agent_end", (_event, ctx) => void refresh(ctx.cwd));
  pi.on("thinking_level_select", (event) => {
    thinkingLevel = event.level;
    requestRender?.();
  });
  pi.on("model_select", () => requestRender?.());
}
