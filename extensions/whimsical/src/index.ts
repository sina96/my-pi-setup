// Adapted and substantially simplified from mitsuhiko/agent-stuff's whimsical.ts.
// Local changes: curated messages, session toggle, persistence, and no-repeat selection.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ENTRY_TYPE = "simply-whimsical-settings";

const FIRST_TURN = [
  "Reading the room…",
  "Mapping the codebase…",
  "Finding the right thread…",
  "Inspecting before editing…",
  "Checking the sharp edges…",
  "Getting the lay of the land…",
];

const FOLLOW_UP = [
  "Following the data flow…",
  "Connecting the dots…",
  "Checking assumptions…",
  "Tracing the ripple effects…",
  "Keeping the diff honest…",
  "Looking for the smallest fix…",
  "Consulting the stack trace…",
  "Untangling the types…",
  "Negotiating with the compiler…",
  "Asking the tests politely…",
  "Herding edge cases…",
  "Polishing the implementation…",
  "Counting the semicolons…",
  "Recombobulating…",
  "Taming the toolchain…",
  "Making the boring thing work…",
  "Checking one more thing…",
  "Following the evidence…",
];

export default function whimsical(pi: ExtensionAPI) {
  let enabled = true;
  let previous = "";

  function restore(ctx: ExtensionContext): void {
    enabled = true;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
      const data = entry.data as { enabled?: unknown } | undefined;
      if (typeof data?.enabled === "boolean") enabled = data.enabled;
    }
  }

  function choose(turnIndex: number): string {
    const pool = turnIndex === 0 ? FIRST_TURN : FOLLOW_UP;
    const candidates = pool.filter((message) => message !== previous);
    const message = candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0];
    previous = message;
    return message;
  }

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));

  pi.on("turn_start", (event, ctx) => {
    if (enabled && ctx.hasUI) ctx.ui.setWorkingMessage(choose(event.turnIndex));
  });

  pi.on("turn_end", (_event, ctx) => {
    if (ctx.hasUI) ctx.ui.setWorkingMessage();
  });

  pi.registerCommand("whimsy", {
    description: "Toggle focused, playful working messages for this session",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === "on") enabled = true;
      else if (action === "off") enabled = false;
      else if (action && action !== "status") {
        ctx.ui.notify("Usage: /whimsy [on|off|status]", "warning");
        return;
      } else if (!action) enabled = !enabled;

      pi.appendEntry(ENTRY_TYPE, { enabled });
      if (!enabled && ctx.hasUI) ctx.ui.setWorkingMessage();
      ctx.ui.notify(`Whimsical working messages ${enabled ? "on" : "off"}`, "info");
    },
  });
}
