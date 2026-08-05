import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import tokenOptimizer, { offerRtkInstall } from "./src/index.ts";
import {
  codingPrompt,
  DEFAULT_STATE,
  isOptimizerState,
  outputPrompt,
} from "./src/modes.ts";
import { openOptimizerPopup, optimizerRows } from "./src/popup.ts";
import { rewriteRtkChain, splitChain } from "./src/rtk.ts";

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

test("rewrites supported RTK command chains and preserves quoted operators", () => {
  assert.equal(
    rewriteRtkChain('git status && npm test | grep "a|b"'),
    'rtk git status && rtk npm test | rtk grep "a|b"',
  );
  assert.equal(
    rewriteRtkChain("echo ok && git diff"),
    "echo ok && rtk git diff",
  );
  assert.equal(rewriteRtkChain("rtk git status"), "rtk git status");
});

test("leaves shell syntax it cannot safely parse untouched", () => {
  assert.equal(splitChain("git status & npm test"), undefined);
  assert.equal(rewriteRtkChain("git $(echo status)"), "git $(echo status)");
  assert.equal(rewriteRtkChain("git 'unterminated"), "git 'unterminated");
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
          confirm: async () => true,
          notify() {},
        },
      } as never,
    );
    assert.equal(installed, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.slice(0, 2), [cargo, ["install", "rtk-ai"]]);
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
    assert.match(injected.systemPrompt, /RTK MODE/);

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
