import assert from "node:assert/strict";
import test from "node:test";
import taskListExtension, {
  COMPLETED_HIDE_DELAY_MS,
  restoreTaskState,
  type TaskStatus,
  widgetLines,
} from "./src/index.ts";

function harness(branch: unknown[] = []) {
  const handlers = new Map<string, Function[]>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const widgets: unknown[][] = [];
  const entries: unknown[][] = [];
  const notifications: unknown[][] = [];

  const pi = {
    on(name: string, handler: Function) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    appendEntry(...args: unknown[]) { entries.push(args); },
  };
  taskListExtension(pi as never);

  const ctx = {
    hasUI: true,
    sessionManager: { getBranch: () => branch },
    ui: {
      setWidget(...args: unknown[]) { widgets.push(args); },
      notify(...args: unknown[]) { notifications.push(args); },
      async confirm() { return true; },
    },
  };
  return { handlers, tools, commands, widgets, entries, notifications, ctx };
}

async function execute(h: ReturnType<typeof harness>, params: Record<string, unknown>) {
  return h.tools.get("task_list").execute("call", params, undefined, undefined, h.ctx);
}

test("set, update, and list maintain one active task", async () => {
  const h = harness();
  await execute(h, { action: "set", tasks: ["Inspect", "Implement", "Test"] });
  await execute(h, { action: "update", id: 1, status: "in_progress" });
  const result = await execute(h, { action: "update", id: 2, status: "in_progress" });
  assert.deepEqual(result.details.tasks.map((task: any) => task.status), ["pending", "in_progress", "pending"]);
  assert.match(result.content[0].text, /moved #1 back to pending/);
  assert.equal(h.widgets.length >= 3, true);
});

test("restores the latest valid tool or command snapshot on the branch", () => {
  const state = restoreTaskState({
    sessionManager: {
      getBranch: () => [
        {
          type: "message",
          message: {
            role: "toolResult",
            toolName: "task_list",
            details: { version: 1, action: "set", tasks: [{ id: 1, text: "Old", status: "pending" }], nextId: 2 },
          },
        },
        {
          type: "custom",
          customType: "simply-task-list-state",
          data: { version: 1, action: "clear", tasks: [], nextId: 1 },
        },
      ],
    },
  } as never);
  assert.deepEqual(state, { tasks: [], nextId: 1 });
});

test("widget keeps an active task beyond the normal row budget visible", () => {
  const tasks = Array.from({ length: 10 }, (_, index) => ({
    id: index + 1,
    text: `Task ${index + 1}`,
    status: (index === 9 ? "in_progress" : "pending") as TaskStatus,
  }));
  const theme = {
    fg: (_color: string, text: string) => text,
    strikethrough: (text: string) => text,
  };
  const lines = widgetLines(theme as never, tasks, 80);
  assert.equal(lines.some((line) => line.includes("Task 10")), true);
  assert.equal(lines.some((line) => line.includes("+2 more")), true);
  assert.equal(lines.every((line) => line.length <= 80), true);
});

test("/tasks clear persists the empty state and removes the widget", async () => {
  const h = harness();
  await execute(h, { action: "set", tasks: ["One"] });
  await h.commands.get("tasks").handler("clear", h.ctx);
  assert.equal(h.entries[0]?.[0], "simply-task-list-state");
  assert.deepEqual((h.entries[0]?.[1] as any).tasks, []);
  assert.equal(h.widgets.at(-1)?.[1], undefined);
});

test("completed lists hide after one minute and /tasks reveals them", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  let scheduled: (() => void) | undefined;
  globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number) => {
    assert.equal(delay, COMPLETED_HIDE_DELAY_MS);
    scheduled = callback;
    return { unref() {} } as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;

  try {
    const h = harness();
    await execute(h, { action: "set", tasks: ["One"] });
    await execute(h, { action: "update", id: 1, status: "completed" });
    assert.ok(scheduled);

    scheduled();
    assert.equal(h.widgets.at(-1)?.[1], undefined);

    await h.commands.get("tasks").handler("", h.ctx);
    assert.equal(typeof h.widgets.at(-1)?.[1], "function");
    assert.match(String(h.notifications.at(-1)?.[0]), /1\/1 completed/);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});
