import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  codingPrompt,
  DEFAULT_STATE,
  isOptimizerState,
  type OptimizerState,
  outputPrompt,
} from "./modes.ts";
import { openOptimizerPopup } from "./popup.ts";
import { commandPath, rewriteRtkCommand } from "./rtk.ts";

const ENTRY_TYPE = "token-optimizer-state";
const STATUS_KEY = "token-optimizer";

export async function offerRtkInstall(
  pi: Pick<ExtensionAPI, "exec">,
  ctx: Pick<ExtensionCommandContext, "ui">,
): Promise<boolean> {
  const brew = commandPath("brew");
  const cargo = commandPath("cargo");
  const installers = [
    brew
      ? {
          label: "Homebrew (recommended) — brew install rtk-ai/tap/rtk",
          name: "Homebrew",
          command: brew,
          args: ["install", "rtk-ai/tap/rtk"],
          detail: "This downloads and installs RTK's official Homebrew formula.",
        }
      : undefined,
    cargo
      ? {
          label: "Cargo — install from the official rtk-ai/rtk repository",
          name: "Cargo",
          command: cargo,
          args: [
            "install",
            "--git",
            "https://github.com/rtk-ai/rtk",
            "--branch",
            "master",
            "rtk",
          ],
          detail: "This downloads and compiles RTK from its official Git repository.",
        }
      : undefined,
  ].filter((installer): installer is NonNullable<typeof installer> => Boolean(installer));

  if (installers.length === 0) {
    ctx.ui.notify(
      "RTK requires Homebrew or Cargo. Install one, then reopen /tokens.",
      "warning",
    );
    return false;
  }

  const selectedLabel = await ctx.ui.select(
    "Install RTK with:",
    installers.map((installer) => installer.label),
  );
  const installer = installers.find((candidate) => candidate.label === selectedLabel);
  if (!installer) return false;

  const displayCommand = `${installer.name === "Homebrew" ? "brew" : "cargo"} ${installer.args.join(" ")}`;
  const confirmed = await ctx.ui.confirm(
    "Install RTK?",
    `Run \`${displayCommand}\`? ${installer.detail}`,
  );
  if (!confirmed) return false;

  ctx.ui.notify(`Installing RTK with ${installer.name}…`, "info");
  try {
    const result = await pi.exec(installer.command, installer.args, {
      timeout: 600_000,
    });
    if (result.code !== 0) {
      const detail = String(result.stderr || result.stdout || "unknown error")
        .trim()
        .slice(-500);
      ctx.ui.notify(`RTK installation failed: ${detail}`, "error");
      return false;
    }
    const available = Boolean(commandPath("rtk"));
    ctx.ui.notify(
      available
        ? "RTK installed. Its control is now available."
        : "RTK installed, but it is not on PATH. Add its install directory to PATH and restart Pi.",
      available ? "info" : "warning",
    );
    return available;
  } catch (error) {
    ctx.ui.notify(
      `RTK installation failed: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    );
    return false;
  }
}

function activeLabels(state: OptimizerState): string[] {
  return [
    state.output !== "off" ? state.output : undefined,
    state.coding !== "off" ? state.coding : undefined,
    state.rtk ? "rtk" : undefined,
  ].filter((value): value is string => Boolean(value));
}

export default function tokenOptimizer(pi: ExtensionAPI): void {
  let state: OptimizerState = { ...DEFAULT_STATE };

  const updateStatus = (ctx: Pick<ExtensionContext, "ui">) => {
    const labels = activeLabels(state);
    ctx.ui.setStatus(
      STATUS_KEY,
      labels.length
        ? ctx.ui.theme.fg("accent", `tokens: ${labels.join(" · ")}`)
        : undefined,
    );
  };

  pi.on("session_start", (_event, ctx) => {
    state = { ...DEFAULT_STATE };
    for (const entry of ctx.sessionManager.getEntries()) {
      if (
        entry.type === "custom" &&
        entry.customType === ENTRY_TYPE &&
        isOptimizerState(entry.data)
      ) {
        state = { ...entry.data };
      }
    }
    if (!commandPath("rtk")) state.rtk = false;
    updateStatus(ctx);
  });

  pi.on("before_agent_start", (event) => {
    const fragments = [
      outputPrompt(state.output),
      codingPrompt(state.coding),
    ].filter(Boolean);
    if (fragments.length === 0) return;
    return {
      systemPrompt: `${event.systemPrompt ?? ""}\n\n${fragments.join("\n\n")}`,
    };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!state.rtk || !isToolCallEventType("bash", event)) return;
    const rtk = commandPath("rtk");
    const command = event.input.command;
    if (
      !rtk ||
      typeof command !== "string" ||
      command.trim() === "" ||
      command.startsWith("rtk ") ||
      process.env.RTK_DISABLED === "1"
    ) return;

    const rewritten = await rewriteRtkCommand(pi, rtk, command, ctx.signal);
    if (rewritten && rewritten !== command) event.input.command = rewritten;
  });

  pi.registerCommand("tokens", {
    description: "Configure session-scoped output and tool token optimization",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/tokens requires interactive mode", "warning");
        return;
      }
      let rtkAvailable = Boolean(commandPath("rtk"));
      if (!rtkAvailable && state.rtk) state.rtk = false;
      while (true) {
        const outcome = await openOptimizerPopup(
          ctx,
          state,
          rtkAvailable,
          (next) => {
            state = { ...next };
            pi.appendEntry(ENTRY_TYPE, state);
            updateStatus(ctx);
          },
        );
        if (outcome !== "install-rtk") return;
        rtkAvailable = await offerRtkInstall(pi, ctx);
        if (!rtkAvailable) return;
      }
    },
  });
}
