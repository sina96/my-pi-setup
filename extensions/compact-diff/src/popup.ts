import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type {
  FileAction,
  FileActionCapabilities,
  FileTarget,
} from "./actions.ts";
import { availableFileActions, targetForLine } from "./actions.ts";
import type { DiffDocument, DiffLine } from "./parser.ts";
import { hunkText } from "./parser.ts";

export type DiffPopupOutcome =
  | { action: "close" }
  | { action: "analyze"; scope: "hunk" | "diff"; text: string };

type ActionHandler = (
  action: FileAction,
  target: FileTarget,
) => Promise<string>;

function clean(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ");
}

function fit(value: string, width: number): string {
  const clipped = truncateToWidth(value, Math.max(0, width), "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function lineNumber(value?: number): string {
  return value == null ? "    " : String(value).padStart(4);
}

function lineColor(line: DiffLine): Parameters<Theme["fg"]>[0] {
  if (line.kind === "add") return "toolDiffAdded";
  if (line.kind === "remove") return "toolDiffRemoved";
  if (line.kind === "hunk") return "accent";
  if (line.kind === "context") return "toolDiffContext";
  return "muted";
}

function currentFile(document: DiffDocument, selected: number) {
  return document.files.find(
    (file) => selected >= file.start && selected <= file.end,
  );
}

function jumpIndex(
  indexes: number[],
  selected: number,
  direction: -1 | 1,
): number {
  if (indexes.length === 0) return selected;
  if (direction > 0)
    return indexes.find((index) => index > selected) ?? indexes[0]!;
  return (
    [...indexes].reverse().find((index) => index < selected) ??
    indexes[indexes.length - 1]!
  );
}

export async function openCompactDiffPopup(
  ctx: ExtensionContext,
  document: DiffDocument,
  title: string,
  root: string,
  capabilities: FileActionCapabilities,
  onAction: ActionHandler,
): Promise<DiffPopupOutcome | undefined> {
  return ctx.ui.custom<DiffPopupOutcome>(
    (tui, theme, keybindings, done) => {
      const actionDescriptors = availableFileActions(capabilities);
      const actionByKey = new Map(
        actionDescriptors.map((descriptor) => [
          descriptor.key,
          descriptor.action,
        ]),
      );
      let selected = document.hunks[0] ?? 0;
      let scrollTop = Math.max(0, selected - 2);
      let actionMenu = false;
      let busy = false;
      let status = "";

      const move = (amount: number) => {
        selected = Math.max(
          0,
          Math.min(document.lines.length - 1, selected + amount),
        );
      };
      const jumpHunk = (direction: -1 | 1) => {
        selected = jumpIndex(document.hunks, selected, direction);
      };
      const jumpFile = (direction: -1 | 1) => {
        selected = jumpIndex(
          document.files.map((file) => file.start),
          selected,
          direction,
        );
      };
      const runAction = (action: FileAction) => {
        const target = targetForLine(root, document.lines[selected]!);
        if (!target) {
          status = "No working-tree file is selected";
          actionMenu = false;
          tui.requestRender();
          return;
        }
        busy = true;
        status = `Opening ${target.path}…`;
        actionMenu = false;
        tui.requestRender();
        void onAction(action, target)
          .then((message) => {
            status = message;
          })
          .catch((error) => {
            status = error instanceof Error ? error.message : String(error);
          })
          .finally(() => {
            busy = false;
            tui.requestRender();
          });
      };

      return {
        render(width: number): string[] {
          const inner = Math.max(30, width - 2);
          const content = inner - 2;
          const terminalRows = tui.terminal?.rows ?? 24;
          const bodyHeight = Math.max(7, Math.min(28, terminalRows - 9));
          const border = (value: string) => theme.fg("borderAccent", value);
          const row = (value = "") =>
            border("│") + fit(` ${value}`, inner) + border("│");
          const file = currentFile(document, selected);
          const heading = theme.fg("accent", theme.bold("Compact Diff"));
          const scope = theme.fg("dim", clean(title));
          const count = theme.fg(
            "muted",
            `${file ? document.files.indexOf(file) + 1 : 0}/${document.files.length} files`,
          );
          const headingWidth =
            visibleWidth(heading) +
            visibleWidth(scope) +
            visibleWidth(count) +
            4;
          const lines = [border(`╭${"─".repeat(inner)}╮`)];
          lines.push(
            row(
              `${heading} · ${scope}${" ".repeat(Math.max(1, content - headingWidth))}${count}`,
            ),
          );
          if (file) {
            lines.push(
              row(
                `${theme.fg("text", clean(file.path))}  ${theme.fg("toolDiffAdded", `+${file.additions}`)} ${theme.fg("toolDiffRemoved", `-${file.deletions}`)}`,
              ),
            );
          } else {
            lines.push(row(theme.fg("dim", "No file")));
          }
          lines.push(border(`├${"─".repeat(inner)}┤`));

          if (selected < scrollTop) scrollTop = selected;
          if (selected >= scrollTop + bodyHeight)
            scrollTop = selected - bodyHeight + 1;
          scrollTop = Math.max(
            0,
            Math.min(
              scrollTop,
              Math.max(0, document.lines.length - bodyHeight),
            ),
          );

          for (let offset = 0; offset < bodyHeight; offset++) {
            const index = scrollTop + offset;
            const diffLine = document.lines[index];
            if (!diffLine) {
              lines.push(row());
              continue;
            }
            const marker = index === selected ? theme.fg("accent", "❯") : " ";
            const numbers = `${lineNumber(diffLine.oldLine)} ${lineNumber(diffLine.newLine)}`;
            const available = Math.max(1, content - 13);
            const rendered = `${marker} ${theme.fg("dim", numbers)} ${theme.fg(
              lineColor(diffLine),
              truncateToWidth(clean(diffLine.text), available, ""),
            )}`;
            lines.push(
              row(
                index === selected
                  ? theme.bg("selectedBg", fit(rendered, content))
                  : rendered,
              ),
            );
          }

          lines.push(border(`├${"─".repeat(inner)}┤`));
          if (actionMenu) {
            const actions = actionDescriptors
              .map((descriptor) => `${descriptor.key} ${descriptor.label}`)
              .join(" · ");
            lines.push(
              row(theme.fg("accent", `Open: ${actions} · Esc cancel`)),
            );
          } else if (busy || status) {
            lines.push(
              row(theme.fg(busy ? "warning" : "muted", clean(status))),
            );
          } else {
            lines.push(
              row(
                theme.fg(
                  "dim",
                  "↑/↓ or j/k move · ←/→ or p/n hunk · [/ ] file · o open · a/A analyze · q quit",
                ),
              ),
            );
          }
          lines.push(border(`╰${"─".repeat(inner)}╯`));
          return lines.map((line) => truncateToWidth(line, width, ""));
        },
        invalidate() {},
        handleInput(data: string) {
          if (busy) return;
          if (actionMenu) {
            if (
              keybindings.matches(data, "tui.select.cancel") ||
              matchesKey(data, "escape")
            ) {
              actionMenu = false;
            } else {
              const action = actionByKey.get(data.toLowerCase());
              if (action) runAction(action);
            }
            tui.requestRender();
            return;
          }

          if (
            keybindings.matches(data, "tui.select.cancel") ||
            matchesKey(data, "escape") ||
            matchesKey(data, "ctrl+c") ||
            data.toLowerCase() === "q"
          ) {
            done({ action: "close" });
            return;
          }
          if (data === "o") actionMenu = true;
          else if (data === "a")
            done({
              action: "analyze",
              scope: "hunk",
              text: hunkText(document, selected),
            });
          else if (data === "A")
            done({ action: "analyze", scope: "diff", text: document.text });
          else if (
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
          else if (data === "n" || matchesKey(data, "right")) jumpHunk(1);
          else if (data === "p" || matchesKey(data, "left")) jumpHunk(-1);
          else if (data === "]") jumpFile(1);
          else if (data === "[") jumpFile(-1);
          else if (data === "g") selected = 0;
          else if (data === "G")
            selected = Math.max(0, document.lines.length - 1);
          else if (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+d"))
            move(Math.max(1, Math.floor((tui.terminal?.rows ?? 24) / 2)));
          else if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+u"))
            move(-Math.max(1, Math.floor((tui.terminal?.rows ?? 24) / 2)));
          else return;
          status = "";
          tui.requestRender();
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "96%",
        minWidth: 76,
        maxHeight: "94%",
        margin: 1,
      },
    },
  );
}
