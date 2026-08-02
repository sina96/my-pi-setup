import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  decodeKittyPrintable,
  fuzzyFilter,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

interface PickerKeybindings {
  matches(data: string, id: string): boolean;
}

interface ThemePreviewPickerOptions {
  names: string[];
  activeName?: string;
  initialName?: string;
  getTheme: (name: string) => Theme | undefined;
  keybindings: PickerKeybindings;
  onChange: () => void;
  onDone: (name: string | undefined) => void;
}

const MAX_VISIBLE_THEMES = 14;

function printableInput(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty) return kitty;
  if (data.length === 1 && data >= " " && data !== "\x7f") return data;
  return undefined;
}

function fit(text: string, width: number): string {
  const truncated = truncateToWidth(text, Math.max(0, width), "");
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

export class ThemePreviewPicker {
  private readonly names: string[];
  private readonly activeName?: string;
  private readonly getTheme: (name: string) => Theme | undefined;
  private readonly keybindings: PickerKeybindings;
  private readonly onChange: () => void;
  private readonly onDone: (name: string | undefined) => void;
  private query = "";
  private filtered: string[];
  private selectedIndex = 0;

  constructor(options: ThemePreviewPickerOptions) {
    this.names = options.names;
    this.activeName = options.activeName;
    this.getTheme = options.getTheme;
    this.keybindings = options.keybindings;
    this.onChange = options.onChange;
    this.onDone = options.onDone;
    this.filtered = [...this.names];
    const initialIndex = this.filtered.indexOf(options.initialName ?? options.activeName ?? "");
    this.selectedIndex = Math.max(0, initialIndex);
  }

  private selectedName(): string | undefined {
    return this.filtered[this.selectedIndex];
  }

  private updateFilter(): void {
    const previous = this.selectedName();
    this.filtered = fuzzyFilter(this.names, this.query, (name) => name);
    const previousIndex = previous ? this.filtered.indexOf(previous) : -1;
    this.selectedIndex = previousIndex >= 0 ? previousIndex : 0;
  }

  private move(delta: number): void {
    if (this.filtered.length === 0) return;
    this.selectedIndex = Math.max(0, Math.min(this.filtered.length - 1, this.selectedIndex + delta));
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.onDone(undefined);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm") || data === "\n") {
      this.onDone(this.selectedName());
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up") || data === "k") {
      this.move(-1);
      this.onChange();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down") || data === "j") {
      this.move(1);
      this.onChange();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.pageUp")) {
      this.move(-MAX_VISIBLE_THEMES);
      this.onChange();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.pageDown")) {
      this.move(MAX_VISIBLE_THEMES);
      this.onChange();
      return;
    }
    if (matchesKey(data, "backspace")) {
      if (this.query) {
        this.query = this.query.slice(0, -1);
        this.updateFilter();
        this.onChange();
      }
      return;
    }
    if (data === "\x15") {
      this.query = "";
      this.updateFilter();
      this.onChange();
      return;
    }

    const character = printableInput(data);
    if (character !== undefined) {
      this.query += character;
      this.updateFilter();
      this.onChange();
    }
  }

  private previewLines(theme: Theme, width: number): string[] {
    const segment = (label: string, token: Parameters<Theme["fg"]>[0]) =>
      theme.fg(token, label);
    const background = (label: string, token: Parameters<Theme["bg"]>[0]) =>
      theme.bg(token, fit(` ${label}`, Math.max(1, Math.floor((width - 2) / 3))));
    const syntax = (token: Parameters<Theme["fg"]>[0], text: string) => theme.fg(token, text);
    const code = [
      `${syntax("syntaxKeyword", "const")} ${syntax("syntaxFunction", "greet")} ${syntax("syntaxOperator", "=")} ${syntax("syntaxPunctuation", "(")}${syntax("syntaxVariable", "name")}${syntax("syntaxOperator", ":")} ${syntax("syntaxType", "string")}${syntax("syntaxPunctuation", ")")} ${syntax("syntaxOperator", "=>")} ${syntax("syntaxPunctuation", "{")}`,
      `  ${syntax("syntaxKeyword", "return")} ${syntax("syntaxString", "`Hello, ${name}!`")}${syntax("syntaxPunctuation", ";")} ${syntax("syntaxComment", "// friendly")}`,
      syntax("syntaxPunctuation", "};"),
    ];

    return [
      theme.fg("mdHeading", theme.bold("# Theme Preview")),
      `${segment("accent", "accent")}  ${segment("muted", "muted")}  ${segment("dim", "dim")}`,
      `${segment("✓ success", "success")}  ${segment("⚠ warning", "warning")}  ${segment("✕ error", "error")}`,
      theme.bg("selectedBg", fit(" selected item", width)),
      theme.bg("userMessageBg", theme.fg("userMessageText", fit(" You: explain this code", width))),
      theme.bg("customMessageBg", theme.fg("customMessageText", fit(" Extension: preview message", width))),
      `${background("pending", "toolPendingBg")} ${background("success", "toolSuccessBg")} ${background("error", "toolErrorBg")}`,
      `${theme.fg("mdHeading", "Heading")}  ${theme.fg("mdLink", "link")} ${theme.fg("mdLinkUrl", "(url)")}  ${theme.fg("mdCode", "`inline code`")}`,
      `${theme.fg("mdQuoteBorder", "│")} ${theme.fg("mdQuote", "quoted text")}  ${theme.fg("mdListBullet", "•")} list item  ${theme.fg("mdHr", "────")}`,
      ...code.slice(0, 3),
      `${theme.fg("toolDiffAdded", "+ added line")}  ${theme.fg("toolDiffRemoved", "- removed line")}  ${theme.fg("toolDiffContext", " context")}`,
      `${theme.fg("thinkingLow", "low")}  ${theme.fg("thinkingMedium", "medium")}  ${theme.fg("thinkingHigh", "high")}  ${theme.fg("thinkingXhigh", "xhigh")}`,
    ].map((line) => truncateToWidth(line, width, ""));
  }

  render(width: number): string[] {
    const selectedName = this.selectedName() ?? this.activeName ?? this.names[0];
    const previewTheme = (selectedName && this.getTheme(selectedName)) || (this.activeName && this.getTheme(this.activeName));
    if (!previewTheme) return ["No valid themes are available"];

    const innerWidth = Math.max(48, width - 2);
    const leftWidth = Math.max(20, Math.min(34, Math.floor(innerWidth * 0.32)));
    const dividerWidth = 3;
    const rightWidth = Math.max(20, innerWidth - leftWidth - dividerWidth);
    const start = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(MAX_VISIBLE_THEMES / 2),
        this.filtered.length - MAX_VISIBLE_THEMES,
      ),
    );
    const visibleNames = this.filtered.slice(start, start + MAX_VISIBLE_THEMES);
    const preview = this.previewLines(previewTheme, rightWidth);
    const bodyRows = Math.max(MAX_VISIBLE_THEMES, preview.length);
    const border = (text: string) => previewTheme.fg("borderAccent", text);
    const row = (left: string, right: string) =>
      border("│") + fit(left, leftWidth) + border(" │ ") + fit(right, rightWidth) + border("│");
    const lines: string[] = [];

    lines.push(border(`╭${"─".repeat(leftWidth)}─┬─${"─".repeat(rightWidth)}╮`));
    lines.push(
      row(
        ` ${previewTheme.fg("accent", previewTheme.bold("Themes"))}`,
        ` ${previewTheme.fg("accent", previewTheme.bold(selectedName ?? "Preview"))}`,
      ),
    );
    lines.push(
      row(
        this.query
          ? ` ${previewTheme.fg("muted", `search: ${this.query}`)}`
          : ` ${previewTheme.fg("dim", "type to search")}`,
        ` ${previewTheme.fg("dim", "isolated preview · not applied yet")}`,
      ),
    );
    lines.push(border(`├${"─".repeat(leftWidth)}─┼─${"─".repeat(rightWidth)}┤`));

    for (let index = 0; index < bodyRows; index++) {
      const name = visibleNames[index];
      const absoluteIndex = start + index;
      let left = "";
      if (name) {
        const marker = absoluteIndex === this.selectedIndex ? " → " : "   ";
        const active = name === this.activeName ? " ●" : "";
        const label = `${marker}${name}${active}`;
        left = absoluteIndex === this.selectedIndex
          ? previewTheme.bg("selectedBg", previewTheme.fg("accent", fit(label, leftWidth)))
          : previewTheme.fg(name === this.activeName ? "success" : "text", label);
      }
      lines.push(row(left, preview[index] ?? ""));
    }

    const position = this.filtered.length
      ? `${this.selectedIndex + 1}/${this.filtered.length}`
      : "no matches";
    lines.push(border(`├${"─".repeat(leftWidth)}─┴─${"─".repeat(rightWidth)}┤`));
    lines.push(
      border("│") +
        fit(
          ` ${previewTheme.fg("dim", `${position} · ↑↓ preview · type filter · ctrl+u clear · enter apply · esc cancel`)}`,
          innerWidth,
        ) +
        border("│"),
    );
    lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
    return lines.map((line) => truncateToWidth(line, width, ""));
  }

  invalidate(): void {}
}
