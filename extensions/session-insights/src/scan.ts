import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import readline from "node:readline";
import type { Aggregate, InsightsData, MetricRow, SessionRecord, UsageTotals } from "./types.js";

const emptyUsage = (): UsageTotals => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  tokens: 0,
  cost: 0,
});

const number = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function addUsage(target: UsageTotals, usage: any): void {
  if (!usage) return;
  target.input += number(usage.input ?? usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens);
  target.output += number(usage.output ?? usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens);
  target.cacheRead += number(usage.cacheRead ?? usage.cache_read ?? usage.cacheReadTokens);
  target.cacheWrite += number(usage.cacheWrite ?? usage.cache_write ?? usage.cacheWriteTokens);
  target.reasoning += number(usage.reasoning ?? usage.reasoningTokens ?? usage.reasoning_tokens);
  target.tokens += number(usage.totalTokens ?? usage.total_tokens ?? usage.tokens?.total ?? usage.tokens);
  target.cost += number(usage.cost?.total ?? usage.cost);
}

function modelName(provider: unknown, model: unknown): string | undefined {
  const p = typeof provider === "string" ? provider.trim() : "";
  const m = typeof model === "string" ? model.trim() : "";
  if (!p && !m) return undefined;
  return p && m ? `${p}/${m}` : p || m;
}

function sessionDateFromName(path: string): Date | undefined {
  const match = basename(path).match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/);
  if (!match) return undefined;
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

async function sessionFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  const output: string[] = [];
  const pending = [root];
  while (pending.length) {
    if (signal?.aborted) break;
    const directory = pending.pop()!;
    try {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) output.push(path);
      }
    } catch {
      // Missing or unreadable session directories are treated as empty.
    }
  }
  return output;
}

async function parseSession(path: string, signal?: AbortSignal): Promise<SessionRecord | undefined> {
  let startedAt = sessionDateFromName(path);
  let cwd: string | undefined;
  let currentModel: string | undefined;
  const record: SessionRecord = {
    startedAt: startedAt ?? new Date(0),
    userMessages: 0,
    assistantTurns: 0,
    toolCalls: 0,
    usage: emptyUsage(),
    models: new Map(),
    tools: new Map(),
  };

  const stream = createReadStream(path, { encoding: "utf8" });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (signal?.aborted) return undefined;
      let item: any;
      try {
        item = JSON.parse(line);
      } catch {
        continue;
      }

      if (item.type === "session") {
        cwd = typeof item.cwd === "string" ? item.cwd : cwd;
        if (!startedAt && typeof item.timestamp === "string") {
          const parsed = new Date(item.timestamp);
          if (Number.isFinite(parsed.getTime())) startedAt = parsed;
        }
        continue;
      }
      if (item.type === "model_change") {
        currentModel = modelName(item.provider, item.modelId ?? item.model) ?? currentModel;
        continue;
      }
      if (item.type !== "message") continue;

      const message = item.message ?? item;
      if (message.role === "user") record.userMessages += 1;
      if (message.role === "toolResult") {
        record.toolCalls += 1;
        const tool = typeof message.toolName === "string" ? message.toolName : "unknown";
        record.tools.set(tool, (record.tools.get(tool) ?? 0) + 1);
      }
      if (message.role !== "assistant") continue;

      record.assistantTurns += 1;
      const usage = message.usage ?? item.usage;
      addUsage(record.usage, usage);
      const model = modelName(message.provider ?? item.provider, message.model ?? message.modelId ?? item.model ?? item.modelId)
        ?? currentModel
        ?? "unknown";
      currentModel = model;
      const row = record.models.get(model) ?? { name: model, sessions: 0, turns: 0, calls: 0, tokens: 0, cost: 0 };
      row.turns += 1;
      row.tokens += number(usage?.totalTokens ?? usage?.total_tokens ?? usage?.tokens?.total);
      row.cost += number(usage?.cost?.total ?? usage?.cost);
      record.models.set(model, row);
    }
  } finally {
    lines.close();
    stream.destroy();
  }

  if (!startedAt) return undefined;
  record.startedAt = startedAt;
  record.cwd = cwd;
  for (const row of record.models.values()) row.sessions = 1;
  return record;
}

export async function scanSessions(
  root: string,
  signal?: AbortSignal,
  onProgress?: (parsed: number, total: number) => void,
): Promise<InsightsData> {
  const files = await sessionFiles(root, signal);
  const sessions: SessionRecord[] = [];
  for (let index = 0; index < files.length; index += 1) {
    if (signal?.aborted) break;
    const session = await parseSession(files[index], signal);
    if (session) sessions.push(session);
    onProgress?.(index + 1, files.length);
  }
  return { generatedAt: new Date(), sessions };
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addRow(map: Map<string, MetricRow>, name: string, update: Partial<MetricRow>): void {
  const row = map.get(name) ?? { name, sessions: 0, turns: 0, calls: 0, tokens: 0, cost: 0 };
  row.sessions += update.sessions ?? 0;
  row.turns += update.turns ?? 0;
  row.calls += update.calls ?? 0;
  row.tokens += update.tokens ?? 0;
  row.cost += update.cost ?? 0;
  map.set(name, row);
}

export function aggregate(data: InsightsData, days: number, now = new Date()): Aggregate {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  const selected = data.sessions.filter((session) => session.startedAt >= start);
  const models = new Map<string, MetricRow>();
  const projects = new Map<string, MetricRow>();
  const tools = new Map<string, MetricRow>();
  const usage = emptyUsage();
  let userMessages = 0;
  let assistantTurns = 0;
  let toolCalls = 0;

  const daily = new Map<string, { tokens: number; turns: number }>();
  for (let index = 0; index < days; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    daily.set(dayKey(date), { tokens: 0, turns: 0 });
  }

  for (const session of selected) {
    userMessages += session.userMessages;
    assistantTurns += session.assistantTurns;
    toolCalls += session.toolCalls;
    addUsage(usage, session.usage);
    const day = daily.get(dayKey(session.startedAt));
    if (day) {
      day.tokens += session.usage.tokens;
      day.turns += session.assistantTurns;
    }
    for (const row of session.models.values()) addRow(models, row.name, row);
    if (session.cwd) {
      addRow(projects, session.cwd, {
        sessions: 1,
        turns: session.assistantTurns,
        calls: session.toolCalls,
        tokens: session.usage.tokens,
        cost: session.usage.cost,
      });
    }
    for (const [tool, calls] of session.tools) addRow(tools, tool, { calls });
  }

  const sort = (rows: Map<string, MetricRow>, metric: keyof MetricRow) =>
    [...rows.values()].sort((a, b) => Number(b[metric]) - Number(a[metric]));

  return {
    days,
    sessions: selected.length,
    userMessages,
    assistantTurns,
    toolCalls,
    usage,
    models: sort(models, "tokens"),
    projects: sort(projects, "tokens"),
    tools: sort(tools, "calls"),
    dailyTokens: [...daily.values()].map((value) => value.tokens),
    dailyTurns: [...daily.values()].map((value) => value.turns),
  };
}
