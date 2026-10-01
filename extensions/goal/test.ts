import assert from "node:assert/strict";
import test from "node:test";
import goalExtension from "./src/index.ts";

function harness() {
  const handlers = new Map<string, Function[]>();
  const commands = new Map<string, any>();
  const tools = new Map<string, any>();
  const entries: unknown[][] = [];
  const messages: unknown[][] = [];
  const pi = {
    on(name: string, handler: Function) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    appendEntry(...args: unknown[]) { entries.push(args); },
    sendMessage(...args: unknown[]) { messages.push(args); },
    events: { emit() {} },
  };
  const ctx = {
    hasUI: true,
    isIdle: () => true,
    hasPendingMessages: () => false,
    sessionManager: { getBranch: () => [] },
    ui: { setWidget() {}, notify() {}, theme: { fg: (_color: string, value: string) => value } },
  };
  goalExtension(pi as never);
  handlers.get("session_start")?.[0]({}, ctx);
  return { handlers, commands, tools, entries, messages, ctx };
}

async function startGoal(h: ReturnType<typeof harness>) {
  await h.commands.get("goal").handler("Implement the approved change", h.ctx);
  h.messages.length = 0;
  h.handlers.get("agent_start")?.[0]({}, h.ctx);
  h.handlers.get("agent_end")?.[0]({ messages: [{ role: "assistant", usage: { totalTokens: 4 } }] }, h.ctx);
}

test("workflow controls remain model-only under codemode", () => {
  const h = harness();
  assert.equal(h.tools.get("finish_goal").exposure, "model-only");
});

test("goal continues at agent_before_settle with a branch-local continuation", async () => {
  const h = harness();
  await startGoal(h);
  assert.equal(h.messages.length, 0, "agent_end does not queue a competing follow-up");

  const result = h.handlers.get("agent_before_settle")?.[0]({
    outcome: "completed",
    entries: [],
    context: { pendingMessages: [] },
  }, h.ctx);
  assert.equal(result.continue, true);
  const continuation = result.entries.at(-1);
  assert.equal(continuation.type, "custom_message");
  assert.equal(continuation.customType, "simply-goal-continuation");
  assert.equal(continuation.display, false);
  assert.match(continuation.details.goalId, /^[0-9a-f-]{36}$/);
  assert.match(continuation.content, /Continue making concrete progress/);
});

test("goal pauses on cancellation in agent_end before final settlement", async () => {
  const h = harness();
  await h.commands.get("goal").handler("Implement the approved change", h.ctx);
  h.handlers.get("agent_start")?.[0]({}, h.ctx);
  h.handlers.get("agent_end")?.[0]({
    messages: [{ role: "assistant", stopReason: "aborted", usage: { totalTokens: 1 } }],
  }, h.ctx);

  const state = h.entries.filter(([type]) => type === "simply-goal-state").at(-1)?.[1] as any;
  assert.equal(state.goal.status, "paused");
  assert.equal(state.goal.pauseReason, "aborted");

  // Pi still emits the settle boundary after agent_end; it must not replace the cancellation reason.
  h.handlers.get("agent_before_settle")?.[0]({
    outcome: "aborted",
    entries: [],
    context: { pendingMessages: [] },
  }, h.ctx);
  const settledState = h.entries.filter(([type]) => type === "simply-goal-state").at(-1)?.[1] as any;
  assert.equal(settledState.goal.pauseReason, "aborted");
});

test("goal pauses after final errors and leaves queued user work alone", async () => {
  const h = harness();
  await startGoal(h);
  const errorResult = h.handlers.get("agent_before_settle")?.[0]({
    outcome: "error",
    entries: [],
    context: { pendingMessages: [] },
  }, h.ctx);
  assert.equal(errorResult, undefined);
  const state = h.entries.filter(([type]) => type === "simply-goal-state").at(-1)?.[1] as any;
  assert.equal(state.goal.status, "paused");
  assert.equal(state.goal.pauseReason, "error");

  const pending = harness();
  await startGoal(pending);
  const queued = pending.handlers.get("agent_before_settle")?.[0]({
    outcome: "completed",
    entries: [],
    context: { pendingMessages: [{ role: "user", content: "Follow-up" }] },
  }, pending.ctx);
  assert.equal(queued, undefined);
});
