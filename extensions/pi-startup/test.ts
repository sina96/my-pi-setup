import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countMcpServers } from "./src/discovery.ts";

async function withDirs(run: (root: string, cwd: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "pi-startup-"));
  const cwd = join(root, "project");
  await mkdir(cwd);
  try {
    await run(root, cwd);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function count(root: string, cwd: string, trusted: boolean, registered: Array<{ name: string; config: object }>) {
  return countMcpServers(
    { getMcpServers: () => registered } as never,
    { cwd, isProjectTrusted: () => trusted } as never,
    root,
  );
}

test("counts current global MCP config and deduplicates extension registrations", async () => {
  await withDirs(async (root, cwd) => {
    await writeFile(join(root, "mcp.json"), JSON.stringify({ mcpServers: { docs: { url: "https://example.test" }, disabled: { enabled: false } } }));
    assert.equal(count(root, cwd, false, [
      { name: "docs", config: {} },
      { name: "extension-server", config: {} },
    ]), 3);
  });
});

test("trusted project servers override global entries; untrusted config is ignored", async () => {
  await withDirs(async (root, cwd) => {
    await writeFile(join(root, "mcp.json"), JSON.stringify({ mcpServers: { shared: {}, global: {} } }));
    await mkdir(join(cwd, ".pi"));
    await writeFile(join(cwd, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { shared: {}, project: {} } }));
    assert.equal(count(root, cwd, false, []), 2);
    assert.equal(count(root, cwd, true, []), 3);
  });
});
