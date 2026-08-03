import assert from "node:assert/strict";
import test from "node:test";
import { __test as herdr } from "./src/herdr.ts";
import extension from "./src/index.ts";
import { __test as manager, resolveTrust } from "./src/manager.ts";

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

test("starts with subagent tools inactive", async () => {
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
  for (const handler of handlers.get("session_start") ?? [])
    await handler({ reason: "startup" }, ctx);
  assert.deepEqual(active, ["read"]);
  for (const handler of handlers.get("session_shutdown") ?? [])
    await handler({ reason: "quit" }, ctx);
});
