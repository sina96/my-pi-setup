import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import themePicker from "./src/index.ts";
import { ORIGINAL_PI, settingsForChoice, themeNameForChoice } from "./src/presets.ts";

test("Original Pi uses the native system palette and preserves unrelated settings", () => {
  const settings = { theme: "dark", quietStartup: true, defaultModel: "test", extensions: ["custom"] };
  assert.equal(themeNameForChoice(ORIGINAL_PI), "system");
  assert.equal(themeNameForChoice("dark"), "dark");
  assert.deepEqual(settingsForChoice(settings, ORIGINAL_PI), {
    ...settings, theme: "system", quietStartup: false, piStartupHeader: "builtin",
  });
  assert.deepEqual(settingsForChoice(settingsForChoice(settings, ORIGINAL_PI), "light"), {
    ...settings, theme: "light", quietStartup: "header", piStartupHeader: "dashboard",
  });
  assert.equal(settings.quietStartup, true);
});

test("theme commands restore the native header and return to dashboard; invalid choices do nothing", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-theme-picker-"));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    await writeFile(join(root, "settings.json"), JSON.stringify({ theme: "dark", quietStartup: true, defaultModel: "keep" }));
    const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
    const events: unknown[][] = [];
    const applied: string[] = [];
    const notifications: string[] = [];
    themePicker({
      registerCommand: (name: string, command: never) => commands.set(name, command),
      on: () => {},
      events: { emit: (...args: unknown[]) => events.push(args) },
    } as never);
    const theme = { name: "dark" };
    const ctx = { ui: {
      theme,
      getAllThemes: () => [{ name: "dark" }, { name: "system" }],
      setTheme: (name: string) => { applied.push(name); theme.name = name; return { success: true }; },
      notify: (message: string) => notifications.push(message),
    } };
    await commands.get("theme")!.handler("original pi", ctx);
    assert.deepEqual(applied, ["system"]);
    assert.deepEqual(events, [["pi-startup:header", "builtin"]]);
    assert.ok(notifications.some((message) => message.includes("restart Pi")));
    assert.deepEqual(JSON.parse(await readFile(join(root, "settings.json"), "utf8")), {
      theme: "system", quietStartup: false, defaultModel: "keep", piStartupHeader: "builtin",
    });
    await commands.get("theme")!.handler("dark", ctx);
    assert.deepEqual(events[1], ["pi-startup:header", "dashboard"]);
    assert.deepEqual(JSON.parse(await readFile(join(root, "settings.json"), "utf8")), {
      theme: "dark", quietStartup: "header", defaultModel: "keep", piStartupHeader: "dashboard",
    });
    await commands.get("theme")!.handler("missing", ctx);
    assert.deepEqual(applied, ["system", "dark"]);
    assert.equal(events.length, 2);
  } finally {
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousDir;
    await rm(root, { recursive: true, force: true });
  }
});
