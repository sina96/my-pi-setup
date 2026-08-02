import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component } from "@earendil-works/pi-tui";
import { aggregate, scanSessions } from "./scan.js";
import type { InsightsData, InsightsView } from "./types.js";
import { formatCost, formatCount, renderInsights } from "./view.js";

const RANGES = [7, 30, 90] as const;
const VIEWS: InsightsView[] = ["summary", "models", "projects", "tools"];
const CACHE_MS = 15_000;

export default function sessionInsights(pi: ExtensionAPI) {
  let cache: InsightsData | undefined;

  async function load(ctx: ExtensionContext, force: boolean): Promise<InsightsData | undefined> {
    if (!force && cache && Date.now() - cache.generatedAt.getTime() < CACHE_MS) return cache;

    if (!ctx.hasUI) {
      cache = await scanSessions(join(getAgentDir(), "sessions"));
      return cache;
    }

    let cancelled = false;
    const result = await ctx.ui.custom<InsightsData | undefined>((tui, theme, _kb, done) => {
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
    });
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

  async function show(args: string, ctx: ExtensionContext): Promise<void> {
    const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const requestedDays = words.map(Number).find((value) => RANGES.includes(value as 7 | 30 | 90));
    let initialRange = requestedDays ? RANGES.indexOf(requestedDays as 7 | 30 | 90) : 1;
    let force = words.includes("refresh") || words.includes("r");

    while (true) {
      const data = await load(ctx, force);
      force = false;
      if (!data) return;

      if (!ctx.hasUI) {
        pi.sendMessage({ customType: "session-insights", content: headlessSummary(data, RANGES[initialRange]), display: true }, { triggerTurn: false });
        return;
      }

      const outcome = await ctx.ui.custom<"close" | "refresh">((tui, theme, _kb, done) => {
        let rangeIndex = initialRange;
        let viewIndex = 0;
        const component: Component = {
          render(width: number) {
            return renderInsights(aggregate(data, RANGES[rangeIndex]), rangeIndex, VIEWS[viewIndex], width, theme);
          },
          invalidate() {},
          handleInput(input: string) {
            if (matchesKey(input, Key.escape) || matchesKey(input, Key.ctrl("c")) || input.toLowerCase() === "q") {
              done("close");
              return;
            }
            if (input.toLowerCase() === "r") {
              initialRange = rangeIndex;
              done("refresh");
              return;
            }
            if (matchesKey(input, Key.tab)) {
              viewIndex = (viewIndex + 1) % VIEWS.length;
            } else if (matchesKey(input, Key.shift("tab"))) {
              viewIndex = (viewIndex + VIEWS.length - 1) % VIEWS.length;
            } else if (matchesKey(input, Key.left) || input.toLowerCase() === "h") {
              rangeIndex = (rangeIndex + RANGES.length - 1) % RANGES.length;
            } else if (matchesKey(input, Key.right) || input.toLowerCase() === "l") {
              rangeIndex = (rangeIndex + 1) % RANGES.length;
            } else if (/^[123]$/.test(input)) {
              rangeIndex = Number(input) - 1;
            } else {
              return;
            }
            tui.requestRender();
          },
        };
        return component;
      });

      if (outcome !== "refresh") return;
      cache = undefined;
      force = true;
    }
  }

  const command = {
    description: "Theme-aware session, token, cost, project, model, and tool insights",
    handler: show,
  };
  pi.registerCommand("session-insights", command);
  pi.registerCommand("session-breakdown", command);
  pi.registerCommand("usage", command);
}
