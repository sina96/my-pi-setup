import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Check } from "typebox/value";
import { registerSessionRecall } from "../src/index.ts";

const usage = {
  input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12,
  cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 },
};

function harness(root: string) {
  let tool: any;
  registerSessionRecall({ registerTool(value: any) { tool = value; } } as never, root);
  return tool;
}

async function fixture(root: string, name: string) {
  const path = join(root, name);
  await writeFile(path, [
    { type: "session", version: 3, id: "test", timestamp: "2026-10-01T12:00:00.000Z", cwd: root },
    { type: "message", id: "message1", parentId: null, timestamp: "2026-10-01T12:00:01.000Z", message: { role: "user", content: "We chose SQLite.", timestamp: 1 } },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return path;
}

test("independent session queries return structured answers with their own usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-recall-batch-"));
  try {
    const tool = harness(root);
    const paths = await Promise.all([fixture(root, "a.jsonl"), fixture(root, "b.jsonl")]);
    const ctx = {
      model: { id: "mock", provider: "mock" },
      modelRegistry: { async complete() { return { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "SQLite" }], usage }; } },
    };
    const results = await Promise.all(paths.map((sessionPath) => tool.execute("query", { sessionPath, question: "Which database?" }, undefined, undefined, ctx)));
    assert.equal(tool.annotations.readOnlyHint, true);
    for (const [index, result] of results.entries()) {
      assert.ok(Check(tool.outputSchema, result.structuredContent));
      assert.equal(result.structuredContent.status, "ok");
      assert.equal(result.structuredContent.sessionPath, paths[index]);
      assert.equal(result.structuredContent.answer, "SQLite");
      assert.deepEqual(result.usage, usage);
      assert.equal(result.isError, false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failure and cancellation carry structured status and reported model usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-recall-errors-"));
  try {
    const tool = harness(root);
    const sessionPath = await fixture(root, "a.jsonl");
    for (const stopReason of ["error", "aborted"]) {
      const result = await tool.execute("query", { sessionPath, question: "What happened?" }, undefined, undefined, {
        model: {}, modelRegistry: { async complete() { return { stopReason, content: [], usage, errorMessage: "Failed" }; } },
      });
      assert.ok(Check(tool.outputSchema, result.structuredContent));
      assert.equal(result.isError, true);
      assert.equal(result.structuredContent.status, stopReason === "aborted" ? "cancelled" : "error");
      assert.deepEqual(result.usage, usage);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("session symlinks cannot escape the allowed root and aborted calls avoid model work", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-recall-path-"));
  const outside = await mkdtemp(join(tmpdir(), "pi-recall-outside-"));
  try {
    const target = await fixture(outside, "outside.jsonl");
    const link = join(root, "link.jsonl");
    await symlink(target, link);
    const tool = harness(root);
    const ctx = { model: {}, modelRegistry: { complete() { throw new Error("Should not be called"); } } };
    const blocked = await tool.execute("query", { sessionPath: link, question: "?" }, undefined, undefined, ctx);
    assert.equal(blocked.structuredContent.error, "invalid-session-path");
    assert.equal(blocked.isError, true);
    const cancelled = await tool.execute("query", { sessionPath: link, question: "?" }, AbortSignal.abort(), undefined, ctx);
    assert.equal(cancelled.structuredContent.status, "cancelled");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
