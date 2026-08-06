import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import packageManagerPolicy, {
  detectProjectManagers,
  findManagerViolation,
  restorePolicyState,
} from "./src/index.ts";

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "package-manager-policy-"));
  await mkdir(join(directory, ".git"));
  return directory;
}

function effective(node = "pnpm", python = "uv", mode = "enforce") {
  return {
    node: { manager: node, source: "test" },
    python: { manager: python, source: "test" },
    mode,
  } as any;
}

function harness(cwd: string, branch: unknown[] = []) {
  const handlers = new Map<string, Function[]>();
  const commands = new Map<string, any>();
  const entries: unknown[][] = [];
  const notifications: unknown[][] = [];
  const pi = {
    on(name: string, handler: Function) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    appendEntry(...args: unknown[]) { entries.push(args); },
  };
  packageManagerPolicy(pi as never);
  const ctx = {
    cwd,
    hasUI: true,
    sessionManager: { getBranch: () => branch },
    ui: { notify: (...args: unknown[]) => notifications.push(args) },
  };
  return { handlers, commands, entries, notifications, ctx };
}

test("detects established managers and packageManager wins over lockfiles", async () => {
  const directory = await fixture();
  try {
    await writeFile(join(directory, "package.json"), JSON.stringify({ packageManager: "npm@11.0.0" }));
    await writeFile(join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(directory, "uv.lock"), "version = 1\n");
    const detected = await detectProjectManagers(directory);
    assert.equal(detected.node.manager, "npm");
    assert.match(detected.node.source ?? "", /packageManager/);
    assert.equal(detected.python.manager, "uv");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports conflicting lockfiles instead of guessing", async () => {
  const directory = await fixture();
  try {
    await writeFile(join(directory, "package-lock.json"), "{}");
    await writeFile(join(directory, "yarn.lock"), "");
    const detected = await detectProjectManagers(directory);
    assert.deepEqual(detected.node.conflict, ["npm", "yarn"]);
    assert.equal(detected.node.manager, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("finds incompatible Node and Python commands without blocking ordinary Python", () => {
  assert.equal(findManagerViolation("pnpm install && pnpm test", effective()), undefined);
  assert.equal(findManagerViolation("uv run python script.py", effective()), undefined);
  assert.equal(findManagerViolation("python script.py", effective()), undefined);
  assert.equal(findManagerViolation("cd app && npm install", effective())?.attempted, "npm");
  assert.equal(findManagerViolation("npx eslint .", effective())?.attempted, "npx");
  assert.equal(findManagerViolation("pip install flask", effective())?.attempted, "pip");
  assert.equal(findManagerViolation("python -m pip install flask", effective())?.ecosystem, "python");
  assert.equal(findManagerViolation("python -m venv .venv", effective())?.selected, "uv");

  const pip3Policy = effective("pnpm", "pip3");
  assert.equal(findManagerViolation("pip3 install flask", pip3Policy), undefined);
  assert.equal(findManagerViolation("pip3.12 install flask", pip3Policy), undefined);
  assert.equal(findManagerViolation("python3 -m pip install flask", pip3Policy), undefined);
  assert.equal(findManagerViolation("pip install flask", pip3Policy)?.selected, "pip3");
});

test("defaults to pnpm and uv, then honors a session npm override", async () => {
  const directory = await fixture();
  try {
    const h = harness(directory);
    await h.handlers.get("session_start")?.[0]?.({}, h.ctx);
    const prompt = await h.handlers.get("before_agent_start")?.[0]?.({ systemPrompt: "base" }, h.ctx);
    assert.match(prompt.systemPrompt, /Node: pnpm \(default\)/);
    assert.match(prompt.systemPrompt, /Python: uv \(default\)/);

    const initiallyBlocked = await h.handlers.get("tool_call")?.[0]?.(
      { toolName: "bash", input: { command: "npm install" } },
      h.ctx,
    );
    assert.equal(initiallyBlocked.block, true);
    assert.match(initiallyBlocked.reason, /Use pnpm/);

    await h.commands.get("package-manager").handler("node npm", h.ctx);
    assert.equal(h.entries.at(-1)?.[0], "simply-package-manager-policy-state");
    const npmAllowed = await h.handlers.get("tool_call")?.[0]?.(
      { toolName: "bash", input: { command: "npm install" } },
      h.ctx,
    );
    assert.equal(npmAllowed, undefined);
    const pnpmBlocked = await h.handlers.get("tool_call")?.[0]?.(
      { toolName: "bash", input: { command: "pnpm install" } },
      h.ctx,
    );
    assert.equal(pnpmBlocked.block, true);
    assert.match(pnpmBlocked.reason, /Node uses npm/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("restores the latest valid session policy snapshot", () => {
  const restored = restorePolicyState({
    sessionManager: {
      getBranch: () => [
        { type: "custom", customType: "simply-package-manager-policy-state", data: { version: 1, node: "npm", python: "uv", mode: "warn" } },
        { type: "custom", customType: "simply-package-manager-policy-state", data: { version: 1, node: "bad", python: "uv", mode: "off" } },
      ],
    },
  } as never);
  assert.deepEqual(restored, { version: 1, node: "npm", python: "uv", mode: "warn" });
});
