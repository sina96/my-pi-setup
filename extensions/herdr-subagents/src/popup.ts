import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { SubagentRun } from "./types.ts";

export type PopupAction =
  | { action: "close"; selectedId?: string }
  | { action: "interrupt"; selectedId: string }
  | { action: "close-pane"; selectedId: string }
  | { action: "focus"; selectedId: string };

function fit(text: string, width: number, right = false): string {
  const clipped = truncateToWidth(text, Math.max(0, width), "");
  const padding = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
  return right ? padding + clipped : clipped + padding;
}

function shortPath(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

function duration(startedAt: number, finishedAt = Date.now()): string {
  const seconds = Math.max(0, Math.floor((finishedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

function statusDisplay(run: SubagentRun, theme: Theme): string {
  if (run.status === "completed") return theme.fg("success", "✓");
  if (run.status === "failed") return theme.fg("error", "✗");
  if (run.status === "interrupted") return theme.fg("warning", "!");
  if (run.status === "starting") return theme.fg("muted", "◦");
  return theme.fg("accent", "●");
}

function cleanPreview(text: string): string[] {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2);
}

export function renderSubagentsPopup(
  runs: SubagentRun[],
  selectedIndex: number,
  expanded: boolean,
  width: number,
  theme: Theme,
): string[] {
  const innerWidth = Math.max(72, width - 2);
  const contentWidth = innerWidth - 2;
  const border = (text: string) => theme.fg("borderAccent", text);
  const row = (content = "") =>
    border("│") + fit(` ${content}`, innerWidth) + border("│");
  const safeIndex =
    runs.length === 0
      ? 0
      : Math.max(0, Math.min(selectedIndex, runs.length - 1));
  const active = runs.filter(
    (run) => run.status !== "completed" && run.status !== "failed",
  ).length;
  const completed = runs.filter((run) => run.status === "completed").length;
  const failed = runs.filter((run) => run.status === "failed").length;
  const counts = `${active} active · ${completed} done · ${failed} failed`;
  const title = theme.fg("accent", theme.bold("Herdr Subagents"));
  const titleGap = " ".repeat(
    Math.max(1, contentWidth - visibleWidth(title) - visibleWidth(counts)),
  );

  const markerWidth = 2;
  const idWidth = 7;
  const elapsedWidth = 8;
  const thinkingWidth = 8;
  const modelWidth = Math.max(
    18,
    Math.min(32, Math.floor(contentWidth * 0.28)),
  );
  const nameWidth = Math.max(
    14,
    contentWidth -
      markerWidth -
      idWidth -
      elapsedWidth -
      thinkingWidth -
      modelWidth -
      10,
  );
  const header = `${fit("", markerWidth)} ${fit("id", idWidth)} ${fit("name", nameWidth)} ${fit("model", modelWidth)} ${fit("think", thinkingWidth)} ${fit("elapsed", elapsedWidth, true)}`;

  const visibleRows = 10;
  const offset = Math.max(
    0,
    Math.min(
      Math.max(0, runs.length - visibleRows),
      safeIndex - Math.floor(visibleRows / 2),
    ),
  );
  const visible = runs.slice(offset, offset + visibleRows);
  const lines = [
    border(`╭${"─".repeat(innerWidth)}╮`),
    row(`${title}${titleGap}${theme.fg("muted", counts)}`),
    border(`├${"─".repeat(innerWidth)}┤`),
    row(theme.fg("muted", header)),
    row(theme.fg("borderMuted", "─".repeat(contentWidth))),
  ];

  if (runs.length === 0) {
    lines.push(row(theme.fg("dim", "No subagents tracked in this session.")));
  } else {
    for (let index = 0; index < visible.length; index += 1) {
      const run = visible[index];
      const absoluteIndex = offset + index;
      const selected = absoluteIndex === safeIndex;
      const marker = selected ? theme.fg("accent", "❯") : " ";
      const pane = run.paneClosed ? theme.fg("dim", "closed") : run.status;
      const name = `${run.name} · ${pane}`;
      const model = `${run.provider}/${run.model}`;
      const content = `${fit(`${marker} ${statusDisplay(run, theme)}`, markerWidth)} ${fit(run.id, idWidth)} ${fit(name, nameWidth)} ${fit(model, modelWidth)} ${fit(run.thinking, thinkingWidth)} ${fit(duration(run.startedAt, run.finishedAt), elapsedWidth, true)}`;
      lines.push(row(selected ? theme.bg("selectedBg", content) : content));
    }
    if (runs.length > visibleRows) {
      lines.push(
        row(
          theme.fg(
            "dim",
            `Rows ${offset + 1}-${Math.min(runs.length, offset + visibleRows)} of ${runs.length}`,
          ),
        ),
      );
    }
  }

  const selected = runs[safeIndex];
  if (selected && expanded) {
    lines.push(border(`├${"─".repeat(innerWidth)}┤`));
    lines.push(
      row(
        `${theme.fg("accent", theme.bold(`${selected.id} · ${selected.name}`))}  ${theme.fg("muted", selected.status)}`,
      ),
    );
    lines.push(row(`${theme.fg("muted", "cwd")}  ${shortPath(selected.cwd)}`));
    lines.push(
      row(
        `${theme.fg("muted", "pane")} ${selected.paneClosed ? "closed" : selected.paneId}  ${theme.fg("muted", "model")} ${selected.provider}/${selected.model}  ${theme.fg("muted", "thinking")} ${selected.thinking}`,
      ),
    );
    if (selected.sessionFile)
      lines.push(
        row(
          `${theme.fg("muted", "session")} ${shortPath(selected.sessionFile)}`,
        ),
      );
    const preview = selected.error
      ? [`Error: ${selected.error}`]
      : selected.output
        ? cleanPreview(selected.output)
        : [selected.task.trim().split("\n")[0] ?? ""];
    for (const line of preview) {
      lines.push(row(theme.fg(selected.error ? "error" : "dim", line)));
    }
  }

  lines.push(border(`├${"─".repeat(innerWidth)}┤`));
  lines.push(
    row(
      theme.fg(
        "dim",
        "j/k or ↑/↓ move · Enter details · i interrupt · x close pane · f focus · q/Esc close",
      ),
    ),
  );
  lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
  return lines.map((line) => truncateToWidth(line, width, ""));
}

export function popupInputAction(
  input: string,
  selectedIndex: number,
  runCount: number,
  expanded: boolean,
  keybindings: { matches(input: string, id: string): boolean },
): {
  selectedIndex: number;
  expanded: boolean;
  action?: PopupAction["action"];
} {
  const lower = input.toLowerCase();
  if (
    keybindings.matches(input, "tui.select.cancel") ||
    matchesKey(input, "ctrl+c") ||
    lower === "q"
  ) {
    return { selectedIndex, expanded, action: "close" };
  }
  if (runCount === 0) return { selectedIndex: 0, expanded };
  if (keybindings.matches(input, "tui.select.up") || lower === "k") {
    return { selectedIndex: Math.max(0, selectedIndex - 1), expanded };
  }
  if (keybindings.matches(input, "tui.select.down") || lower === "j") {
    return {
      selectedIndex: Math.min(runCount - 1, selectedIndex + 1),
      expanded,
    };
  }
  if (input === "G") return { selectedIndex: runCount - 1, expanded };
  if (lower === "g") return { selectedIndex: 0, expanded };
  if (
    keybindings.matches(input, "tui.select.confirm") ||
    matchesKey(input, "enter")
  ) {
    return { selectedIndex, expanded: !expanded };
  }
  if (lower === "i") return { selectedIndex, expanded, action: "interrupt" };
  if (lower === "x") return { selectedIndex, expanded, action: "close-pane" };
  if (lower === "f") return { selectedIndex, expanded, action: "focus" };
  return { selectedIndex, expanded };
}
