import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Input,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  availableFileActions,
  type FileAction,
  type FileActionCapabilities,
} from "./actions.ts";
import {
  fuzzyFiles,
  searchContent,
  type FileMatch,
  type SearchBinaries,
  type SearchMode,
} from "./search.ts";

export interface BrowserState {
  mode: SearchMode;
  query: string;
}

export interface BrowserOutcome extends BrowserState {
  action: FileAction | "close";
  match?: FileMatch;
}

function fit(value: string, width: number): string {
  const clipped = truncateToWidth(value, Math.max(0, width), "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function clean(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ");
}

export async function openFileBrowserPopup(
  ctx: ExtensionContext,
  files: string[],
  binaries: SearchBinaries,
  capabilities: FileActionCapabilities,
  state: BrowserState = { mode: "files", query: "" },
): Promise<BrowserOutcome | undefined> {
  let abortSearch: AbortController | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let alive = true;
  try {
    return await ctx.ui.custom<BrowserOutcome>(
      (tui, theme: Theme, keybindings, done) => {
        const input = new Input();
        const actionDescriptors = availableFileActions(capabilities);
        const actionByKey = new Map(
          actionDescriptors.map((descriptor) => [
            descriptor.key,
            descriptor.action,
          ]),
        );
        input.setValue(state.query);
        let mode = state.mode;
        let editorMode: "normal" | "insert" = "normal";
        let matches: FileMatch[] = [];
        let selected = 0;
        let searching = false;
        let error: string | undefined;
        let generation = 0;

        const runSearch = async () => {
          const currentGeneration = ++generation;
          abortSearch?.abort();
          abortSearch = new AbortController();
          searching = true;
          error = undefined;
          tui.requestRender();
          try {
            const query = input.getValue();
            const next =
              mode === "files"
                ? await fuzzyFiles(
                    files,
                    query,
                    binaries.fzf,
                    ctx.cwd,
                    abortSearch.signal,
                  )
                : await searchContent(
                    query,
                    binaries,
                    ctx.cwd,
                    abortSearch.signal,
                  );
            if (!alive || currentGeneration !== generation) return;
            matches = next;
            selected = Math.max(
              0,
              Math.min(selected, Math.max(0, matches.length - 1)),
            );
          } catch (searchError) {
            if (
              !alive ||
              currentGeneration !== generation ||
              abortSearch.signal.aborted
            )
              return;
            error =
              searchError instanceof Error
                ? searchError.message
                : String(searchError);
            matches = [];
          } finally {
            if (alive && currentGeneration === generation) {
              searching = false;
              tui.requestRender();
            }
          }
        };

        const scheduleSearch = () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(runSearch, mode === "content" ? 180 : 60);
        };

        const toggleMode = () => {
          mode = mode === "files" ? "content" : "files";
          selected = 0;
          scheduleSearch();
        };

        const move = (amount: number) => {
          selected = Math.max(
            0,
            Math.min(matches.length - 1, selected + amount),
          );
        };

        const finish = (action: FileAction | "close") => {
          done({
            action,
            match: action === "close" ? undefined : matches[selected],
            mode,
            query: input.getValue(),
          });
        };

        const actionForKey = (data: string): FileAction | undefined =>
          actionByKey.get(data.toLowerCase());

        void runSearch();

        return {
          render(width: number): string[] {
            const inner = Math.max(72, width - 2);
            const content = inner - 2;
            const border = (value: string) => theme.fg("borderAccent", value);
            const row = (value = "") =>
              border("│") + fit(` ${value}`, inner) + border("│");
            const lines = [border(`╭${"─".repeat(inner)}╮`)];
            const modeText =
              mode === "files" ? "FILES · fd/fzf" : "CONTENT · rg/fzf";
            const title = theme.fg("accent", theme.bold("File Manager"));
            const right = theme.fg(
              "muted",
              `${modeText} · ${matches.length} matches`,
            );
            lines.push(
              row(
                `${title}${" ".repeat(Math.max(1, content - visibleWidth(title) - visibleWidth(right)))}${right}`,
              ),
            );
            lines.push(border(`├${"─".repeat(inner)}┤`));
            input.focused = editorMode === "insert";
            const prompt =
              editorMode === "insert"
                ? theme.fg("success", "INSERT")
                : theme.fg("accent", "NORMAL");
            const renderedInput =
              input.render(Math.max(1, content - 12))[0] ?? "";
            lines.push(
              row(
                `${prompt}  ${theme.fg("muted", mode === "files" ? "find" : "grep")}  ${renderedInput}`,
              ),
            );
            lines.push(row(theme.fg("borderMuted", "─".repeat(content))));

            const visibleRows = 12;
            const offset = Math.max(
              0,
              Math.min(
                Math.max(0, matches.length - visibleRows),
                selected - Math.floor(visibleRows / 2),
              ),
            );
            const visible = matches.slice(offset, offset + visibleRows);
            if (searching) {
              lines.push(row(theme.fg("warning", "Searching…")));
            } else if (error) {
              lines.push(row(theme.fg("error", clean(error))));
            } else if (visible.length === 0) {
              const empty =
                mode === "content" && !input.getValue().trim()
                  ? "Enter insert mode and type text to search file contents."
                  : "No matching files.";
              lines.push(row(theme.fg("dim", empty)));
            } else {
              for (let index = 0; index < visible.length; index += 1) {
                const absoluteIndex = offset + index;
                const item = visible[index];
                const active = absoluteIndex === selected;
                const location = item.line
                  ? `:${item.line}:${item.column ?? 1}`
                  : "";
                const preview = item.preview
                  ? `  ${theme.fg("dim", clean(item.preview))}`
                  : "";
                const text = `${active ? theme.fg("accent", "❯") : " "} ${item.path}${location}${preview}`;
                lines.push(
                  row(
                    active ? theme.bg("selectedBg", fit(text, content)) : text,
                  ),
                );
              }
            }
            lines.push(border(`├${"─".repeat(inner)}┤`));
            const actionHelp = actionDescriptors
              .map(
                (descriptor) =>
                  `${descriptor.action === "zed" ? `${descriptor.key}/Enter` : descriptor.key} ${descriptor.label}`,
              )
              .join(" · ");
            const help =
              editorMode === "insert"
                ? "Esc normal · Tab files/content · ↑/↓ move · type to search"
                : `i or / search · j/k move · Tab mode · ${actionHelp} · q close`;
            lines.push(row(theme.fg("dim", help)));
            lines.push(border(`╰${"─".repeat(inner)}╯`));
            return lines.map((line) => truncateToWidth(line, width, ""));
          },
          invalidate() {
            input.invalidate();
          },
          handleInput(data: string) {
            if (
              keybindings.matches(data, "tui.input.tab") ||
              matchesKey(data, "tab")
            ) {
              toggleMode();
              return;
            }
            if (editorMode === "insert") {
              if (
                keybindings.matches(data, "tui.select.cancel") ||
                matchesKey(data, "escape")
              ) {
                editorMode = "normal";
                tui.requestRender();
                return;
              }
              if (keybindings.matches(data, "tui.select.up")) {
                move(-1);
              } else if (keybindings.matches(data, "tui.select.down")) {
                move(1);
              } else if (keybindings.matches(data, "tui.select.confirm")) {
                editorMode = "normal";
              } else {
                const before = input.getValue();
                input.handleInput(data);
                if (input.getValue() !== before) scheduleSearch();
              }
              tui.requestRender();
              return;
            }

            if (
              keybindings.matches(data, "tui.select.cancel") ||
              matchesKey(data, "ctrl+c") ||
              data.toLowerCase() === "q"
            ) {
              finish("close");
              return;
            }
            if (data === "i" || data === "/") {
              editorMode = "insert";
            } else if (
              keybindings.matches(data, "tui.select.up") ||
              data.toLowerCase() === "k"
            ) {
              move(-1);
            } else if (
              keybindings.matches(data, "tui.select.down") ||
              data.toLowerCase() === "j"
            ) {
              move(1);
            } else if (data === "g") {
              selected = 0;
            } else if (data === "G") {
              selected = Math.max(0, matches.length - 1);
            } else if (keybindings.matches(data, "tui.select.confirm")) {
              const editorAction = actionByKey.get("z");
              if (matches[selected] && editorAction) finish(editorAction);
            } else {
              const action = actionForKey(data);
              if (action && matches[selected]) finish(action);
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
          maxHeight: "92%",
          margin: 1,
        },
      },
    );
  } finally {
    alive = false;
    abortSearch?.abort();
    if (debounce) clearTimeout(debounce);
  }
}
