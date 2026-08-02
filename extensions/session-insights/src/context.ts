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

function messageText(message: AnyRecord): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content.map((block: AnyRecord) => {
    if (block?.type === "text") return block.text ?? "";
    if (block?.type === "thinking") return block.thinking ?? "";
    if (block?.type === "toolCall") return `${block.name ?? "tool"} ${JSON.stringify(block.arguments ?? {})}`;
    if (block?.type === "image") return "[image]";
    return "";
  }).join("\n");
}

function subtractKnown(source: string, known: string[]): number {
  let remaining = source;
  for (const part of known.filter(Boolean).sort((a, b) => b.length - a.length)) {
    remaining = remaining.replace(part, "");
  }
  return estimateTokens(remaining);
}

export function buildContextInsight(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): ContextInsight {
  const options = ctx.getSystemPromptOptions() as AnyRecord;
  const usage = ctx.getContextUsage();
  const contextFiles = Array.isArray(options.contextFiles) ? options.contextFiles : [];
  const skills = Array.isArray(options.skills) ? options.skills : [];
  const contextParts = contextFiles.map((file: AnyRecord) => String(file.content ?? file.text ?? ""));
  const skillParts = skills.map((skill: AnyRecord) => String(skill.content ?? skill.description ?? ""));
  const systemPrompt = ctx.getSystemPrompt();

  const activeNames = new Set(pi.getActiveTools());
  const tools = pi.getAllTools().filter((tool) => activeNames.has(tool.name));
  const toolTokens = tools.reduce(
    (total, tool) => total + estimateTokens([
      tool.name,
      tool.description,
      ...(tool.promptGuidelines ?? []),
    ].join("\n")),
    0,
  );

  const roleTokens = new Map<string, number>();
  let conversationTokens = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const message = entry.message as AnyRecord;
    const role = typeof message.role === "string" ? message.role : "message";
    const tokens = estimateTokens(
      role === "toolResult"
        ? `${message.toolName ?? "tool"}\n${messageText(message)}`
        : messageText(message),
    );
    conversationTokens += tokens;
    roleTokens.set(role, (roleTokens.get(role) ?? 0) + tokens);
  }

  const systemTokens = subtractKnown(systemPrompt, [...contextParts, ...skillParts]);
  const memoryTokens = contextParts.reduce((total, part) => total + estimateTokens(part), 0);
  const skillTokens = skillParts.reduce((total, part) => total + estimateTokens(part), 0);
  const knownTotal = systemTokens + toolTokens + memoryTokens + skillTokens + conversationTokens;
  const limit = usage?.contextWindow ?? ctx.model?.contextWindow ?? 128_000;
  const total = Math.max(usage?.tokens ?? 0, knownTotal);
  const providerOther = Math.max(0, total - knownTotal);

  const categories: ContextMetric[] = [
    { name: "System prompt", tokens: systemTokens },
    { name: "Active tools", tokens: toolTokens, detail: `${tools.length} tools` },
    { name: "Context files", tokens: memoryTokens, detail: `${contextFiles.length} files` },
    { name: "Skills", tokens: skillTokens, detail: `${skills.length} loaded` },
    { name: "Conversation", tokens: conversationTokens, detail: `${ctx.sessionManager.getBranch().filter((entry) => entry.type === "message").length} entries` },
  ];
  if (providerOther > 0) categories.push({ name: "Provider / other", tokens: providerOther });

  return {
    model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown model",
    limit,
    total,
    free: Math.max(0, limit - total),
    measured: usage?.tokens != null,
    categories,
    roles: [...roleTokens.entries()]
      .map(([name, tokens]) => ({ name, tokens }))
      .sort((left, right) => right.tokens - left.tokens),
  };
}
