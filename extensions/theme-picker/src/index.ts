import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import { ThemePreviewPicker } from "./theme-preview-picker.ts";

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
    const selected = await ctx.ui.custom<string | undefined>(
      (tui, _theme, keybindings, done) =>
        new ThemePreviewPicker({
          names: themeNames,
          activeName: originalName,
          initialName: activeTheme,
          getTheme: (name) => ctx.ui.getTheme(name),
          keybindings,
          onChange: () => tui.requestRender(),
          onDone: done,
        }),
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: "92%",
          minWidth: 70,
          maxWidth: 120,
          maxHeight: "90%",
          margin: 1,
        },
      },
    );

    if (selected) apply(selected, ctx);
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
