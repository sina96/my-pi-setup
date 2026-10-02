import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter } from "@earendil-works/pi-tui";
import { ThemePreviewPicker } from "./theme-preview-picker.ts";
import { ORIGINAL_PI, STARTUP_HEADER_EVENT, settingsForChoice, themeNameForChoice } from "./presets.ts";

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
    writeFileSync(path, `${JSON.stringify(settingsForChoice(settings, name), null, 2)}\n`, "utf8");
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export default function themePicker(pi: ExtensionAPI) {
  let themeNames: string[] = [];
  let activeTheme: string | undefined;
  let originalPreset = false;

  function refresh(ctx: ExtensionContext): void {
    themeNames = [ORIGINAL_PI, ...[...new Set(ctx.ui.getAllThemes().map((theme) => theme.name))]
      .filter((name) => name !== ORIGINAL_PI).sort((a, b) => a.localeCompare(b))];
    activeTheme = originalPreset && ctx.ui.theme.name === "system"
      ? ORIGINAL_PI : ctx.ui.theme.name ?? activeTheme;
  }

  function apply(name: string, ctx: ExtensionContext): boolean {
    const result = ctx.ui.setTheme(themeNameForChoice(name));
    if (!result.success) {
      ctx.ui.notify(`Could not apply theme "${name}": ${result.error ?? "unknown error"}`, "error");
      return false;
    }

    originalPreset = name === ORIGINAL_PI;
    activeTheme = originalPreset ? ORIGINAL_PI : ctx.ui.theme.name ?? name;
    pi.events.emit(STARTUP_HEADER_EVENT, originalPreset ? "builtin" : "dashboard");
    const saveError = saveTheme(name);
    if (saveError) {
      ctx.ui.notify(`Theme applied for this session, but could not save it: ${saveError}`, "warning");
    } else {
      ctx.ui.notify(`Theme "${activeTheme}" applied and saved${originalPreset ? "; restart Pi to fully restore its native startup header and resource listing" : ""}`, "info");
    }
    return true;
  }

  async function openPicker(ctx: ExtensionContext): Promise<void> {
    refresh(ctx);
    if (themeNames.length === 0) {
      ctx.ui.notify("No themes are available", "warning");
      return;
    }

    const originalName = activeTheme ?? ctx.ui.theme.name;
    const selected = await ctx.ui.custom<string | undefined>(
      (tui, _theme, keybindings, done) =>
        new ThemePreviewPicker({
          names: themeNames,
          activeName: originalName,
          initialName: activeTheme,
          getTheme: (name) => ctx.ui.getTheme(themeNameForChoice(name)),
          keybindings,
          onChange: () => tui.requestRender(),
          onDone: done,
        }),
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          width: "92%",
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
    try {
      const settings = JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf8"));
      originalPreset = settings.piStartupHeader === "builtin" && ctx.ui.theme.name === "system";
    } catch {
      originalPreset = false;
    }
    refresh(ctx);
  });
}
