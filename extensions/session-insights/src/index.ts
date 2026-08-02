import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { BorderedLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { buildContextInsight } from "./context.js";
import { aggregate, scanSessions } from "./scan.js";
import type { InsightsData, InsightsView } from "./types.js";
import { formatCost, formatCount, renderInsightsPopup } from "./view.js";

const RANGES = [7, 30, 90] as const;
const VIEWS: InsightsView[] = ["overview", "models", "projects", "tools", "context"];
const CACHE_MS = 15_000;

type PopupOutcome =
  | { action: "close"; rangeIndex: number; viewIndex: number }
  | { action: "refresh"; rangeIndex: number; viewIndex: number };

export default function sessionInsights(pi: ExtensionAPI) {
  let cache: InsightsData | undefined;

  async function load(ctx: ExtensionContext, force: boolean): Promise<InsightsData | undefined> {
    if (!force && cache && Date.now() - cache.generatedAt.getTime() < CACHE_MS) return cache;

    if (!ctx.hasUI || ctx.mode !== "tui") {
      cache = await scanSessions(join(getAgentDir(), "sessions"));
      return cache;
    }

    let cancelled = false;
    const result = await ctx.ui.custom<InsightsData | undefined>(
      (tui, theme, _kb, done) => {
        const loader = new BorderedLoader(tui, theme, "Reading Pi session history…");
        loader.onAbort = () => {
          cancelled = true;
          done(undefined);
        };
        scanSessions(join(getAgentDir(), "sessions"), loader.signal)
          .then((data) => {
            if (!cancelled) done(data);
          })
          .catch(() => {
            if (!cancelled) done(undefined);
          });
        return loader;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: "60%",
          minWidth: 48,
          maxWidth: 72,
          margin: 2,
        },
      },
    );
    if (!result && !cancelled) ctx.ui.notify("Could not read Pi session history", "error");
    cache = result ?? cache;
    return result;
  }

  function headlessSummary(data: InsightsData, days: number): string {
    const stats = aggregate(data, days);
    const topModel = stats.models[0]?.name ?? "none";
    const topProject = stats.projects[0]?.name ?? "none";
    return [
      `Session insights · last ${days} days`,
      `${formatCount(stats.sessions)} sessions · ${formatCount(stats.assistantTurns)} assistant turns · ${formatCount(stats.toolCalls)} tool calls`,
      `${formatCount(stats.usage.tokens)} billed tokens · ${formatCost(stats.usage.cost)} estimated cost`,
      `Top model: ${topModel}`,
      `Top project: ${topProject}`,
    ].join("\n");
  }

  async function show(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const requestedDays = words.map(Number).find((value) => RANGES.includes(value as 7 | 30 | 90));
    let initialRange = requestedDays ? RANGES.indexOf(requestedDays as 7 | 30 | 90) : 1;
    const requestedView = VIEWS.find((view) => words.includes(view));
    let initialView = requestedView ? VIEWS.indexOf(requestedView) : 0;
    let force = words.includes("refresh") || words.includes("r");

    while (true) {
      const data = await load(ctx, force);
      force = false;
      if (!data) return;

      if (!ctx.hasUI || ctx.mode !== "tui") {
        pi.sendMessage(
          {
            customType: "session-insights",
            content: headlessSummary(data, RANGES[initialRange]),
            display: true,
          },
          { triggerTurn: false },
        );
        return;
      }

      const context = buildContextInsight(pi, ctx);
      const outcome = await ctx.ui.custom<PopupOutcome>(
        (tui, theme, kb, done) => {
          let rangeIndex = initialRange;
          let viewIndex = initialView;
          let scrollOffset = 0;
          return {
            render(width: number) {
              return renderInsightsPopup(
                aggregate(data, RANGES[rangeIndex]),
                rangeIndex,
                VIEWS[viewIndex],
                width,
                theme,
                context,
                scrollOffset,
              );
            },
            invalidate() {},
            handleInput(input: string) {
              if (
                kb.matches(input, "tui.select.cancel") ||
                matchesKey(input, "ctrl+c") ||
                input.toLowerCase() === "q"
              ) {
                done({ action: "close", rangeIndex, viewIndex });
                return;
              }
              if (input.toLowerCase() === "r") {
                done({ action: "refresh", rangeIndex, viewIndex });
                return;
              }

              if (kb.matches(input, "tui.input.tab") || matchesKey(input, "tab")) {
                viewIndex = (viewIndex + 1) % VIEWS.length;
                scrollOffset = 0;
              } else if (matchesKey(input, "shift+tab")) {
                viewIndex = (viewIndex + VIEWS.length - 1) % VIEWS.length;
                scrollOffset = 0;
              } else if (kb.matches(input, "tui.select.up")) {
                scrollOffset = Math.max(0, scrollOffset - 1);
              } else if (kb.matches(input, "tui.select.down")) {
                scrollOffset += 1;
              } else if (kb.matches(input, "tui.select.pageUp")) {
                scrollOffset = Math.max(0, scrollOffset - 10);
              } else if (kb.matches(input, "tui.select.pageDown")) {
                scrollOffset += 10;
              } else if (matchesKey(input, "left") || input.toLowerCase() === "h") {
                rangeIndex = (rangeIndex + RANGES.length - 1) % RANGES.length;
                scrollOffset = 0;
              } else if (matchesKey(input, "right") || input.toLowerCase() === "l") {
                rangeIndex = (rangeIndex + 1) % RANGES.length;
                scrollOffset = 0;
              } else if (/^[1-5]$/.test(input)) {
                viewIndex = Number(input) - 1;
                scrollOffset = 0;
              } else {
                return;
              }
              tui.requestRender();
            },
          };
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: "center",
            width: "94%",
            minWidth: 76,
            maxWidth: 120,
            maxHeight: "92%",
            margin: 1,
          },
        },
      );

      if (!outcome || outcome.action !== "refresh") return;
      initialRange = outcome.rangeIndex;
      initialView = outcome.viewIndex;
      cache = undefined;
      force = true;
    }
  }

  const command = {
    description: "Tabbed session, usage, project, tool, and context insights popup",
    handler: show,
  };
  pi.registerCommand("session-insights", command);
  pi.registerCommand("session-breakdown", command);
  pi.registerCommand("usage", command);
}
