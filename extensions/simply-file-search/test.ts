import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { Check } from "typebox/value";
import { createCodemodeExtension } from "@earendil-works/pi-coding-agent";
import extension from "./src/index.ts";
import { formatSearchResult, parseRipgrep, SearchOutputSchema } from "./src/results.ts";

const event = (kind: "match" | "context", path: object, text: string, line = 4) => JSON.stringify({
  type: kind,
  data: { path, lines: { text }, line_number: line, submatches: kind === "match" ? [{ start: 2 }] : [] },
});

test("ripgrep JSON handles colons, Unicode, context, and byte-encoded paths", () => {
  const records = parseRipgrep([
    event("match", { text: "dir:12:34/é.ts" }, "  needle\n"),
    event("context", { bytes: Buffer.from("context:file.ts").toString("base64") }, "nearby\r\n", 3),
    JSON.stringify({ type: "summary", data: {} }),
  ].join("\n"));
  assert.deepEqual(records, [
    { kind: "match", path: "dir:12:34/é.ts", line: 4, column: 3, text: "  needle" },
    { kind: "context", path: "context:file.ts", line: 3, column: 0, text: "nearby" },
  ]);
});

test("search results have bounded structured arrays and honest result-limit flags", async () => {
  const result = await formatSearchResult(["a.ts", "b.ts", "c.ts"], "fd", 2);
  assert.ok(Check(SearchOutputSchema, result.structuredContent));
  assert.deepEqual(result.structuredContent.files, ["a.ts", "b.ts"]);
  assert.equal(result.structuredContent.limitReached, true);
  assert.equal(result.structuredContent.truncated, true);
  assert.match(result.content[0]!.text, /narrow the search/);
  const empty = await formatSearchResult([], "rg", 2);
  assert.ok(Check(SearchOutputSchema, empty.structuredContent));
  assert.equal(empty.structuredContent.truncated, false);
  assert.equal(empty.content[0]!.text, "No matches found");
});

test("oversized records do not leak past JSON/text budgets and have a full-output file", async () => {
  const result = await formatSearchResult([
    { kind: "match", path: "file.ts", line: 1, column: 1, text: "x".repeat(60_000) },
  ], "rg", 100);
  try {
    assert.ok(Check(SearchOutputSchema, result.structuredContent));
    assert.equal(result.structuredContent.matches.length, 0);
    assert.equal(result.structuredContent.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(result.structuredContent)) <= 50 * 1024);
    assert.ok(Buffer.byteLength(result.content[0]!.text) <= 50 * 1024);
    assert.match(await readFile(result.structuredContent.fullOutputPath!, "utf8"), /file.ts:1:1:/);
  } finally {
    await rm(dirname(result.structuredContent.fullOutputPath!), { recursive: true, force: true });
  }
});

function harness() {
  const tools = new Map<string, any>();
  extension({
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerCommand() {},
    exec(command: string, args: string[], options: { cwd: string; signal?: AbortSignal }) {
      return new Promise((resolve, reject) => {
        execFile(command, args, { cwd: options.cwd, signal: options.signal }, (error, stdout, stderr) => {
          if (error && typeof (error as any).code !== "number") reject(error);
          else resolve({ code: error ? (error as any).code : 0, stdout, stderr });
        });
      });
    },
  } as never);
  return tools;
}

test("Pi's actual codemode sandbox filters structured read-only search results", async (t) => {
  const tools = harness();
  if (!tools.has("simply_grep")) return t.skip("rg is not installed");
  let codemode: any;
  createCodemodeExtension({ models: false })({
    registerTool(tool: any) { codemode = tool; },
    appendEntry() {},
    getSettings: () => ({}),
    getAllTools: () => [],
  } as never);
  const root = await mkdtemp(join(tmpdir(), "pi-real-codemode-"));
  try {
    await writeFile(join(root, "source.txt"), "needle\n");
    let sequence = 0;
    const ctx = {
      cwd: root,
      tools: [tools.get("simply_grep")],
      sessionManager: { getBranch: () => [] },
      async executeTool(name: string, args: object, options: { signal: AbortSignal }) {
        const tool = tools.get(name);
        assert.ok(tool && Check(tool.parameters, args));
        const result = await tool.execute("nested", args, options.signal, undefined, ctx);
        assert.ok(Check(tool.outputSchema, result.structuredContent));
        return { toolCall: { id: `parent/${++sequence}`, name, arguments: args }, result, isError: false };
      },
    };
    const result = await codemode.execute("parent", { code: `
      const results = await Promise.allSettled([
        tools.simply_grep({ pattern: "needle", path: "." }),
        tools.simply_grep({ pattern: "absent", path: "." }),
      ]);
      return results.map(r => r.status === "fulfilled"
        ? { count: r.value.resultCount, paths: r.value.matches.map(m => m.path) }
        : { error: String(r.reason) });
    ` }, undefined, undefined, ctx);
    assert.notEqual(result.isError, true);
    const text = result.content.map((block: any) => block.text ?? "").join("\n");
    assert.match(text, /Script completed/);
    assert.match(text, /"count":1/);
    assert.match(text, /"count":0/);
    assert.match(text, /source\.txt/);
    assert.equal(sequence, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real fd exposes paths and distinguishes exact results from a capped search", async (t) => {
  const find = harness().get("simply_find");
  if (!find) return t.skip("fd is not installed");
  const root = await mkdtemp(join(tmpdir(), "pi-find-batch-"));
  try {
    await Promise.all(["a.txt", "b.txt", "c.txt"].map((name) => writeFile(join(root, name), "")));
    const run = (limit: number) => find.execute("find", { path: root, type: "file", limit }, undefined, undefined, { cwd: root });
    const full = await run(3);
    assert.ok(Check(find.outputSchema, full.structuredContent));
    assert.equal(full.structuredContent.files.length, 3);
    assert.equal(full.structuredContent.limitReached, false);
    const limited = await run(2);
    assert.equal(limited.structuredContent.files.length, 2);
    assert.equal(limited.structuredContent.limitReached, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real ripgrep supports independent batching, context, and no matches", async (t) => {
  const tools = harness();
  const grep = tools.get("simply_grep");
  if (!grep) return t.skip("rg is not installed");
  const root = await mkdtemp(join(tmpdir(), "pi-search-batch-"));
  try {
    await writeFile(join(root, "file:12:34.txt"), "before\nneedle here\nafter\n");
    assert.equal(grep.annotations.readOnlyHint, true);
    const run = (pattern: string, context = 0) => grep.execute("call", { pattern, path: root, context }, undefined, undefined, { cwd: root });
    const [found, empty] = await Promise.all([run("needle", 1), run("absent")]);
    assert.ok(Check(grep.outputSchema, found.structuredContent));
    assert.equal(found.structuredContent.matches.find((m: any) => m.kind === "match").line, 2);
    assert.equal(found.structuredContent.matches.filter((m: any) => m.kind === "context").length, 2);
    assert.equal(empty.structuredContent.resultCount, 0);
    const limited = await grep.execute("grep", { pattern: "needle", path: root, context: 1, limit: 1 }, undefined, undefined, { cwd: root });
    assert.equal(limited.structuredContent.resultCount, 1);
    assert.equal(limited.structuredContent.limitReached, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
