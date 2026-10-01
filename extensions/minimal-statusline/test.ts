import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import minimalStatusline, { detectRuntimeVersions, getCodemodeState, loadSettings, renderStatusline, saveSettings, summarizeUsage } from "./src/index.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

function context(overrides: Record<string, unknown> = {}): ExtensionContext {
  return {
    cwd: "/work/my-pi-setup",
    mode: "tui",
    model: { provider: "openai-codex", name: "GPT-5.6 Terra", contextWindow: 272_000 },
    getContextUsage: () => ({ tokens: 0, contextWindow: 272_000, percent: 0 }),
    sessionManager: {
      getEntries: () => [
        {
          type: "message",
          message: {
            role: "assistant",
            usage: { input: 1200, output: 34, cacheRead: 0, cacheWrite: 0, cost: { total: 0.015 } },
          },
        },
        {
          type: "message",
          message: {
            role: "toolResult",
            usage: { input: 100, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0.005 } },
          },
        },
      ],
    },
    ...overrides,
  } as never;
}

test("balanced footer includes native model, thinking, token, and cost information", () => {
  const ctx = context();
  const line = renderStatusline(
    theme,
    ctx,
    { project: "my-pi-setup", runtimes: [{ icon: "", name: "Node", version: "v22.20.0" }], thinkingLevel: "medium", usage: summarizeUsage(ctx) },
    "add-model-thinking-etc",
    "balanced",
    200,
  );

  assert.match(line, / my-pi-setup on  add-model-thinking-etc via  v22\.20\.0/);
  assert.match(line, /codemode:off/);
  assert.match(line, /openai-codex → GPT-5\.6 Terra/);
  assert.match(line, /◆ medium/);
  assert.match(line, /0%  ↑1\.3k\/↓36  \$0\.020/);
});

test("minimal footer omits provider, Node, and token totals but preserves thinking", () => {
  const ctx = context();
  const line = renderStatusline(
    theme,
    ctx,
    { project: "my-pi-setup", runtimes: [{ icon: "", name: "Node", version: "v22.20.0" }], thinkingLevel: "max", usage: summarizeUsage(ctx) },
    "branch",
    "minimal",
    200,
  );

  assert.doesNotMatch(line, /openai-codex|v22\.20\.0|↑/);
  assert.match(line, /GPT-5\.6 Terra  ◆ max  codemode:off  0%  \$0\.020/);
});

test("footer prioritizes right-side Pi state within narrow terminal widths", () => {
  const ctx = context();
  const line = renderStatusline(
    theme,
    ctx,
    { project: "a-very-long-project-name", runtimes: [{ icon: "", name: "Node", version: "v22.20.0" }], thinkingLevel: "high", usage: summarizeUsage(ctx) },
    "a-very-long-branch-name",
    "balanced",
    42,
  );

  assert.ok(visibleWidth(line) <= 42);
  assert.match(line, /◆ high/);
  assert.match(line, /\$0\.020/);
});

test("detects declared polyglot toolchains and Node lockfile projects", () => {
  const directory = mkdtempSync(join(tmpdir(), "minimal-statusline-runtimes-"));
  try {
    writeFileSync(join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    writeFileSync(join(directory, "go.mod"), "module example.com/demo\n\ngo 1.23.4\n");
    writeFileSync(join(directory, ".java-version"), "21\n");
    writeFileSync(join(directory, "build.gradle.kts"), "plugins { kotlin(\"jvm\") }\n");
    writeFileSync(join(directory, "Cargo.toml"), "[package]\nrust-version = \"1.82\"\n");
    writeFileSync(join(directory, "pyproject.toml"), "[project]\nrequires-python = \">=3.12\"\n");

    assert.deepEqual(detectRuntimeVersions(directory, "v22.20.0"), [
      { icon: "", name: "Node", version: "v22.20.0" },
      { icon: "", name: "Go", version: "1.23.4" },
      { icon: "", name: "Kotlin/JVM", version: "21" },
      { icon: "", name: "Rust", version: "1.82" },
      { icon: "", name: "Python", version: ">=3.12" },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("uses the current JVM when Maven or Gradle does not declare one", () => {
  const directory = mkdtempSync(join(tmpdir(), "minimal-statusline-java-"));
  try {
    writeFileSync(join(directory, "pom.xml"), "<project/>\n");
    assert.deepEqual(detectRuntimeVersions(directory, "v22.20.0", "21.0.5"), [
      { icon: "", name: "Java", version: "21.0.5" },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("usage aggregation includes nested tool and session-summary usage", () => {
  const ctx = context({
    sessionManager: {
      getEntries: () => [
        { type: "message", message: { role: "assistant", usage: { input: 10, output: 2, cost: { total: 0.1 } } } },
        { type: "message", message: { role: "toolResult", usage: { input: 3, output: 1, cost: { total: 0.02 } } } },
        { type: "compaction", usage: { input: 4, output: 2, cost: { total: 0.03 } } },
        { type: "branch_summary", usage: { input: 5, output: 1, cost: { total: 0.04 } } },
      ],
    },
  });

  const usage = summarizeUsage(ctx);
  assert.deepEqual({ input: usage.input, output: usage.output }, { input: 22, output: 6 });
  assert.ok(Math.abs(usage.cost - 0.19) < Number.EPSILON);
});

test("density settings persist with a balanced fallback", () => {
  const directory = mkdtempSync(join(tmpdir(), "minimal-statusline-"));
  const path = join(directory, "settings.json");
  try {
    assert.deepEqual(loadSettings(path), { density: "balanced" });
    saveSettings({ density: "minimal" }, path);
    assert.deepEqual(loadSettings(path), { density: "minimal" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("codemode reflects the actual loadout, including only mode", () => {
  let active: string[] = [];
  const pi = { getActiveTools: () => active, getSettings: () => ({ codemode: { mode: "only" as const } }) };
  assert.equal(getCodemodeState(pi), "off");
  active = ["codemode"];
  assert.equal(getCodemodeState(pi), "only");
  assert.equal(getCodemodeState({ ...pi, getSettings: () => ({}) }), "on");

  for (const density of ["minimal", "balanced"] as const) {
    const snapshot = { project: "project", runtimes: [], thinkingLevel: "high", usage: { input: 0, output: 0, cost: 0 }, codemode: "on" as const };
    assert.match(renderStatusline(theme, context(), snapshot, null, density, 200), / project.*codemode⚡/);
    for (let width = 1; width <= 100; width++) {
      assert.ok(visibleWidth(renderStatusline(theme, context(), snapshot, null, density, width)) <= width);
    }
  }
});

test("thinking updates redraw and codemode changes appear on the next render", async () => {
  const handlers = new Map<string, Function[]>();
  let footerFactory: ((...args: unknown[]) => { render(width: number): string[] }) | undefined;
  let active: string[] = [];
  const pi = {
    on(name: string, handler: Function) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    registerCommand() {},
    getThinkingLevel: () => "medium",
    getActiveTools: () => active,
    getSettings: () => ({}),
  };
  minimalStatusline(pi as never);

  const ctx = context({
    ui: {
      setFooter(factory: typeof footerFactory) { footerFactory = factory; },
    },
  });
  await handlers.get("session_start")?.[0]({}, ctx);
  assert.ok(footerFactory);

  let renders = 0;
  const footer = footerFactory!({ requestRender() { renders += 1; } }, theme, {
    getGitBranch: () => "main",
    onBranchChange: () => () => undefined,
  });
  await handlers.get("thinking_level_select")?.[0]({ level: "max" }, ctx);

  assert.equal(renders, 1);
  assert.match(footer.render(200)[0]!, /◆ max.*codemode:off/);
  active = ["codemode"];
  assert.match(footer.render(200)[0]!, /codemode⚡/);
  active = [];
  assert.match(footer.render(200)[0]!, /codemode:off/);
});
