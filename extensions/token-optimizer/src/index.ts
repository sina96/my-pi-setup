import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  codingPrompt,
  DEFAULT_STATE,
  isOptimizerState,
  type OptimizerState,
  outputPrompt,
} from "./modes.ts";
import { openOptimizerPopup } from "./popup.ts";
import { commandPath, rewriteRtkChain, RTK_PROMPT } from "./rtk.ts";

const ENTRY_TYPE = "token-optimizer-state";
const STATUS_KEY = "token-optimizer";

export async function offerRtkInstall(
  pi: Pick<ExtensionAPI, "exec">,
  ctx: Pick<ExtensionCommandContext, "ui">,
): Promise<boolean> {
  const cargo = commandPath("cargo");
  if (!cargo) {
    ctx.ui.notify(
      "RTK requires Cargo. Install Rust from https://rustup.rs, then reopen /tokens.",
      "warning",
    );
    return false;
  }

  const confirmed = await ctx.ui.confirm(
    "Install RTK?",
    "Run `cargo install rtk-ai`? This downloads and compiles third-party software from crates.io.",
  );
  if (!confirmed) return false;

  ctx.ui.notify("Installing RTK with Cargo…", "info");
  try {
    const result = await pi.exec(cargo, ["install", "rtk-ai"], {
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
        : "RTK installed, but it is not on PATH. Add ~/.cargo/bin and restart Pi.",
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
      state.rtk ? RTK_PROMPT : "",
    ].filter(Boolean);
    if (fragments.length === 0) return;
    return {
      systemPrompt: `${event.systemPrompt ?? ""}\n\n${fragments.join("\n\n")}`,
    };
  });

  pi.on("tool_call", (event) => {
    if (!state.rtk || event.toolName !== "bash" || !commandPath("rtk")) return;
    const input = event.input as { command?: unknown };
    if (typeof input.command !== "string") return;
    input.command = rewriteRtkChain(input.command);
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
