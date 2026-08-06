import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { ContextInsight, ContextMetric } from "./types.js";

type AnyRecord = Record<string, any>;

const estimateTokens = (value: unknown): number => {
  if (value == null) return 0;
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return Math.max(0, Math.ceil(text.length / 4));
  } catch {
    return 0;
  }
};

function textTokens(content: unknown, includeThinking = true): number {
  if (typeof content === "string") return estimateTokens(content);
  if (!Array.isArray(content)) return 0;
  return content.reduce((total, block: AnyRecord) => {
    if (block?.type === "text") return total + estimateTokens(block.text);
    if (includeThinking && block?.type === "thinking") return total + estimateTokens(block.thinking);
    return total;
  }, 0);
}

function distribute(raw: number[], target: number): number[] {
  const rawTotal = raw.reduce((sum, value) => sum + value, 0);
  if (target <= 0 || rawTotal <= 0) return raw.map(() => 0);

  const exact = raw.map((value) => (value / rawTotal) * target);
  const output = exact.map(Math.floor);
  let remainder = target - output.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);
  for (let index = 0; index < order.length && remainder > 0; index += 1, remainder -= 1) {
    output[order[index].index] += 1;
  }
  return output;
}

export function buildContextInsight(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): ContextInsight {
  const usage = ctx.getContextUsage();
  const activeNames = new Set(pi.getActiveTools());
  const tools = pi.getAllTools().filter((tool) => activeNames.has(tool.name));
  const toolDefinitions = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    promptGuidelines: tool.promptGuidelines,
  }));

  let messagesRaw = 0;
  let toolActivityRaw = 0;
  let messageEntries = 0;
  const roleRaw = new Map<string, number>();
  const addRole = (role: string, tokens: number) => {
    if (tokens <= 0) return;
    roleRaw.set(role, (roleRaw.get(role) ?? 0) + tokens);
  };

  const accountMessage = (message: AnyRecord) => {
    messageEntries += 1;
    if (message.role === "toolResult") {
      toolActivityRaw += estimateTokens(message.toolName) + textTokens(message.content, false);
      return;
    }
    if (message.role === "bashExecution") {
      toolActivityRaw += estimateTokens(message.command) + estimateTokens(message.output);
      return;
    }

    const messageTokens = textTokens(message.content);
    messagesRaw += messageTokens;
    addRole(message.role === "custom" ? "extension" : (message.role ?? "message"), messageTokens);
    if (Array.isArray(message.content)) {
      for (const block of message.content as AnyRecord[]) {
        if (block?.type === "toolCall") toolActivityRaw += estimateTokens(block);
      }
    }
  };

  for (const entry of ctx.sessionManager.buildContextEntries()) {
    const item = entry as AnyRecord;
    if (item.type === "compaction" || item.type === "branch_summary") {
      const tokens = estimateTokens(item.summary);
      messagesRaw += tokens;
      addRole(item.type === "compaction" ? "summary" : "branch summary", tokens);
      messageEntries += 1;
      if (item.type === "compaction" && Array.isArray(item.retainedTail)) {
        for (const message of item.retainedTail) accountMessage(message);
      }
    } else if (item.type === "custom_message") {
      accountMessage({ role: "custom", content: item.content });
    } else if (item.type === "message") {
      accountMessage(item.message);
    }
  }

  const raw = [
    estimateTokens(ctx.getSystemPrompt()),
    estimateTokens(toolDefinitions),
    toolActivityRaw,
    messagesRaw,
  ];
  const rawTotal = raw.reduce((sum, value) => sum + value, 0);
  const limit = usage?.contextWindow ?? ctx.model?.contextWindow ?? 128_000;
  const measured = usage?.tokens != null;
  const total = Math.max(0, Math.min(limit, measured ? (usage?.tokens ?? rawTotal) : rawTotal));
  const calibrated = distribute(raw, total);
  const names = ["System Prompt", "System Tools", "Tool Activity", "Messages"];
  const details = [
    undefined,
    `${tools.length} active`,
    undefined,
    `${messageEntries} entries`,
  ];
  const categories: ContextMetric[] = calibrated.map((tokens, index) => ({
    name: names[index],
    tokens,
    detail: details[index],
  }));

  const messageTarget = categories[3].tokens;
  const roleEntries = [...roleRaw.entries()];
  const calibratedRoles = distribute(
    roleEntries.map(([, tokens]) => tokens),
    messageTarget,
  );

  return {
    model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown model",
    limit,
    total,
    free: Math.max(0, limit - total),
    measured,
    categories,
    roles: roleEntries
      .map(([name], index) => ({ name, tokens: calibratedRoles[index] }))
      .filter((row) => row.tokens > 0)
      .sort((left, right) => right.tokens - left.tokens),
  };
}
