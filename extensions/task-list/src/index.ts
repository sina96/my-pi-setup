import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

export type TaskStatus = "pending" | "in_progress" | "completed";

export interface TaskItem {
  id: number;
  text: string;
  status: TaskStatus;
}

export interface TaskListDetails {
  version: 1;
  action: "set" | "add" | "update" | "list" | "clear";
  tasks: TaskItem[];
  nextId: number;
}

const TOOL_NAME = "task_list";
const STATE_TYPE = "simply-task-list-state";
const WIDGET_KEY = "simply-task-list";
const MAX_TASKS = 30;
const MAX_TEXT_LENGTH = 200;
const MAX_WIDGET_TASKS = 8;
export const COMPLETED_HIDE_DELAY_MS = 60_000;

const TaskListSchema = Type.Object({
  action: StringEnum(["set", "add", "update", "list", "clear"] as const, {
    description: "Operation to perform",
  }),
  tasks: Type.Optional(Type.Array(Type.String({ maxLength: MAX_TEXT_LENGTH }), {
    minItems: 1,
    maxItems: MAX_TASKS,
    description: "Complete ordered task list for set",
  })),
  text: Type.Optional(Type.String({
    maxLength: MAX_TEXT_LENGTH,
    description: "Task text for add, or replacement text for update",
  })),
  id: Type.Optional(Type.Integer({ minimum: 1, description: "Task id for update" })),
  status: Type.Optional(StringEnum(["pending", "in_progress", "completed"] as const, {
    description: "New task status for update",
  })),
});

type TaskListInput = Static<typeof TaskListSchema>;

function cleanText(value: string): string {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) throw new Error("Task text cannot be empty");
  if ([...text].length > MAX_TEXT_LENGTH) {
    throw new Error(`Task text cannot exceed ${MAX_TEXT_LENGTH} characters`);
  }
  return text;
}

function cloneTasks(tasks: readonly TaskItem[]): TaskItem[] {
  return tasks.map((task) => ({ ...task }));
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return value === "pending" || value === "in_progress" || value === "completed";
}

export function restoreTaskState(ctx: Pick<ExtensionContext, "sessionManager">): {
  tasks: TaskItem[];
  nextId: number;
} {
  let tasks: TaskItem[] = [];
  let nextId = 1;

  for (const entry of ctx.sessionManager.getBranch()) {
    let details: Partial<TaskListDetails> | undefined;
    if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === TOOL_NAME) {
      details = entry.message.details as Partial<TaskListDetails> | undefined;
    } else if (entry.type === "custom" && entry.customType === STATE_TYPE) {
      details = entry.data as Partial<TaskListDetails> | undefined;
    } else {
      continue;
    }
    if (!details || !Array.isArray(details.tasks) || !Number.isInteger(details.nextId) || details.nextId! < 1) continue;

    const restored: TaskItem[] = [];
    let valid = true;
    for (const candidate of details.tasks) {
      if (
        !candidate ||
        !Number.isInteger(candidate.id) ||
        candidate.id < 1 ||
        typeof candidate.text !== "string" ||
        !candidate.text.trim() ||
        !isTaskStatus(candidate.status)
      ) {
        valid = false;
        break;
      }
      restored.push({ id: candidate.id, text: candidate.text, status: candidate.status });
    }
    if (valid) {
      tasks = restored;
      nextId = details.nextId!;
    }
  }

  return { tasks, nextId };
}

function glyph(status: TaskStatus): string {
  if (status === "completed") return "✓";
  if (status === "in_progress") return "●";
  return "○";
}

function plainList(tasks: readonly TaskItem[]): string {
  if (tasks.length === 0) return "No tasks.";
  const done = tasks.filter((task) => task.status === "completed").length;
  return [
    `Tasks (${done}/${tasks.length} completed)`,
    ...tasks.map((task) => `${glyph(task.status)} #${task.id} [${task.status}] ${task.text}`),
  ].join("\n");
}

function themedTask(theme: Theme, task: TaskItem): string {
  const marker = task.status === "completed"
    ? theme.fg("success", "✓")
    : task.status === "in_progress"
      ? theme.fg("accent", "●")
      : theme.fg("dim", "○");
  const id = theme.fg("dim", `#${task.id}`);
  let text = task.status === "in_progress"
    ? theme.fg("accent", task.text)
    : task.status === "completed"
      ? theme.fg("muted", task.text)
      : theme.fg("text", task.text);
  if (task.status === "completed") text = theme.strikethrough(text);
  return `${marker} ${id} ${text}`;
}

export function widgetLines(theme: Theme, tasks: readonly TaskItem[], width: number): string[] {
  if (tasks.length === 0 || width < 1) return [];
  const done = tasks.filter((task) => task.status === "completed").length;
  const activeIndex = tasks.findIndex((task) => task.status === "in_progress");
  const visibleIndexes = Array.from({ length: Math.min(tasks.length, MAX_WIDGET_TASKS) }, (_, index) => index);
  if (activeIndex >= MAX_WIDGET_TASKS && visibleIndexes.length > 0) {
    visibleIndexes[visibleIndexes.length - 1] = activeIndex;
  }
  visibleIndexes.sort((a, b) => a - b);

  const lines = [
    `${theme.fg(activeIndex >= 0 ? "accent" : "dim", activeIndex >= 0 ? "●" : "○")} ${theme.fg(activeIndex >= 0 ? "accent" : "muted", `Tasks (${done}/${tasks.length})`)}`,
    ...visibleIndexes.map((index) => `${theme.fg("dim", index === visibleIndexes.at(-1) && tasks.length <= MAX_WIDGET_TASKS ? "└─" : "├─")} ${themedTask(theme, tasks[index]!)}`),
  ];
  const hidden = tasks.length - visibleIndexes.length;
  if (hidden > 0) lines.push(`${theme.fg("dim", "└─")} ${theme.fg("dim", `+${hidden} more · /tasks shows all`)}`);
  lines.push("");
  return lines.map((line) => truncateToWidth(line, width, "…"));
}

export default function taskListExtension(pi: ExtensionAPI): void {
  let tasks: TaskItem[] = [];
  let nextId = 1;
  let widgetHidden = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  function snapshot(action: TaskListDetails["action"]): TaskListDetails {
    return { version: 1, action, tasks: cloneTasks(tasks), nextId };
  }

  function cancelHideTimer(): void {
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    hideTimer = undefined;
  }

  function revealWidget(): void {
    cancelHideTimer();
    widgetHidden = false;
  }

  function publish(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    if (tasks.length === 0 || widgetHidden) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      return;
    }
    ctx.ui.setWidget(
      WIDGET_KEY,
      (_tui, theme) => ({
        render: (width: number) => widgetLines(theme, tasks, width),
        invalidate() {},
      }),
      { placement: "aboveEditor" },
    );
    if (tasks.every((task) => task.status === "completed") && hideTimer === undefined) {
      hideTimer = setTimeout(() => {
        hideTimer = undefined;
        widgetHidden = true;
        if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
      }, COMPLETED_HIDE_DELAY_MS);
      (hideTimer as { unref?: () => void }).unref?.();
    }
  }

  function restore(ctx: ExtensionContext): void {
    const restored = restoreTaskState(ctx);
    tasks = restored.tasks;
    nextId = restored.nextId;
    revealWidget();
    publish(ctx);
  }

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("session_compact", (_event, ctx) => restore(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    cancelHideTimer();
    if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
  });

  pi.registerTool({
    name: TOOL_NAME,
    label: "Task List",
    description: "Create and maintain the visible task list for the current multi-step job. Actions: set (replace with an ordered string list), add (text), update (id plus status and/or text), list, clear.",
    promptSnippet: "Track multi-step work in a task list that is visible above the editor",
    promptGuidelines: [
      "Use task_list for non-trivial work with 3 or more concrete steps; call set before implementation so the user can see the plan.",
      "Keep task_list accurate as work proceeds: mark exactly one task in_progress before working on it, then mark it completed immediately after it is verified.",
      "Do not mark a task completed while its implementation or verification is incomplete; update the list when scope changes.",
      "Skip task_list for one-step fixes, quick answers, and purely conversational requests.",
    ],
    parameters: TaskListSchema,

    async execute(_toolCallId, params: TaskListInput, _signal, _onUpdate, ctx) {
      let message: string;
      switch (params.action) {
        case "set": {
          if (!params.tasks) throw new Error("tasks is required for set");
          const values = params.tasks.map(cleanText);
          tasks = values.map((text, index) => ({ id: index + 1, text, status: "pending" }));
          nextId = tasks.length + 1;
          message = `Set ${tasks.length} tasks.`;
          break;
        }
        case "add": {
          if (params.text === undefined) throw new Error("text is required for add");
          if (tasks.length >= MAX_TASKS) throw new Error(`Task list is limited to ${MAX_TASKS} tasks`);
          const task: TaskItem = { id: nextId++, text: cleanText(params.text), status: "pending" };
          tasks = [...tasks, task];
          message = `Added #${task.id}: ${task.text}`;
          break;
        }
        case "update": {
          if (params.id === undefined) throw new Error("id is required for update");
          if (params.status === undefined && params.text === undefined) {
            throw new Error("update requires status and/or text");
          }
          const index = tasks.findIndex((task) => task.id === params.id);
          if (index < 0) throw new Error(`Task #${params.id} not found`);
          const moved: number[] = [];
          const updated = cloneTasks(tasks);
          if (params.status === "in_progress") {
            for (const task of updated) {
              if (task.id !== params.id && task.status === "in_progress") {
                task.status = "pending";
                moved.push(task.id);
              }
            }
          }
          updated[index] = {
            ...updated[index]!,
            ...(params.text !== undefined ? { text: cleanText(params.text) } : {}),
            ...(params.status !== undefined ? { status: params.status } : {}),
          };
          tasks = updated;
          message = `Updated #${params.id}${moved.length ? `; moved #${moved.join(", #")} back to pending` : ""}.`;
          break;
        }
        case "list":
          message = plainList(tasks);
          break;
        case "clear": {
          const count = tasks.length;
          tasks = [];
          nextId = 1;
          message = `Cleared ${count} tasks.`;
          break;
        }
      }

      if (params.action !== "list") revealWidget();
      publish(ctx);
      const details = snapshot(params.action);
      return {
        content: [{ type: "text" as const, text: params.action === "list" ? message : `${message}\n${plainList(tasks)}` }],
        details,
      };
    },
  });

  pi.registerCommand("tasks", {
    description: "Show the current visible task list, or clear it with /tasks clear",
    getArgumentCompletions: (prefix) => "clear".startsWith(prefix.trim())
      ? [{ value: "clear", label: "clear", description: "Clear the task list" }]
      : null,
    handler: async (args, ctx) => {
      if (args.trim().toLowerCase() === "clear") {
        if (tasks.length === 0) {
          ctx.ui.notify("No tasks to clear", "info");
          return;
        }
        if (ctx.hasUI && !await ctx.ui.confirm("Clear task list?", `${tasks.length} tasks will be removed.`)) return;
        tasks = [];
        nextId = 1;
        revealWidget();
        pi.appendEntry(STATE_TYPE, snapshot("clear"));
        publish(ctx);
        ctx.ui.notify("Task list cleared", "info");
        return;
      }
      ctx.ui.notify(plainList(tasks), "info");
      revealWidget();
      publish(ctx);
    },
  });
}
