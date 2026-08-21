import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertToLlm, serializeConversation, SessionManager } from "@earendil-works/pi-coding-agent";
import test from "node:test";
import extension, { __test } from "./src/index.ts";

test("registers only the focused query tool and directs discovery to simply-file-search", () => {
  const tools: Array<{ name: string; promptGuidelines?: string[] }> = [];
  extension({ registerTool: (tool: { name: string; promptGuidelines?: string[] }) => tools.push(tool) } as never);
  assert.deepEqual(tools.map((tool) => tool.name), ["session_query"]);
  assert.ok(tools[0]?.promptGuidelines?.some((line) => line.includes("simply_grep")));
  assert.ok(tools[0]?.promptGuidelines?.some((line) => line.includes("simply_find")));
});

test("accepts only JSONL files inside the sessions root", () => {
  assert.equal(__test.isSessionPath("/agent/sessions/project/a.jsonl", "/agent/sessions"), true);
  assert.equal(__test.isSessionPath("/agent/sessions/project/a.txt", "/agent/sessions"), false);
  assert.equal(__test.isSessionPath("/agent/other/a.jsonl", "/agent/sessions"), false);
  assert.equal(__test.isSessionPath("/agent/sessions-elsewhere/a.jsonl", "/agent/sessions"), false);
});

test("bounds large transcripts while retaining both ends", () => {
  const text = `start-${"a".repeat(200)}-middle-${"b".repeat(200)}-end`;
  const result = __test.boundTranscript(text, 100);
  assert.equal(result.truncated, true);
  assert.match(result.text, /^start-/);
  assert.match(result.text, /-end$/);
  assert.match(result.text, /content omitted/);
  assert.ok(result.text.length <= 100);
});

test("includes compaction summaries in a reconstructed session transcript", async () => {
  const directory = await mkdtemp(join(tmpdir(), "session-recall-"));
  try {
    const manager = SessionManager.create(directory, directory);
    manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "discarded context" }],
      timestamp: Date.now(),
    } as never);
    const retainedId = manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "retained context" }],
      timestamp: Date.now(),
    } as never);
    manager.appendCompaction("COMPACTION SUMMARY: chosen approach", retainedId, 42);

    const transcript = serializeConversation(convertToLlm(__test.sessionMessages(manager)));
    assert.match(transcript, /COMPACTION SUMMARY: chosen approach/);
    assert.match(transcript, /retained context/);
    assert.doesNotMatch(transcript, /discarded context/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("leaves a transcript within the budget intact", () => {
  const result = __test.boundTranscript("short", 100);
  assert.deepEqual(result, { text: "short", truncated: false });
});
