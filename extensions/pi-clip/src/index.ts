// Inspired by and substantially simplified from bigboss2063/pi-clip.
// Local changes: built-in dialogs, no shortcut, whole-table copies, prompt copy, and guarded conversation copy.
import {
  copyToClipboard,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

type BlockKind = "code" | "table" | "list" | "quote";

interface Block {
  kind: BlockKind;
  content: string;
  language?: string;
}

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string"))
    .map((part) => part.text)
    .join("\n");
}

function latestText(entries: SessionEntry[], role: "assistant" | "user"): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "message" || entry.message.role !== role) continue;
    if (role === "assistant" && entry.message.stopReason === "aborted" && entry.message.content.length === 0) continue;
    const text = textContent(entry.message.content).trim();
    if (text) return text;
  }
  return undefined;
}

function conversation(entries: SessionEntry[]): string {
  const sections: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) continue;
    const text = textContent(entry.message.content).trim();
    if (!text) continue;
    sections.push(`## ${entry.message.role === "user" ? "User" : "Assistant"}\n\n${text}`);
  }
  return sections.join("\n\n---\n\n");
}

function tableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function tableSeparator(line: string): boolean {
  const cells = tableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function listStart(line: string): boolean {
  return /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
}

function extractBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const length = fence[1].length;
      const closing = new RegExp(`^\\s*${marker === "`" ? "`" : "~"}{${length},}\\s*$`);
      const start = index + 1;
      let end = start;
      while (end < lines.length && !closing.test(lines[end])) end += 1;
      blocks.push({ kind: "code", content: lines.slice(start, end).join("\n"), language: fence[2].trim() || "text" });
      index = end < lines.length ? end + 1 : end;
      continue;
    }

    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      let end = index + 1;
      while (end < lines.length && lines[end].trim().startsWith("|") && lines[end].trim().endsWith("|")) end += 1;
      if (end - index >= 2 && tableSeparator(lines[index + 1] ?? "")) {
        blocks.push({ kind: "table", content: lines.slice(index, end).join("\n") });
        index = end;
        continue;
      }
    }

    if (listStart(line)) {
      const start = index;
      let end = index + 1;
      while (end < lines.length) {
        const current = lines[end];
        if (listStart(current) || /^\s+\S/.test(current)) {
          end += 1;
          continue;
        }
        if (!current.trim() && end + 1 < lines.length && (listStart(lines[end + 1]) || /^\s+\S/.test(lines[end + 1]))) {
          end += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: "list", content: lines.slice(start, end).join("\n").trimEnd() });
      index = end;
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const start = index;
      let end = index + 1;
      while (end < lines.length && /^\s{0,3}>/.test(lines[end])) end += 1;
      blocks.push({ kind: "quote", content: lines.slice(start, end).join("\n") });
      index = end;
      continue;
    }

    index += 1;
  }

  return blocks;
}

function preview(text: string, length = 58): string {
  const first = text.split("\n").find((line) => line.trim())?.trim() ?? "(empty)";
  return first.length > length ? `${first.slice(0, length - 1)}…` : first;
}

function blockLabel(block: Block, index: number): string {
  const detail = block.kind === "code" ? `:${block.language}` : "";
  return `${index + 1}. [${block.kind}${detail}] ${preview(block.content)}`;
}

async function copy(text: string, label: string, ctx: ExtensionContext): Promise<void> {
  try {
    await copyToClipboard(text);
    const lines = text.split("\n").length;
    ctx.ui.notify(`Copied ${label} · ${lines} line${lines === 1 ? "" : "s"} · ${text.length.toLocaleString()} chars`, "info");
  } catch (error) {
    ctx.ui.notify(`Clipboard copy failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  }
}

async function chooseBlock(blocks: Block[], title: string, ctx: ExtensionContext): Promise<Block | undefined> {
  if (blocks.length === 0) return undefined;
  if (blocks.length === 1) return blocks[0];
  if (ctx.mode !== "tui") {
    ctx.ui.notify(`${title} selection requires interactive mode; specify an item number`, "warning");
    return undefined;
  }
  const labels = blocks.map(blockLabel);
  const choice = await ctx.ui.select(title, labels);
  const index = choice ? labels.indexOf(choice) : -1;
  return index >= 0 ? blocks[index] : undefined;
}

function parseIndex(value: string, count: number): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const index = Number(value) - 1;
  return index >= 0 && index < count ? index : undefined;
}

function parseRange(value: string, total: number): { start: number; end: number } | { error: string } {
  const single = /^(\d+)$/.exec(value.trim());
  const pair = /^(\d+)\s*[-,]\s*(\d+)$/.exec(value.trim());
  if (!single && !pair) return { error: "Use a line number or inclusive range such as 4-9" };
  const first = Number(single?.[1] ?? pair![1]);
  const second = Number(single?.[1] ?? pair![2]);
  const start = Math.min(first, second);
  const end = Math.max(first, second);
  if (start < 1 || end > total) return { error: `Line range must be within 1-${total}` };
  return { start: start - 1, end: end - 1 };
}

export default function piClip(pi: ExtensionAPI) {
  pi.registerCommand("clip", {
    description: "Copy a precise part of the last response: code, table, list, quote, lines, prompt, or conversation",
    getArgumentCompletions: (prefix) => {
      const commands = ["code", "table", "list", "quote", "lines", "response", "prompt", "conversation"];
      const matches = commands.filter((command) => command.startsWith(prefix.toLowerCase()));
      return matches.length ? matches.map((command) => ({ value: command, label: command })) : null;
    },
    handler: async (args, ctx) => {
      const entries = ctx.sessionManager.getBranch();
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const command = tokens[0]?.toLowerCase() ?? "";

      if (command === "prompt") {
        const text = latestText(entries, "user");
        if (text) await copy(text, "last prompt", ctx);
        else ctx.ui.notify("No user prompt to copy", "warning");
        return;
      }
      if (command === "conversation" || command === "all") {
        const text = conversation(entries);
        if (!text) {
          ctx.ui.notify("No conversation to copy", "warning");
          return;
        }
        if (ctx.mode !== "tui") {
          ctx.ui.notify("Full-conversation copy requires interactive confirmation", "warning");
          return;
        }
        if (!await ctx.ui.confirm("Copy full conversation?", "This may include prompts, code, paths, or secrets from the entire session branch.")) return;
        await copy(text, "full conversation", ctx);
        return;
      }

      const response = latestText(entries, "assistant");
      if (!response) {
        ctx.ui.notify("No assistant response to copy", "warning");
        return;
      }
      if (command === "response" || command === "last") {
        await copy(response, "last response", ctx);
        return;
      }
      if (command === "lines") {
        const lines = response.split("\n");
        let rangeText = tokens.slice(1).join(" ");
        if (!rangeText && ctx.mode === "tui") {
          rangeText = await ctx.ui.input(`Copy lines · response has ${lines.length}`, "for example 4-9") ?? "";
        }
        if (!rangeText) {
          ctx.ui.notify("Usage: /clip lines N or /clip lines N-M", "warning");
          return;
        }
        const range = parseRange(rangeText, lines.length);
        if ("error" in range) {
          ctx.ui.notify(range.error, "warning");
          return;
        }
        await copy(lines.slice(range.start, range.end + 1).join("\n"), `lines ${range.start + 1}-${range.end + 1}`, ctx);
        return;
      }

      const blocks = extractBlocks(response);
      if (!command) {
        if (blocks.length === 0) {
          await copy(response, "last response", ctx);
          return;
        }
        const choices = [...blocks.map(blockLabel), `${blocks.length + 1}. [response] Full raw response`];
        if (ctx.mode !== "tui") {
          ctx.ui.notify("The block picker requires interactive mode; use /clip response or /clip <type> <number>", "warning");
          return;
        }
        const choice = await ctx.ui.select("Copy from last response", choices);
        const selected = choice ? choices.indexOf(choice) : -1;
        if (selected < 0) return;
        if (selected === blocks.length) await copy(response, "last response", ctx);
        else await copy(blocks[selected].content, `${blocks[selected].kind} block`, ctx);
        return;
      }

      const kind = command as BlockKind;
      if (!["code", "table", "list", "quote"].includes(kind)) {
        ctx.ui.notify("Usage: /clip [code|table|list|quote|lines|response|prompt|conversation] [number]", "warning");
        return;
      }
      const matching = blocks.filter((block) => block.kind === kind);
      if (matching.length === 0) {
        ctx.ui.notify(`No ${kind} blocks in the last response`, "warning");
        return;
      }
      let selected: Block | undefined;
      if (tokens[1]) {
        const index = parseIndex(tokens[1], matching.length);
        if (index === undefined) {
          ctx.ui.notify(`${kind} number must be within 1-${matching.length}`, "warning");
          return;
        }
        selected = matching[index];
      } else selected = await chooseBlock(matching, `Copy ${kind} block`, ctx);
      if (selected) await copy(selected.content, `${kind} block`, ctx);
    },
  });
}
