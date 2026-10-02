// A UI preset, not a duplicate theme JSON. Pi's system palette stays native.
export const ORIGINAL_PI = "Original Pi";
export const STARTUP_HEADER_EVENT = "pi-startup:header";

export function themeNameForChoice(choice: string): string {
  return choice === ORIGINAL_PI ? "system" : choice;
}

export function settingsForChoice(settings: Record<string, unknown>, choice: string): Record<string, unknown> {
  const original = choice === ORIGINAL_PI;
  return {
    ...settings,
    theme: themeNameForChoice(choice),
    // Keep a real built-in header available for restoration next startup.
    quietStartup: original ? false : "header",
    piStartupHeader: original ? "builtin" : "dashboard",
  };
}
