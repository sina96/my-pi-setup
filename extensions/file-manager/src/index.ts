import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverFileActionCapabilities, performAction } from "./actions.ts";
import { openFileBrowserPopup, type BrowserState } from "./popup.ts";
import { discoverBinaries, discoverFiles } from "./search.ts";

export default function fileManager(pi: ExtensionAPI): void {
  const binaries = discoverBinaries();

  pi.registerCommand("files", {
    description: "Browse files and content with fd, rg, and fzf",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/files requires Pi's interactive TUI", "warning");
        return;
      }
      if (!binaries.fd) {
        ctx.ui.notify("/files requires fd", "error");
        return;
      }

      let files: string[];
      try {
        files = await discoverFiles(pi, binaries.fd, ctx.cwd, ctx.signal);
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
        return;
      }
      if (files.length === 0) {
        ctx.ui.notify("No files found", "info");
        return;
      }

      const capabilities = discoverFileActionCapabilities();
      let state: BrowserState = { mode: "files", query: "" };
      for (;;) {
        const outcome = await openFileBrowserPopup(
          ctx,
          files,
          binaries,
          capabilities,
          state,
        );
        if (!outcome || outcome.action === "close") return;
        state = { mode: outcome.mode, query: outcome.query };
        if (!outcome.match) continue;
        try {
          await performAction(pi, ctx, outcome.action, outcome.match);
          if (outcome.action !== "copy") return;
        } catch (error) {
          ctx.ui.notify(
            error instanceof Error ? error.message : String(error),
            "error",
          );
        }
      }
    },
  });
}
