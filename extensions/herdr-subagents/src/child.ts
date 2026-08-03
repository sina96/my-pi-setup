import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ChildResult } from "./types.ts";

function assistantText(message: Record<string, unknown>): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part): part is { type: "text"; text: string } =>
      Boolean(
        part &&
        typeof part === "object" &&
        part.type === "text" &&
        typeof part.text === "string",
      ),
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function lastAssistant(
  ctx: ExtensionContext,
): Record<string, unknown> | undefined {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry.type !== "message") continue;
    const message = entry.message as unknown as Record<string, unknown>;
    if (message.role === "assistant") return message;
  }
  return undefined;
}

async function writeAtomic(path: string, value: ChildResult): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
}

export function registerChildReporter(
  pi: ExtensionAPI,
  resultPath: string,
): void {
  let reported = false;

  const report = async (ctx: ExtensionContext, fallbackError?: string) => {
    if (reported) return;
    reported = true;

    const assistant = lastAssistant(ctx);
    const stopReason =
      typeof assistant?.stopReason === "string"
        ? assistant.stopReason
        : undefined;
    const assistantError =
      typeof assistant?.errorMessage === "string"
        ? assistant.errorMessage
        : undefined;
    const failed =
      !assistant ||
      stopReason === "error" ||
      stopReason === "aborted" ||
      Boolean(fallbackError);
    const output = assistant ? assistantText(assistant) : "";
    const result: ChildResult = {
      version: 1,
      status: failed ? "failed" : "completed",
      output,
      error:
        fallbackError ??
        assistantError ??
        (!assistant
          ? "Subagent exited without an assistant response."
          : undefined),
      stopReason,
      sessionFile: ctx.sessionManager.getSessionFile(),
      provider:
        typeof assistant?.provider === "string"
          ? assistant.provider
          : ctx.model?.provider,
      model:
        typeof assistant?.model === "string" ? assistant.model : ctx.model?.id,
      thinking: pi.getThinkingLevel(),
      finishedAt: Date.now(),
    };

    try {
      await writeAtomic(resultPath, result);
    } catch (error) {
      console.error(
        `[herdr-subagents] Failed to write child result: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  pi.on("agent_settled", async (_event, ctx) => {
    await report(ctx);
    ctx.shutdown();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!reported)
      await report(ctx, "Subagent session shut down before its task settled.");
  });
}
