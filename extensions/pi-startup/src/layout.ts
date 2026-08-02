import { VERSION, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { StartupCounts } from "./discovery.ts";
import { center, fit, hasNerdFonts } from "./helpers.ts";

const PI_ART = [
  "██████╗ ██╗",
  "██╔══██╗██║",
  "██████╔╝██║",
  "██╔═══╝ ██║",
  "██║     ██║",
  "╚═╝     ╚═╝",
];

export interface StartupKeys {
  model: string;
  thinking: string;
  tools: string;
}

function logoColumn(theme: Theme, width: number): string[] {
  return ["", ...PI_ART.map((line) => center(theme.bold(theme.fg("accent", line)), width)), ""];
}

function countColumn(theme: Theme, counts: StartupCounts): string[] {
  const item = (count: number, singular: string, plural = `${singular}s`) =>
    ` ${theme.fg("dim", "• ")}${theme.fg(count > 0 ? "success" : "dim", String(count))} ${count === 1 ? singular : plural}`;
  return [
    "",
    item(counts.models, "model"),
    item(counts.extensions, "extension"),
    item(counts.skills, "skill"),
    item(counts.mcpServers, "MCP server"),
    item(counts.prompts, "prompt"),
    item(counts.contextFiles, "context file"),
    "",
  ];
}

function tipsColumn(theme: Theme, keys: StartupKeys): string[] {
  const dim = (value: string) => theme.fg("dim", value);
  return [
    "",
    ` ${dim("/")} commands`,
    ` ${dim("!")} bash mode`,
    ` ${dim(keys.model)} cycle model`,
    ` ${dim(keys.thinking)} cycle thinking`,
    ` ${dim(keys.tools)} expand tools`,
    "",
  ];
}

export function renderStartup(
  theme: Theme,
  counts: StartupCounts,
  keys: StartupKeys,
  terminalWidth: number,
): string[] {
  if (terminalWidth < 44) return [];

  const boxWidth = Math.min(88, Math.max(42, terminalWidth - 2));
  const innerWidth = boxWidth - 2;
  const leftWidth = Math.min(20, Math.max(14, Math.floor(innerWidth * 0.27)));
  const countWidth = Math.min(26, Math.max(18, Math.floor(innerWidth * 0.34)));
  const tipsWidth = innerWidth - leftWidth - countWidth;
  const border = (value: string) => theme.fg("borderMuted", value);

  const logo = logoColumn(theme, leftWidth);
  const countsColumn = countColumn(theme, counts);
  const tips = tipsColumn(theme, keys);
  const rows = Math.max(logo.length, countsColumn.length, tips.length);

  const nerdIcon = hasNerdFonts() ? "\uE22C " : "";
  const title = `${nerdIcon}pi.dev agent v${VERSION} `;
  const titleWidth = visibleWidth(title);
  const topFill = Math.max(1, innerWidth - titleWidth - 1);

  const lines = [
    "",
    border("╭─") + theme.fg("accent", nerdIcon) + theme.fg("dim", `pi.dev agent v${VERSION} `) + border("─".repeat(topFill) + "╮"),
  ];
  for (let index = 0; index < rows; index++) {
    lines.push(
      border("│") +
      fit(logo[index] ?? "", leftWidth) +
      fit(countsColumn[index] ?? "", countWidth) +
      fit(tips[index] ?? "", tipsWidth) +
      border("│"),
    );
  }
  lines.push(border("╰" + "─".repeat(innerWidth) + "╯"), "");
  return lines;
}
