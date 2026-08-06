import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
  CODING_MODES,
  type CodingMode,
  type OptimizerState,
  optionGuidance,
  OUTPUT_MODES,
  type OutputMode,
} from "./modes.ts";

export type OptimizerRow = {
  key: keyof OptimizerState;
  label: string;
  values: readonly (string | boolean)[];
  display(value: string | boolean): string;
};

export function optimizerRows(rtkAvailable: boolean): OptimizerRow[] {
  return [
    {
      key: "output",
      label: "Output",
      values: OUTPUT_MODES,
      display: (value) => String(value),
    },
    {
      key: "coding",
      label: "Coding",
      values: CODING_MODES,
      display: (value) => String(value),
    },
    ...(rtkAvailable
      ? [
          {
            key: "rtk" as const,
            label: "Tool output",
            values: [false, true] as const,
            display: (value: string | boolean) => (value ? "rtk" : "off"),
          },
        ]
      : []),
  ];
}

function fit(value: string, width: number): string {
  const clipped = truncateToWidth(value, Math.max(0, width), "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

export type OptimizerInsights = {
  contextPercent?: number;
  bashCalls: number;
  rtkAvailable: boolean;
};

export function insightRecommendation(
  insights: OptimizerInsights,
  state: OptimizerState,
): string {
  if (insights.bashCalls >= 5) {
    if (!insights.rtkAvailable) return "Shell-heavy session; install RTK to compact future supported commands.";
    if (!state.rtk) return "Shell-heavy session; enabling RTK may reduce future tool output.";
    return "RTK is enabled for future supported shell commands.";
  }
  if ((insights.contextPercent ?? 0) >= 70) {
    return state.output === "off"
      ? "Context is crowded; brief is the lowest-friction output reduction."
      : "Context is crowded; the active output mode will slow future response growth.";
  }
  if (state.output === "off" && state.coding === "off") {
    return "Suggested baseline: brief with ponytail-lite; increase compression only when useful.";
  }
  return "Current controls suit moderate usage; stronger modes trade readability for compression.";
}

export type OptimizerPopupOutcome = "close" | "install-rtk";

export async function openOptimizerPopup(
  ctx: ExtensionContext,
  state: OptimizerState,
  rtkAvailable: boolean,
  onChange: (next: OptimizerState) => void,
  insights?: OptimizerInsights,
): Promise<OptimizerPopupOutcome | undefined> {
  const rows = optimizerRows(rtkAvailable);
  return ctx.ui.custom<OptimizerPopupOutcome>(
    (tui, theme, keybindings, done) => {
      let selected = 0;
      let showHelp = false;

      const move = (direction: -1 | 1) => {
        selected = (selected + direction + rows.length) % rows.length;
      };
      const cycle = (direction: -1 | 1) => {
        const row = rows[selected]!;
        const current = state[row.key];
        const index = row.values.indexOf(current);
        const nextIndex =
          (index + direction + row.values.length) % row.values.length;
        const value = row.values[nextIndex]!;
        const next: OptimizerState = { ...state };
        if (row.key === "output") next.output = value as OutputMode;
        else if (row.key === "coding") next.coding = value as CodingMode;
        else next.rtk = value as boolean;
        Object.assign(state, next);
        onChange(next);
      };

      return {
        render(width: number): string[] {
          const inner = Math.max(42, Math.min(68, width - 2));
          const border = (text: string) => theme.fg("borderAccent", text);
          const rowLine = (text = "") =>
            border("│") + fit(` ${text}`, inner) + border("│");
          const divider = () => border(`├${"─".repeat(inner)}┤`);
          const wrappedRows = (text: string, color: "text" | "dim" | "muted") =>
            wrapTextWithAnsi(theme.fg(color, text), inner - 2).map((line) => rowLine(line));
          const lines = [border(`╭${"─".repeat(inner)}╮`)];

          if (showHelp) {
            lines.push(rowLine(theme.fg("accent", theme.bold("Token Optimizer · comparison"))));
            lines.push(divider());
            lines.push(...wrappedRows("OUTPUT controls assistant response length and style.", "muted"));
            lines.push(...wrappedRows("off — unchanged · brief — low-friction default · caveman-lite — compact sentences", "text"));
            lines.push(...wrappedRows("caveman-full — terse fragments · caveman-ultra — maximum compression", "text"));
            lines.push(...wrappedRows("CODING controls how strongly the agent minimizes implementation ownership.", "muted"));
            lines.push(...wrappedRows("off — unconstrained · ponytail-lite — suggests simpler options · ponytail-full — smallest maintainable diff", "text"));
            lines.push(...wrappedRows("ponytail-ultra — aggressive YAGNI and pushback on speculative work", "text"));
            lines.push(...wrappedRows("TOOL OUTPUT: RTK compacts future supported shell commands; unsupported commands run normally.", "muted"));
            lines.push(...wrappedRows("Safety, required validation, exact code/errors, and destructive-action warnings remain preserved.", "dim"));
            lines.push(divider());
            lines.push(rowLine(theme.fg("dim", "? back · q close")));
          } else {
            lines.push(rowLine(theme.fg("accent", theme.bold("Token Optimizer"))));
            lines.push(
              rowLine(
                theme.fg(
                  "dim",
                  rtkAvailable
                    ? "Session-scoped; fresh sessions start off"
                    : "Session-scoped; RTK hidden (binary not found)",
                ),
              ),
            );
            lines.push(divider());
            for (const [index, row] of rows.entries()) {
              const active = index === selected;
              const value = row.display(state[row.key]);
              const marker = active ? theme.fg("accent", "❯") : " ";
              const label = theme.fg(
                active ? "accent" : "text",
                row.label.padEnd(13),
              );
              const renderedValue = theme.fg(
                value === "off" ? "dim" : "success",
                value,
              );
              lines.push(
                rowLine(
                  active
                    ? theme.bg(
                        "selectedBg",
                        fit(`${marker} ${label} ${renderedValue}`, inner - 2),
                      )
                    : `${marker} ${label} ${renderedValue}`,
                ),
              );
            }

            const row = rows[selected]!;
            const value = row.display(state[row.key]);
            const guidance = optionGuidance(row.key, state[row.key]);
            const badge = guidance.badge ? ` · ${guidance.badge}` : "";
            lines.push(divider());
            lines.push(rowLine(theme.fg("accent", theme.bold(`${value}${badge}`))));
            lines.push(...wrappedRows(guidance.summary, "text"));
            lines.push(...wrappedRows(`Best for: ${guidance.bestFor}`, "muted"));
            lines.push(...wrappedRows(`Trade-off: ${guidance.tradeoff}`, "dim"));
            if (insights) {
              lines.push(divider());
              const usage = insights.contextPercent == null
                ? "Context usage unavailable"
                : `Context ${Math.round(insights.contextPercent)}% full`;
              const activity = `${insights.bashCalls} Bash result${insights.bashCalls === 1 ? "" : "s"}`;
              lines.push(...wrappedRows(`Session insight: ${usage} · ${activity}. ${insightRecommendation(insights, state)}`, "muted"));
            }
            lines.push(divider());
            lines.push(
              rowLine(
                theme.fg(
                  "dim",
                  `↑/↓ move · ←/→ change · ? compare${rtkAvailable ? "" : " · i install RTK"} · q close`,
                ),
              ),
            );
          }

          lines.push(border(`╰${"─".repeat(inner)}╯`));
          return lines.map((line) => truncateToWidth(line, width, ""));
        },
        invalidate() {},
        handleInput(data: string) {
          if (
            keybindings.matches(data, "tui.select.cancel") ||
            matchesKey(data, "escape") ||
            matchesKey(data, "ctrl+c") ||
            data.toLowerCase() === "q"
          ) {
            done("close");
            return;
          }
          if (data === "?") {
            showHelp = !showHelp;
            tui.requestRender();
            return;
          }
          if (showHelp) return;
          if (!rtkAvailable && data.toLowerCase() === "i") {
            done("install-rtk");
            return;
          }
          if (
            data === "j" ||
            keybindings.matches(data, "tui.select.down") ||
            matchesKey(data, "down")
          )
            move(1);
          else if (
            data === "k" ||
            keybindings.matches(data, "tui.select.up") ||
            matchesKey(data, "up")
          )
            move(-1);
          else if (data === "h" || matchesKey(data, "left")) cycle(-1);
          else if (
            data === "l" ||
            matchesKey(data, "right") ||
            matchesKey(data, "space") ||
            matchesKey(data, "enter")
          )
            cycle(1);
          else return;
          tui.requestRender();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: 72,
        minWidth: 48,
        maxHeight: "90%",
        margin: 1,
      },
    },
  );
}
