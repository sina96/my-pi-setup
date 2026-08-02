import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type {
  Aggregate,
  ContextInsight,
  InsightsView,
  MetricRow,
} from "./types.js";

const BLOCKS = "▁▂▃▄▅▆▇█";
const VIEWS: Array<[InsightsView, string]> = [
  ["overview", "Overview"],
  ["models", "Models"],
  ["projects", "Projects"],
  ["tools", "Tools"],
  ["context", "Context"],
];

export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`;
  return Math.round(value).toLocaleString("en-US");
}

export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function shortPath(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function fit(text: string, width: number, right = false): string {
  const clipped = truncateToWidth(text, Math.max(0, width), "");
  const spaces = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
  return right ? spaces + clipped : clipped + spaces;
}

function sparkline(values: number[], width: number, theme: Theme): string {
  if (width <= 0) return "";
  const bucketSize = Math.max(1, Math.ceil(values.length / width));
  const buckets: number[] = [];
  for (let index = 0; index < values.length; index += bucketSize) {
    buckets.push(values.slice(index, index + bucketSize).reduce((sum, value) => sum + value, 0));
  }
  const max = Math.max(0, ...buckets);
  return buckets.map((value) => {
    if (value <= 0 || max <= 0) return theme.fg("dim", "·");
    const level = Math.min(
      BLOCKS.length - 1,
      Math.ceil((Math.log1p(value) / Math.log1p(max)) * BLOCKS.length) - 1,
    );
    return theme.fg("accent", BLOCKS[Math.max(0, level)]);
  }).join("");
}

function tabBar(active: InsightsView, theme: Theme): string {
  return VIEWS.map(([view, label], index) => view === active
    ? theme.bg("selectedBg", theme.fg("accent", theme.bold(` ${index + 1}:${label} `)))
    : theme.fg("dim", ` ${index + 1}:${label} `)).join(" ");
}

function metricRows(aggregate: Aggregate, width: number, theme: Theme): string[] {
  const activeDays = aggregate.dailyTurns.filter((value) => value > 0).length;
  const metrics: Array<[string, string, Parameters<Theme["fg"]>[0]]> = [
    ["Sessions", formatCount(aggregate.sessions), "success"],
    ["Turns", formatCount(aggregate.assistantTurns), "accent"],
    ["Tool calls", formatCount(aggregate.toolCalls), "warning"],
    ["Tokens", formatCount(aggregate.usage.tokens), "error"],
    ["Cost", formatCost(aggregate.usage.cost), "success"],
    ["Active days", formatCount(activeDays), "accent"],
  ];
  const gap = 2;
  const cellWidth = Math.max(8, Math.floor((width - gap * (metrics.length - 1)) / metrics.length));
  return [
    metrics.map(([label]) => theme.fg("muted", fit(label, cellWidth))).join(" ".repeat(gap)),
    metrics.map(([, value, color]) => theme.fg(color, theme.bold(fit(value, cellWidth)))).join(" ".repeat(gap)),
  ];
}

function overview(aggregate: Aggregate, width: number, theme: Theme): string[] {
  const activity = aggregate.dailyTokens.some(Boolean) ? aggregate.dailyTokens : aggregate.dailyTurns;
  const topModel = aggregate.models[0];
  const topProject = aggregate.projects[0];
  const topTool = aggregate.tools[0];
  return [
    ...metricRows(aggregate, width, theme),
    "",
    `${theme.fg("muted", `Activity · ${aggregate.days} days`)}  ${sparkline(activity, Math.max(12, width - 24), theme)}`,
    theme.fg("dim", `input ${formatCount(aggregate.usage.input)} · output ${formatCount(aggregate.usage.output)} · cache read ${formatCount(aggregate.usage.cacheRead)} · cache write ${formatCount(aggregate.usage.cacheWrite)} · reasoning ${formatCount(aggregate.usage.reasoning)}`),
    "",
    theme.fg("borderAccent", "─".repeat(Math.max(0, width))),
    `${theme.fg("accent", theme.bold("Top model"))}  ${topModel ? topModel.name : theme.fg("dim", "No data")}`,
    topModel ? theme.fg("dim", `${formatCount(topModel.tokens)} tokens · ${formatCost(topModel.cost)}`) : "",
    "",
    `${theme.fg("accent", theme.bold("Top project"))}  ${topProject ? shortPath(topProject.name) : theme.fg("dim", "No data")}`,
    topProject ? theme.fg("dim", `${formatCount(topProject.tokens)} tokens · ${formatCount(topProject.sessions)} sessions`) : "",
    "",
    `${theme.fg("accent", theme.bold("Top tool"))}  ${topTool ? topTool.name : theme.fg("dim", "No data")}  ${topTool ? theme.fg("dim", `${formatCount(topTool.calls)} calls`) : ""}`,
  ];
}

function table(
  rows: MetricRow[],
  view: "models" | "projects" | "tools",
  width: number,
  theme: Theme,
  scrollOffset: number,
): string[] {
  const value = view === "tools" ? (row: MetricRow) => row.calls : (row: MetricRow) => row.tokens;
  const total = view === "tools"
    ? rows.reduce((sum, row) => sum + row.calls, 0)
    : rows.reduce((sum, row) => sum + row.tokens, 0);
  const valueLabel = view === "tools" ? "calls" : "tokens";
  const visibleRows = 12;
  const maxOffset = Math.max(0, rows.length - visibleRows);
  const offset = Math.min(scrollOffset, maxOffset);
  const countWidth = 11;
  const shareWidth = 7;
  const nameWidth = Math.max(12, width - countWidth - shareWidth - 4);
  const lines = [
    `${theme.fg("muted", fit(view === "projects" ? "project" : view.slice(0, -1), nameWidth))}  ${theme.fg("muted", fit(valueLabel, countWidth, true))}  ${theme.fg("muted", fit("share", shareWidth, true))}`,
    theme.fg("borderMuted", "─".repeat(Math.max(0, width))),
  ];
  for (const row of rows.slice(offset, offset + visibleRows)) {
    const amount = value(row);
    const share = total > 0 ? `${Math.round((amount / total) * 100)}%` : "0%";
    const name = view === "projects" ? shortPath(row.name) : row.name;
    lines.push(
      `${fit(name, nameWidth)}  ${theme.fg("accent", fit(formatCount(amount), countWidth, true))}  ${theme.fg("dim", fit(share, shareWidth, true))}`,
    );
  }
  if (rows.length === 0) lines.push(theme.fg("dim", "No data in this range."));
  if (rows.length > visibleRows) {
    lines.push(theme.fg("dim", `Rows ${offset + 1}-${Math.min(rows.length, offset + visibleRows)} of ${rows.length}`));
  }
  return lines;
}

function contextView(context: ContextInsight, width: number, theme: Theme): string[] {
  const barWidth = Math.max(12, Math.min(36, Math.floor(width * 0.42)));
  const used = context.limit > 0
    ? Math.max(0, Math.min(barWidth, Math.round((context.total / context.limit) * barWidth)))
    : 0;
  const ratio = context.limit > 0 ? context.total / context.limit : 0;
  const barColor = ratio > 0.8 ? "error" : ratio > 0.5 ? "warning" : "success";
  const bar = theme.fg(barColor, `${"█".repeat(used)}${"░".repeat(barWidth - used)}`);
  const nameWidth = Math.max(16, width - 31);
  const lines = [
    `${theme.fg("accent", theme.bold("Current context"))}  ${theme.fg("dim", context.model)}`,
    `${bar}  ${formatCount(context.total)} / ${formatCount(context.limit)}  ${theme.fg("dim", `free ${formatCount(context.free)}`)}`,
    theme.fg("dim", context.measured ? "Total uses provider-reported context usage; category rows are estimates." : "Context usage and category rows are estimated."),
    "",
    `${theme.fg("muted", fit("category", nameWidth))}  ${theme.fg("muted", fit("tokens", 11, true))}  ${theme.fg("muted", fit("share", 8, true))}`,
    theme.fg("borderMuted", "─".repeat(Math.max(0, width))),
  ];
  for (const row of context.categories) {
    const share = context.limit > 0 ? `${((row.tokens / context.limit) * 100).toFixed(1)}%` : "0%";
    const label = row.detail ? `${row.name} · ${row.detail}` : row.name;
    lines.push(`${fit(label, nameWidth)}  ${theme.fg("accent", fit(formatCount(row.tokens), 11, true))}  ${theme.fg("dim", fit(share, 8, true))}`);
  }
  if (context.roles.length > 0) {
    lines.push("", theme.fg("muted", "Conversation by role"));
    lines.push(context.roles.map((row) => `${row.name} ${formatCount(row.tokens)}`).join("  ·  "));
  }
  return lines;
}

export function renderInsightsPopup(
  aggregate: Aggregate,
  rangeIndex: number,
  view: InsightsView,
  width: number,
  theme: Theme,
  context: ContextInsight,
  scrollOffset: number,
): string[] {
  const innerWidth = Math.max(40, width - 2);
  const border = (text: string) => theme.fg("borderAccent", text);
  const row = (content = "") => border("│") + fit(` ${content}`, innerWidth) + border("│");
  const body = view === "overview"
    ? overview(aggregate, innerWidth - 2, theme)
    : view === "context"
      ? contextView(context, innerWidth - 2, theme)
      : table(aggregate[view], view, innerWidth - 2, theme, scrollOffset);
  const days = [7, 30, 90][rangeIndex];
  const title = `${theme.fg("accent", theme.bold("Pi Insights"))} ${theme.fg("dim", "· local session analytics")}`;
  const range = theme.fg("muted", view === "context" ? "Current session" : `Last ${days} days`);
  const titleGap = " ".repeat(Math.max(1, innerWidth - visibleWidth(title) - visibleWidth(range) - 2));
  const lines = [
    border(`╭${"─".repeat(innerWidth)}╮`),
    row(`${title}${titleGap}${range}`),
    row(tabBar(view, theme)),
    border(`├${"─".repeat(innerWidth)}┤`),
    ...body.map((line) => row(line)),
    border(`├${"─".repeat(innerWidth)}┤`),
    row(theme.fg("dim", "q/Esc close · Tab/Shift+Tab tabs · ←/→ range · ↑/↓ scroll · 1-5 jump · r refresh")),
    border(`╰${"─".repeat(innerWidth)}╯`),
  ];
  return lines.map((line) => truncateToWidth(line, width, ""));
}
