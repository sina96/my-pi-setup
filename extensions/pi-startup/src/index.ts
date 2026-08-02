import {
  keyText,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { discoverCounts, type StartupCounts } from "./discovery.ts";
import { renderStartup, type StartupKeys } from "./layout.ts";

const emptyCounts: StartupCounts = {
  models: 0,
  contextFiles: 0,
  extensions: 0,
  skills: 0,
  prompts: 0,
  mcpServers: 0,
};

export default function piStartup(pi: ExtensionAPI) {
  let counts = emptyCounts;
  let activeContext: ExtensionContext | undefined;
  let requestRender: (() => void) | undefined;

  const refresh = async (refreshModels = false) => {
    const ctx = activeContext;
    if (!ctx) return;
    if (refreshModels) {
      try {
        await ctx.modelRegistry.refresh();
      } catch {
        // Keep the last available snapshot if a provider refresh fails.
      }
    }
    if (ctx !== activeContext) return;
    counts = discoverCounts(pi, ctx);
    requestRender?.();
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    activeContext = ctx;
    counts = discoverCounts(pi, ctx);

    const keys: StartupKeys = {
      model: keyText("app.model.cycleForward") || "ctrl+p",
      thinking: keyText("app.thinking.cycle") || "shift+tab",
      tools: keyText("app.tools.expand") || "ctrl+o",
    };

    ctx.ui.setHeader((tui, theme) => {
      requestRender = () => tui.requestRender();
      return {
        render(width: number): string[] {
          return renderStartup(theme, counts, keys, width);
        },
        invalidate() {},
        dispose() {
          requestRender = undefined;
        },
      };
    });

    queueMicrotask(() => void refresh(true));
  });

  pi.on("resources_discover", () => {
    queueMicrotask(() => void refresh());
  });

  pi.on("session_shutdown", () => {
    activeContext = undefined;
    requestRender = undefined;
  });

  pi.registerCommand("pi-startup-refresh", {
    description: "Refresh the Pi startup resource counts",
    handler: async (_args, ctx) => {
      activeContext = ctx;
      await refresh(true);
      ctx.ui.notify("Pi startup counts refreshed", "info");
    },
  });

  pi.registerCommand("builtin-header", {
    description: "Restore Pi's built-in startup header for this session",
    handler: async (_args, ctx) => {
      ctx.ui.setHeader(undefined);
      ctx.ui.notify("Built-in header restored", "info");
    },
  });
}
