import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { __test as herdr } from "./src/herdr.ts";
import extension from "./src/index.ts";
import { __test as manager, resolveTrust } from "./src/manager.ts";
import { popupInputAction, renderSubagentsPopup } from "./src/popup.ts";
import type { SubagentRun } from "./src/types.ts";

test("parses Herdr tab creation responses", () => {
  assert.equal(
    herdr.rootPaneId(
      JSON.stringify({ result: { root_pane: { pane_id: "1-2" } } }),
    ),
    "1-2",
  );
});

test("finds labels across supported pane record shapes", () => {
  assert.equal(herdr.recordLabel({ pane_id: "1-2", label: "sa-1" }), "sa-1");
  assert.equal(herdr.recordLabel({ pane_id: "1-2", title: "sa-1" }), "sa-1");
  assert.deepEqual(
    herdr.paneRecords(
      JSON.stringify({ result: { panes: [{ pane_id: "1-2" }] } }),
    ),
    [{ pane_id: "1-2" }],
  );
});

test("shell quotes apostrophes", () => {
  assert.equal(manager.shellQuote("it's ready"), `'it'"'"'s ready'`);
});

test("child trust is limited to the trusted parent tree", () => {
  assert.equal(resolveTrust("/repo", "/repo/packages/app", true), true);
  assert.equal(resolveTrust("/repo", "/other", true), false);
  assert.equal(resolveTrust("/repo", "/repo/packages/app", false), false);
});

test("bounds delivered result text", () => {
  const short = "ok";
  assert.equal(manager.boundedOutput(short), short);
  assert.match(manager.boundedOutput("x".repeat(30_000)), /Result truncated/);
});

test("renders and navigates the subagent popup", () => {
  const run: SubagentRun = {
    id: "sa-1",
    token: "sa-1-token",
    name: "Review auth",
    task: "Review authentication",
    cwd: "/repo",
    paneId: "w1:p2",
    paneLabel: "sa-1",
    resultPath: "/tmp/result.json",
    exitCodePath: "/tmp/exit-code",
    sessionDir: "/tmp/session",
    provider: "openai-codex",
    model: "gpt-test",
    thinking: "medium",
    status: "running",
    startedAt: Date.now() - 5_000,
    consumed: false,
    delivered: false,
  };
  const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  const lines = renderSubagentsPopup([run], 0, true, 100, theme as never);
  assert.ok(lines.some((line) => line.includes("Review auth")));
  assert.ok(lines.some((line) => line.includes("openai-codex/gpt-test")));
  assert.ok(lines.every((line) => visibleWidth(line) <= 100));

  const keybindings = {
    matches: (input: string, id: string) =>
      input === "enter" && id === "tui.select.confirm",
  };
  assert.equal(
    popupInputAction("j", 0, 3, false, keybindings).selectedIndex,
    1,
  );
  assert.equal(
    popupInputAction("G", 0, 3, false, keybindings).selectedIndex,
    2,
  );
  assert.equal(
    popupInputAction("enter", 0, 3, false, keybindings).expanded,
    true,
  );
  assert.equal(
    popupInputAction("x", 0, 3, false, keybindings).action,
    "close-pane",
  );
});

test("does not register commands or tools outside Herdr", () => {
  const previous = {
    herdr: process.env.HERDR_ENV,
    pane: process.env.HERDR_PANE_ID,
  };
  delete process.env.HERDR_ENV;
  delete process.env.HERDR_PANE_ID;
  const commands: string[] = [];
  const tools: string[] = [];
  try {
    extension({
      registerCommand: (name: string) => commands.push(name),
      registerTool: (tool: { name: string }) => tools.push(tool.name),
    } as never);
    assert.deepEqual(commands, []);
    assert.deepEqual(tools, []);
  } finally {
    if (previous.herdr == null) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previous.herdr;
    if (previous.pane == null) delete process.env.HERDR_PANE_ID;
    else process.env.HERDR_PANE_ID = previous.pane;
  }
});

test("starts with subagent tools inactive", async () => {
  const previous = {
    herdr: process.env.HERDR_ENV,
    pane: process.env.HERDR_PANE_ID,
  };
  process.env.HERDR_ENV = "1";
  process.env.HERDR_PANE_ID = "w1:p1";
  const handlers = new Map<string, Function[]>();
  let active = [
    "read",
    "subagent_spawn",
    "subagent_check",
    "subagent_cancel",
    "subagent_wait",
    "subagent_list",
  ];
  const pi = {
    registerTool() {},
    registerCommand() {},
    registerMessageRenderer() {},
    getActiveTools: () => active,
    setActiveTools: (names: string[]) => {
      active = names;
    },
    on: (name: string, handler: Function) =>
      handlers.set(name, [...(handlers.get(name) ?? []), handler]),
  };
  extension(pi as never);
  const ctx = {
    hasUI: false,
    ui: { setStatus() {}, setWidget() {} },
    sessionManager: { getSessionId: () => "test-session" },
    isIdle: () => true,
  };
  try {
    for (const handler of handlers.get("session_start") ?? [])
      await handler({ reason: "startup" }, ctx);
    assert.deepEqual(active, ["read"]);
    for (const handler of handlers.get("session_shutdown") ?? [])
      await handler({ reason: "quit" }, ctx);
  } finally {
    if (previous.herdr == null) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previous.herdr;
    if (previous.pane == null) delete process.env.HERDR_PANE_ID;
    else process.env.HERDR_PANE_ID = previous.pane;
  }
});
