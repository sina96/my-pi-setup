import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countMcpServers } from "./src/discovery.ts";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { piPixelLogo, renderStartup } from "./src/layout.ts";

test("large Pi logo preserves the upstream 4×4 silhouette at 3× scale", () => {
  const lines = piPixelLogo();
  assert.equal(lines.length, 6);
  assert.ok(lines.every((line) => visibleWidth(line) === 12));
  const pixels = lines.flatMap((line) => [
    [...line].map((cell) => cell === "█" || cell === "▀" ? "1" : "0").join(""),
    [...line].map((cell) => cell === "█" || cell === "▄" ? "1" : "0").join(""),
  ]);
  assert.deepEqual(pixels, ["1110", "1010", "1101", "1001"].flatMap((row) =>
    Array(3).fill([...row].map((pixel) => pixel.repeat(3)).join("")),
  ));
});

test("dashboard recolors the logo on render and stays within available width", () => {
  let accent = 31;
  const theme = {
    fg: (token: string, text: string) => `\x1b[${token === "accent" ? accent : 37}m${text}\x1b[0m`,
  } as Theme;
  const counts = { models: 29, extensions: 25, skills: 22, mcpServers: 0, prompts: 7, contextFiles: 1 };
  const keys = { model: "ctrl+p", thinking: "shift+tab", tools: "ctrl+o" };
  const red = renderStartup(theme, counts, keys, 88).join("\n");
  accent = 34;
  const blue = renderStartup(theme, counts, keys, 88).join("\n");
  assert.ok(red.includes("\x1b[31m" + piPixelLogo()[0]));
  assert.ok(blue.includes("\x1b[34m" + piPixelLogo()[0]));
  assert.notEqual(red, blue);
  assert.ok(blue.includes("models") && blue.includes("cycle model"));
  for (const width of [44, 50, 88, 160]) {
    assert.ok(renderStartup(theme, counts, keys, width).every((line) => visibleWidth(line) <= width));
  }
  assert.deepEqual(renderStartup(theme, counts, keys, 43), []);
});

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
