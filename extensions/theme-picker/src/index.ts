import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  Container,
  decodeKittyPrintable,
  fuzzyFilter,
  Key,
  matchesKey,
  SelectList,
  Text,
  type SelectItem,
} from "@earendil-works/pi-tui";

function saveTheme(name: string): string | undefined {
  const path = join(getAgentDir(), "settings.json");
  try {
    let settings: Record<string, unknown> = {};
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        settings = parsed as Record<string, unknown>;
      }
    }
    settings.theme = name;
    writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function printableInput(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty) return kitty;
  if (data.length === 1 && data >= " " && data !== "\x7f") return data;
  return undefined;
}

export default function themePicker(pi: ExtensionAPI) {
  let themeNames: string[] = [];
  let activeTheme: string | undefined;

  function refresh(ctx: ExtensionContext): void {
    themeNames = [...new Set(ctx.ui.getAllThemes().map((theme) => theme.name))]
      .sort((a, b) => a.localeCompare(b));
    activeTheme = ctx.ui.theme.name ?? activeTheme;
  }

  function apply(name: string, ctx: ExtensionContext): boolean {
    const result = ctx.ui.setTheme(name);
    if (!result.success) {
      ctx.ui.notify(`Could not apply theme "${name}": ${result.error ?? "unknown error"}`, "error");
      return false;
    }

    activeTheme = ctx.ui.theme.name ?? name;
    const saveError = saveTheme(activeTheme);
    if (saveError) {
      ctx.ui.notify(`Theme applied for this session, but could not save it: ${saveError}`, "warning");
    } else {
      ctx.ui.notify(`Theme "${activeTheme}" applied and saved`, "info");
    }
    return true;
  }

  async function openPicker(ctx: ExtensionContext): Promise<void> {
    refresh(ctx);
    if (themeNames.length === 0) {
      ctx.ui.notify("No themes are available", "warning");
      return;
    }

    const originalName = ctx.ui.theme.name ?? activeTheme;
    const originalTheme = originalName ? ctx.ui.getTheme(originalName) : undefined;

    const selected = await ctx.ui.custom<string | undefined>((tui, theme, kb, done) => {
      const container = new Container();
      const themeCache = new Map<string, NonNullable<ReturnType<typeof ctx.ui.getTheme>>>();
      let query = "";
      let preferred = activeTheme;
      let previewed = activeTheme;
      let list: SelectList | undefined;

      function items(): SelectItem[] {
        return fuzzyFilter(themeNames, query, (name) => name).map((name) => ({
          value: name,
          label: name === originalName ? `${name} (active)` : name,
        }));
      }

      function preview(name: string): void {
        if (name === previewed) return;
        let candidate = themeCache.get(name);
        if (!candidate) {
          candidate = ctx.ui.getTheme(name);
          if (candidate) themeCache.set(name, candidate);
        }
        if (!candidate) return;
        ctx.ui.setTheme(candidate);
        previewed = name;
        preferred = name;
      }

      function rebuild(previewFirst = false): void {
        const available = items();
        const queryLabel = query ? theme.fg("muted", ` · search: ${query}`) : "";
        const previewLabel = previewed ? theme.fg("muted", ` · preview: ${previewed}`) : "";

        container.clear();
        container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
        container.addChild(new Text(theme.fg("accent", theme.bold("Select Theme")) + queryLabel + previewLabel, 1, 0));

        list = new SelectList(available, Math.min(Math.max(available.length, 1), 12), {
          selectedPrefix: (text) => theme.fg("accent", text),
          selectedText: (text) => theme.fg("accent", text),
          description: (text) => theme.fg("muted", text),
          scrollInfo: (text) => theme.fg("dim", text),
          noMatch: () => theme.fg("warning", "  No matching themes"),
        });

        const preferredIndex = available.findIndex((item) => item.value === preferred);
        if (preferredIndex >= 0) list.setSelectedIndex(preferredIndex);
        list.onSelectionChange = (item) => preview(item.value);
        list.onSelect = (item) => done(item.value);
        list.onCancel = () => done(undefined);
        container.addChild(list);
        container.addChild(new Text(
          theme.fg("dim", "type search · backspace edit · ctrl+u clear · ↑↓ preview · enter apply · esc cancel"),
          1,
          0,
        ));
        container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
        container.invalidate();

        if (previewFirst) {
          const first = list.getSelectedItem();
          if (first) preview(first.value);
        }
      }

      rebuild();

      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          if (kb.matches(data, "app.tools.expand")) {
            ctx.ui.setToolsExpanded(!ctx.ui.getToolsExpanded());
            return;
          }
          if (matchesKey(data, Key.ctrl("u"))) {
            if (query) {
              query = "";
              preferred = previewed;
              rebuild();
              tui.requestRender();
            }
            return;
          }
          if (matchesKey(data, Key.backspace)) {
            if (query) {
              query = query.slice(0, -1);
              preferred = query ? undefined : previewed;
              rebuild(Boolean(query));
              tui.requestRender();
            }
            return;
          }

          const character = printableInput(data);
          if (character !== undefined) {
            query += character;
            preferred = undefined;
            rebuild(true);
            tui.requestRender();
            return;
          }

          list?.handleInput(data);
          tui.requestRender();
        },
      };
    });

    if (!selected) {
      if (originalTheme) ctx.ui.setTheme(originalTheme);
      else if (originalName) ctx.ui.setTheme(originalName);
      activeTheme = originalName;
      return;
    }

    apply(selected, ctx);
  }

  pi.registerCommand("theme", {
    description: "Preview, select, and save a Pi theme",
    getArgumentCompletions: (prefix) => {
      const matches = fuzzyFilter(themeNames, prefix, (name) => name);
      return matches.length ? matches.map((name) => ({ value: name, label: name })) : null;
    },
    handler: async (args, ctx) => {
      refresh(ctx);
      const requested = args.trim();
      if (!requested) {
        await openPicker(ctx);
        return;
      }

      const exact = themeNames.find((name) => name.toLowerCase() === requested.toLowerCase());
      if (!exact) {
        ctx.ui.notify(`Unknown theme "${requested}". Run /theme to browse available themes.`, "error");
        return;
      }
      apply(exact, ctx);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    refresh(ctx);
  });
}
