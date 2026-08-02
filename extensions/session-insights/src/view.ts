import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Aggregate, InsightsView, MetricRow } from "./types.js";

const BLOCKS = "▁▂▃▄▅▆▇█";

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

function pad(text: string, width: number, right = false): string {
  const clipped = truncateToWidth(text, width);
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
    const level = Math.min(BLOCKS.length - 1, Math.ceil((Math.log1p(value) / Math.log1p(max)) * BLOCKS.length) - 1);
    return theme.fg("accent", BLOCKS[Math.max(0, level)]);
  }).join("");
}

function table(
  rows: MetricRow[],
  value: (row: MetricRow) => number,
  valueLabel: string,
  total: number,
  width: number,
  theme: Theme,
  name: (row: MetricRow) => string = (row) => row.name,
): string[] {
  const countWidth = 10;
  const shareWidth = 6;
  const nameWidth = Math.max(10, width - countWidth - shareWidth - 4);
  const output = [
    `${theme.fg("muted", pad("name", nameWidth))}  ${theme.fg("muted", pad(valueLabel, countWidth, true))}  ${theme.fg("muted", pad("share", shareWidth, true))}`,
  ];
  for (const row of rows.slice(0, 12)) {
    const amount = value(row);
    const share = total > 0 ? `${Math.round((amount / total) * 100)}%` : "0%";
    output.push(`${pad(name(row), nameWidth)}  ${pad(formatCount(amount), countWidth, true)}  ${pad(share, shareWidth, true)}`);
  }
  if (rows.length === 0) output.push(theme.fg("dim", "No data in this range."));
  return output;
}

function tabs(active: InsightsView, theme: Theme): string {
  const views: Array<[InsightsView, string]> = [
    ["summary", "summary"],
    ["models", "models"],
    ["projects", "projects"],
    ["tools", "tools"],
  ];
  return views.map(([view, label]) => view === active
    ? theme.fg("accent", theme.bold(`[${label}]`))
    : theme.fg("dim", ` ${label} `)).join(" ");
}

export function renderInsights(
  aggregate: Aggregate,
  rangeIndex: number,
  view: InsightsView,
  width: number,
  theme: Theme,
): string[] {
  const ranges = [7, 30, 90];
  const rangeTabs = ranges.map((days, index) => index === rangeIndex
    ? theme.fg("accent", theme.bold(`[${days}d]`))
    : theme.fg("dim", ` ${days}d `)).join(" ");
  const lines: string[] = [
    `${theme.fg("accent", theme.bold("Session insights"))}  ${rangeTabs}`,
    theme.fg("dim", "←/→ range · tab view · 1/2/3 jump · r refresh · q close"),
    "",
    tabs(view, theme),
    "",
    `${theme.bold(formatCount(aggregate.sessions))} sessions  ·  ${theme.bold(formatCount(aggregate.assistantTurns))} assistant turns  ·  ${theme.bold(formatCount(aggregate.toolCalls))} tool calls`,
    `${theme.bold(formatCount(aggregate.usage.tokens))} billed tokens  ·  ${theme.bold(formatCost(aggregate.usage.cost))} estimated cost`,
    theme.fg("dim", `input ${formatCount(aggregate.usage.input)} · output ${formatCount(aggregate.usage.output)} · cache read ${formatCount(aggregate.usage.cacheRead)} · reasoning ${formatCount(aggregate.usage.reasoning)}`),
    "",
    `${theme.fg("muted", `Activity · last ${aggregate.days} days`)}  ${sparkline(aggregate.dailyTokens.some(Boolean) ? aggregate.dailyTokens : aggregate.dailyTurns, Math.max(8, width - 30), theme)}`,
    "",
  ];

  if (view === "models") {
    lines.push(...table(aggregate.models, (row) => row.tokens, "tokens", aggregate.usage.tokens, width, theme));
  } else if (view === "projects") {
    lines.push(...table(aggregate.projects, (row) => row.tokens, "tokens", aggregate.usage.tokens, width, theme, (row) => shortPath(row.name)));
  } else if (view === "tools") {
    lines.push(...table(aggregate.tools, (row) => row.calls, "calls", aggregate.toolCalls, width, theme));
  } else {
    lines.push(theme.fg("muted", "Top models"));
    for (const row of aggregate.models.slice(0, 4)) {
      lines.push(`  ${pad(row.name, Math.max(12, width - 24))} ${pad(formatCount(row.tokens), 10, true)}  ${pad(formatCost(row.cost), 10, true)}`);
    }
    if (aggregate.models.length === 0) lines.push(theme.fg("dim", "  No model usage found."));
    lines.push("", theme.fg("muted", "Top projects"));
    for (const row of aggregate.projects.slice(0, 4)) {
      lines.push(`  ${pad(shortPath(row.name), Math.max(12, width - 14))} ${pad(formatCount(row.tokens), 10, true)}`);
    }
    if (aggregate.projects.length === 0) lines.push(theme.fg("dim", "  No project data found."));
  }

  return lines.map((line) => truncateToWidth(line, Math.max(1, width)));
}
