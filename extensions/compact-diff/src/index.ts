import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  discoverFileActionCapabilities,
  performFileAction,
} from "./actions.ts";
import { readGitDiff } from "./git.ts";
import { parseDiff } from "./parser.ts";
import { openCompactDiffPopup } from "./popup.ts";

const MAX_ANALYSIS_BYTES = 200 * 1024;

function analysisPrompt(scope: "hunk" | "diff", text: string): string {
  return `Analyze this git diff ${scope} as a pragmatic senior reviewer.

Focus on concrete correctness defects, regressions, error handling, security, compatibility, and important missing tests. Inspect repository context as needed. Do not modify files unless I ask.

\`\`\`diff
${text}
\`\`\``;
}

export default function compactDiff(pi: ExtensionAPI): void {
  pi.registerCommand("diff", {
    description: "Open a compact Git diff popup (/diff [git diff args])",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/diff requires Pi's interactive TUI", "warning");
        return;
      }

      let source: Awaited<ReturnType<typeof readGitDiff>>;
      try {
        source = await readGitDiff(pi, ctx.cwd, args);
      } catch (error) {
        ctx.ui.notify(
          error instanceof Error ? error.message : String(error),
          "error",
        );
        return;
      }
      if (!source.text.trim()) {
        ctx.ui.notify("No changes for the requested git diff", "info");
        return;
      }

      const document = parseDiff(source.text);
      const title = args.trim()
        ? `git diff ${args.trim()}`
        : "unstaged changes";
      const outcome = await openCompactDiffPopup(
        ctx,
        document,
        title,
        source.root,
        discoverFileActionCapabilities(),
        (action, target) => performFileAction(pi, source.root, action, target),
      );
      if (!outcome || outcome.action !== "analyze") return;
      if (Buffer.byteLength(outcome.text, "utf8") > MAX_ANALYSIS_BYTES) {
        ctx.ui.notify(
          "The selected diff is too large for an analysis draft; narrow the diff or analyze a hunk with a",
          "warning",
        );
        return;
      }
      ctx.ui.setEditorText(analysisPrompt(outcome.scope, outcome.text));
      ctx.ui.notify(
        "Analysis prompt added to the editor; review it and press Enter",
        "info",
      );
    },
  });
}
