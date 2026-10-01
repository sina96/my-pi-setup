import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSessions, usageParts } from "./src/scan.ts";

test("includes nested-tool, summary, and cache-warming usage in session totals", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-session-insights-"));
  const directory = join(root, "project");
  mkdirSync(directory);
  const path = join(directory, "2026-10-01T12-00-00-000Z_test.jsonl");
  try {
    writeFileSync(path, [
      JSON.stringify({ type: "session", timestamp: "2026-10-01T12:00:00.000Z", cwd: "/work/project" }),
      JSON.stringify({ type: "message", message: { role: "assistant", usage: { input: 10, output: 2, totalTokens: 12, cost: { total: 0.1 } } } }),
      JSON.stringify({ type: "message", message: { role: "toolResult", toolName: "codemode", usage: { input: 3, output: 1, totalTokens: 4, cost: { total: 0.02 } }, nestedCalls: [{ name: "mcp__docs__search" }] } }),
      JSON.stringify({ type: "compaction", usage: { input: 2, output: 1, totalTokens: 3, cost: { total: 0.03 } } }),
      JSON.stringify({ type: "usage", kind: "cache_warm", usage: { cacheRead: 5, totalTokens: 5, cost: { total: 0.04 } } }),
    ].join("\n") + "\n");

    const data = await scanSessions(root);
    assert.equal(data.sessions.length, 1);
    const session = data.sessions[0]!;
    assert.equal(session.usage.tokens, 24);
    assert.ok(Math.abs(session.usage.cost - 0.19) < Number.EPSILON);
    assert.equal(session.toolCalls, 2);
    assert.equal(session.tools.get("mcp__docs__search"), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses only finite non-negative reported totals", () => {
  const components = { input: 2, output: 3, cacheRead: 5, cacheWrite: 7 };
  assert.equal(usageParts({ ...components, totalTokens: 19 }).tokens, 19);
  assert.equal(usageParts({ ...components, totalTokens: 0 }).tokens, 0);
  assert.equal(usageParts({ ...components, totalTokens: -1 }).tokens, 17);
  assert.equal(usageParts({ ...components, totalTokens: Number.NaN }).tokens, 17);
  assert.equal(usageParts({ ...components, totalTokens: Number.POSITIVE_INFINITY }).tokens, 17);
});
