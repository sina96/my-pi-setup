import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  CODING_MODES,
  type CodingMode,
  type OptimizerState,
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

export type OptimizerPopupOutcome = "close" | "install-rtk";

export async function openOptimizerPopup(
  ctx: ExtensionContext,
  state: OptimizerState,
  rtkAvailable: boolean,
  onChange: (next: OptimizerState) => void,
): Promise<OptimizerPopupOutcome | undefined> {
  const rows = optimizerRows(rtkAvailable);
  return ctx.ui.custom<OptimizerPopupOutcome>(
    (tui, theme, keybindings, done) => {
      let selected = 0;

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
          const lines = [border(`╭${"─".repeat(inner)}╮`)];
          lines.push(
            rowLine(theme.fg("accent", theme.bold("Token Optimizer"))),
          );
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
          lines.push(border(`├${"─".repeat(inner)}┤`));
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
          lines.push(border(`├${"─".repeat(inner)}┤`));
          lines.push(
            rowLine(
              theme.fg(
                "dim",
                `↑/↓ or j/k move · ←/→ or h/l change${rtkAvailable ? "" : " · i install RTK"} · q close`,
              ),
            ),
          );
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
        maxHeight: "70%",
        margin: 1,
      },
    },
  );
}
