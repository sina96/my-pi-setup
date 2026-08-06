import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import tokenOptimizer, {
  buildOptimizerInsights,
  offerRtkInstall,
} from "./src/index.ts";
import {
  codingPrompt,
  DEFAULT_STATE,
  isOptimizerState,
  optionGuidance,
  outputPrompt,
} from "./src/modes.ts";
import {
  insightRecommendation,
  openOptimizerPopup,
  optimizerRows,
} from "./src/popup.ts";
import { rewriteRtkCommand } from "./src/rtk.ts";

test("builds brief and safety-aware optimization prompts", () => {
  assert.equal(outputPrompt("off"), "");
  assert.equal(outputPrompt("brief"), "Be brief.");
  assert.match(outputPrompt("caveman-ultra"), /Maximum compression/);
  assert.match(outputPrompt("caveman-ultra"), /security warnings/);
  assert.match(codingPrompt("ponytail-full"), /standard library/);
  assert.match(codingPrompt("ponytail-full"), /data loss/);
});

test("validates persisted session state", () => {
  assert.equal(isOptimizerState(DEFAULT_STATE), true);
  assert.equal(
    isOptimizerState({ output: "tiny", coding: "off", rtk: false }),
    false,
  );
});

test("provides guidance for every optimizer option", () => {
  assert.match(optionGuidance("output", "brief").bestFor, /default/);
  assert.match(optionGuidance("coding", "ponytail-ultra").tradeoff, /push back/);
  assert.match(optionGuidance("rtk", true).summary, /supported shell commands/);
});

test("builds deterministic recommendations from current session activity", () => {
  const insights = buildOptimizerInsights(
    {
      getContextUsage: () => ({ tokens: 80, contextWindow: 100, percent: 80 }),
      sessionManager: {
        getBranch: () => [
          ...Array.from({ length: 5 }, () => ({
            type: "message",
            message: { role: "toolResult", toolName: "bash" },
          })),
          { type: "message", message: { role: "toolResult", toolName: "read" } },
        ],
      },
    } as never,
    true,
  );

  assert.deepEqual(insights, { contextPercent: 80, bashCalls: 5, rtkAvailable: true });
  assert.match(insightRecommendation(insights, DEFAULT_STATE), /enabling RTK/);
  assert.match(
    insightRecommendation(insights, { ...DEFAULT_STATE, rtk: true }),
    /RTK is enabled/,
  );
});

test("delegates rewrite decisions to the RTK binary", async () => {
  const calls: unknown[][] = [];
  const rewritten = await rewriteRtkCommand(
    {
      exec: async (...args: unknown[]) => {
        calls.push(args);
        return {
          code: 3,
          stdout: "rtk git status\n",
          stderr: "",
          killed: false,
        };
      },
    } as never,
    "/usr/local/bin/rtk",
    "git status",
  );

  assert.equal(rewritten, "rtk git status");
  assert.deepEqual(calls[0]?.slice(0, 2), [
    "/usr/local/bin/rtk",
    ["rewrite", "git status"],
  ]);
});

test("RTK rewriting fails open for unsupported commands and errors", async () => {
  const unchanged = await rewriteRtkCommand(
    {
      exec: async () => ({
        code: 1,
        stdout: "",
        stderr: "",
        killed: false,
      }),
    } as never,
    "rtk",
    "echo ok",
  );
  const failed = await rewriteRtkCommand(
    { exec: async () => { throw new Error("broken"); } } as never,
    "rtk",
    "git status",
  );

  assert.equal(unchanged, undefined);
  assert.equal(failed, undefined);
});

test("hides the RTK row when the binary is unavailable", () => {
  assert.deepEqual(
    optimizerRows(false).map((row) => row.key),
    ["output", "coding"],
  );
  assert.deepEqual(
    optimizerRows(true).map((row) => row.key),
    ["output", "coding", "rtk"],
  );
});

test("popup supports Vim and arrow-style cycling", async () => {
  const state = { ...DEFAULT_STATE };
  const changes: (typeof state)[] = [];
  const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  const ctx = {
    ui: {
      custom: async (factory: Function) => {
        let finished = false;
        const component = factory(
          { requestRender() {}, terminal: { rows: 24 } },
          theme,
          { matches: () => false },
          () => {
            finished = true;
          },
        );
        assert.match(component.render(80).join("\n"), /Token Optimizer/);
        component.handleInput("l");
        component.handleInput("j");
        component.handleInput("\u001b[C");
        component.handleInput("q");
        assert.equal(finished, true);
      },
    },
  };

  await openOptimizerPopup(ctx as never, state, false, (next) => {
    changes.push({ ...next });
  });
  assert.equal(changes[0]?.output, "brief");
  assert.equal(changes[1]?.coding, "ponytail-lite");
});

test("popup toggles a full comparison view with question mark", async () => {
  const ctx = {
    ui: {
      custom: async (factory: Function) => {
        let rendered = "";
        const component = factory(
          { requestRender() {} },
          {
            fg: (_color: string, text: string) => text,
            bg: (_color: string, text: string) => text,
            bold: (text: string) => text,
          },
          { matches: () => false },
          () => {},
        );
        assert.match(component.render(80).join("\n"), /Session insight/);
        component.handleInput("?");
        rendered = component.render(80).join("\n");
        assert.match(rendered, /comparison/);
        assert.match(rendered, /ponytail-ultra/);
        component.handleInput("?");
        assert.doesNotMatch(component.render(80).join("\n"), /comparison/);
      },
    },
  };

  await openOptimizerPopup(
    ctx as never,
    { ...DEFAULT_STATE },
    false,
    () => {},
    { contextPercent: 30, bashCalls: 0, rtkAvailable: false },
  );
});

test("popup exposes the RTK installer only when RTK is unavailable", async () => {
  const ctx = {
    ui: {
      custom: async (factory: Function) => {
        let outcome: string | undefined;
        const component = factory(
          { requestRender() {}, terminal: { rows: 24 } },
          {
            fg: (_color: string, text: string) => text,
            bg: (_color: string, text: string) => text,
            bold: (text: string) => text,
          },
          { matches: () => false },
          (value: string) => {
            outcome = value;
          },
        );
        assert.match(component.render(80).join("\n"), /i install RTK/);
        component.handleInput("i");
        return outcome;
      },
    },
  };

  const outcome = await openOptimizerPopup(
    ctx as never,
    { ...DEFAULT_STATE },
    false,
    () => {},
  );
  assert.equal(outcome, "install-rtk");
});

test("offers an explicit confirmation before installing RTK", async () => {
  const directory = mkdtempSync(join(tmpdir(), "token-optimizer-install-"));
  const cargo = join(directory, "cargo");
  const rtk = join(directory, "rtk");
  writeFileSync(cargo, "#!/bin/sh\nexit 0\n");
  chmodSync(cargo, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = directory;
  const calls: unknown[][] = [];

  try {
    const installed = await offerRtkInstall(
      {
        exec: async (...args: unknown[]) => {
          calls.push(args);
          writeFileSync(rtk, "#!/bin/sh\nexit 0\n");
          chmodSync(rtk, 0o755);
          return { code: 0, stdout: "", stderr: "", killed: false };
        },
      } as never,
      {
        ui: {
          select: async (_title: string, options: string[]) => options[0],
          confirm: async () => true,
          notify() {},
        },
      } as never,
    );
    assert.equal(installed, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.slice(0, 2), [
      cargo,
      [
        "install",
        "--git",
        "https://github.com/rtk-ai/rtk",
        "--branch",
        "master",
        "rtk",
      ],
    ]);
  } finally {
    if (oldPath == null) delete process.env.PATH;
    else process.env.PATH = oldPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("offers Homebrew and Cargo and installs with the selected manager", async () => {
  const directory = mkdtempSync(join(tmpdir(), "token-optimizer-brew-install-"));
  const brew = join(directory, "brew");
  const cargo = join(directory, "cargo");
  const rtk = join(directory, "rtk");
  writeFileSync(brew, "#!/bin/sh\nexit 0\n");
  writeFileSync(cargo, "#!/bin/sh\nexit 0\n");
  chmodSync(brew, 0o755);
  chmodSync(cargo, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = directory;
  const calls: unknown[][] = [];
  let choices: string[] = [];

  try {
    const installed = await offerRtkInstall(
      {
        exec: async (...args: unknown[]) => {
          calls.push(args);
          writeFileSync(rtk, "#!/bin/sh\nexit 0\n");
          chmodSync(rtk, 0o755);
          return { code: 0, stdout: "", stderr: "", killed: false };
        },
      } as never,
      {
        ui: {
          select: async (_title: string, options: string[]) => {
            choices = options;
            return options.find((option) => option.startsWith("Homebrew"));
          },
          confirm: async () => true,
          notify() {},
        },
      } as never,
    );
    assert.equal(installed, true);
    assert.deepEqual(choices, [
      "Homebrew (recommended) — brew install rtk-ai/tap/rtk",
      "Cargo — install from the official rtk-ai/rtk repository",
    ]);
    assert.deepEqual(calls[0]?.slice(0, 2), [
      brew,
      ["install", "rtk-ai/tap/rtk"],
    ]);
  } finally {
    if (oldPath == null) delete process.env.PATH;
    else process.env.PATH = oldPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("does not install RTK when confirmation is declined", async () => {
  const directory = mkdtempSync(join(tmpdir(), "token-optimizer-decline-"));
  const cargo = join(directory, "cargo");
  writeFileSync(cargo, "#!/bin/sh\nexit 0\n");
  chmodSync(cargo, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = directory;
  let executed = false;

  try {
    const installed = await offerRtkInstall(
      {
        exec: async () => {
          executed = true;
          throw new Error("should not execute");
        },
      } as never,
      {
        ui: {
          select: async (_title: string, options: string[]) => options[0],
          confirm: async () => false,
          notify() {},
        },
      } as never,
    );
    assert.equal(installed, false);
    assert.equal(executed, false);
  } finally {
    if (oldPath == null) delete process.env.PATH;
    else process.env.PATH = oldPath;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("extension starts off, restores session state, and rewrites only with RTK", async () => {
  const directory = mkdtempSync(join(tmpdir(), "token-optimizer-"));
  const rtk = join(directory, "rtk");
  writeFileSync(rtk, "#!/bin/sh\nexit 0\n");
  chmodSync(rtk, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = directory;

  try {
    const handlers = new Map<string, Function[]>();
    const commands = new Map<string, { handler: Function }>();
    const statuses: unknown[] = [];
    tokenOptimizer({
      on(name: string, handler: Function) {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      },
      registerCommand(name: string, command: { handler: Function }) {
        commands.set(name, command);
      },
      appendEntry() {},
      exec: async (_command: string, args: string[]) => ({
        code: 0,
        stdout: args[0] === "rewrite" ? `rtk ${args[1]}\n` : "",
        stderr: "",
        killed: false,
      }),
    } as never);

    let entries: unknown[] = [];
    const ctx = {
      sessionManager: {
        getEntries: () => entries,
      },
      ui: {
        theme: { fg: (_color: string, text: string) => text },
        setStatus: (_key: string, value: unknown) => statuses.push(value),
        notify() {},
      },
    };
    await handlers.get("session_start")?.[0]?.({}, ctx);
    assert.equal(
      await handlers.get("before_agent_start")?.[0]?.({ systemPrompt: "base" }),
      undefined,
    );

    entries = [
      {
        type: "custom",
        customType: "token-optimizer-state",
        data: {
          output: "brief",
          coding: "ponytail-full",
          rtk: true,
        },
      },
    ];
    await handlers.get("session_start")?.[0]?.({}, ctx);
    const injected = await handlers.get("before_agent_start")?.[0]?.({
      systemPrompt: "base",
    });
    assert.match(injected.systemPrompt, /base\n\nBe brief\./);
    assert.match(injected.systemPrompt, /PONYTAIL CODING MODE/);
    assert.doesNotMatch(injected.systemPrompt, /RTK MODE/);

    const call = { toolName: "bash", input: { command: "git status" } };
    await handlers.get("tool_call")?.[0]?.(call, ctx);
    assert.equal(call.input.command, "rtk git status");
    assert.equal(commands.has("tokens"), true);
    assert.match(String(statuses.at(-1)), /brief.*ponytail-full.*rtk/);
  } finally {
    if (oldPath == null) delete process.env.PATH;
    else process.env.PATH = oldPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
