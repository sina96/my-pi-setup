import assert from "node:assert/strict";
import test from "node:test";
import permissionGate from "./src/index.ts";
import {
  classifyPath,
  compileRule,
  DEFAULT_RULES,
  extractPathsFromBash,
  matchingRules,
  pathConcernsForBash,
  pathConcernsForTool,
} from "./src/policy.ts";

test("classifies catastrophic commands above broader dangerous matches", () => {
  const hits = matchingRules("rm -rf /", DEFAULT_RULES);
  assert.equal(hits[0]?.id, "catastrophic-recursive-deletion");
  assert.equal(hits[0]?.severity, "critical");
  assert.equal(
    hits.some((rule) => rule.id === "recursive-file-deletion"),
    true,
  );
});

test("covers high-confidence critical and dangerous operations", () => {
  const cases: [string, string, string][] = [
    ["mkfs.ext4 /dev/sdb1", "disk-filesystem-operation", "critical"],
    ["dd if=x of=/dev/disk2", "raw-disk-write", "critical"],
    ["echo x > /dev/nvme0n1", "raw-disk-write", "critical"],
    [":(){ :|:& };:", "fork-bomb", "critical"],
    ["kill -9 -1", "kill-all-processes", "critical"],
    ["git stash drop", "destructive-git-operation", "dangerous"],
    ["git checkout --force", "destructive-git-operation", "dangerous"],
    ["rtk git reset --hard", "destructive-git-operation", "dangerous"],
    ["docker rm -f abc", "container-destructive-cleanup", "dangerous"],
    ["docker volume rm data", "container-destructive-cleanup", "dangerous"],
    ["printf x > .env.local", "environment-file-write", "risky"],
  ];
  for (const [command, id, severity] of cases) {
    const hit = matchingRules(command, DEFAULT_RULES).find(
      (rule) => rule.id === id,
    );
    assert.equal(hit?.severity, severity, command);
  }
});

test("avoids representative command false positives", () => {
  for (const command of [
    "echo pseudo",
    "echo sudo reboot rm -rf",
    "echo env",
    "set -euo pipefail",
    "ls ./pix-sudo",
    "git status",
    "docker volume ls",
    "rm ./single-file",
    "cat .env.example",
  ]) {
    assert.deepEqual(matchingRules(command, DEFAULT_RULES), [], command);
  }
});

test("compiles custom severity and rejects unsafe regex flags", () => {
  const compiled = compileRule(
    {
      id: "deploy-prod",
      label: "production deploy",
      pattern: "deploy prod",
      severity: "critical",
    },
    "project",
  );
  assert.equal(compiled.rule?.severity, "critical");
  assert.match(
    compileRule({ id: "x", label: "x", pattern: "x", flags: "g" }, "global")
      .error ?? "",
    /invalid flags/,
  );
});

test("classifies sensitive paths while excluding example environment files", () => {
  assert.equal(classifyPath("~/.ssh/id_ed25519", "read")?.severity, "block");
  assert.equal(classifyPath("./.aws/credentials", "read")?.severity, "block");
  assert.equal(classifyPath(".env.local", "read")?.severity, "warn");
  assert.equal(classifyPath("config.env", "read")?.severity, "warn");
  assert.equal(classifyPath(".env.example", "read"), undefined);
  assert.equal(
    classifyPath("src/node_modules/pkg/index.js", "write")?.severity,
    "info",
  );
  assert.equal(
    classifyPath("src/node_modules/pkg/index.js", "read"),
    undefined,
  );
});

test("covers built-in file tools and simply finding tools", () => {
  assert.equal(
    pathConcernsForTool("read", { path: "/tmp/id_rsa" }).concerns[0]?.severity,
    "critical",
  );
  assert.equal(
    pathConcernsForTool("write", { path: ".env" }).concerns[0]?.severity,
    "dangerous",
  );
  assert.equal(
    pathConcernsForTool("simply_find", { path: "~/.ssh" }).concerns[0]?.label,
    "SSH configuration directory",
  );
  assert.equal(
    pathConcernsForTool("simply_grep", { path: ".env" }).concerns[0]?.label,
    "environment secrets file",
  );
  assert.equal(
    pathConcernsForTool("simply_grep", { glob: "*.env" }).concerns[0]?.label,
    "environment secrets file",
  );
  assert.equal(
    pathConcernsForTool("simply_grep", { hidden: true }).concerns[0]?.severity,
    "risky",
  );
  assert.deepEqual(
    pathConcernsForTool("simply_find", { path: "." }).concerns,
    [],
  );
});

test("extracts explicit sensitive Bash paths", () => {
  assert.deepEqual(
    extractPathsFromBash("cat ~/.aws/credentials && source .env"),
    ["~/.aws/credentials", ".env"],
  );
  assert.equal(
    pathConcernsForBash("cat ~/.aws/credentials")[0]?.severity,
    "critical",
  );
});

function harness(select: (...args: unknown[]) => Promise<string | undefined>) {
  const handlers = new Map<string, Function[]>();
  const emitted: unknown[][] = [];
  permissionGate({
    on(name: string, handler: Function) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerCommand() {},
    appendEntry() {},
    events: {
      emit(...args: unknown[]) {
        emitted.push(args);
      },
    },
  } as never);
  const ctx = {
    hasUI: true,
    mode: "tui",
    ui: {
      select,
      notify() {},
      theme: { fg: (_color: string, text: string) => text },
    },
  };
  return {
    call: handlers.get("tool_call")?.[0] as Function,
    ctx,
    emitted,
  };
}

test("critical prompts are deny-first, timed, and report Herdr blocked state", async () => {
  let choices: unknown;
  let options: unknown;
  const gate = harness(async (_title, receivedChoices, receivedOptions) => {
    choices = receivedChoices;
    options = receivedOptions;
    return undefined;
  });
  const result = await gate.call(
    { toolName: "bash", input: { command: "rm -rf /" } },
    gate.ctx,
  );
  assert.deepEqual(choices, ["Deny", "Allow once"]);
  assert.deepEqual(options, { timeout: 15_000 });
  assert.equal(result.block, true);
  assert.deepEqual(
    gate.emitted.map((entry) => entry[1]),
    [
      { active: true, label: "Waiting for critical permission approval" },
      { active: false },
    ],
  );
});

test("dangerous exact-command approvals bypass repeats but not changed commands", async () => {
  let prompts = 0;
  const gate = harness(async () => {
    prompts++;
    return "Allow this exact command for this session";
  });
  const first = { toolName: "bash", input: { command: "rm -rf ./tmp-a" } };
  assert.equal(await gate.call(first, gate.ctx), undefined);
  assert.equal(await gate.call(first, gate.ctx), undefined);
  assert.equal(prompts, 1);
  await gate.call(
    { toolName: "bash", input: { command: "rm -rf ./tmp-b" } },
    gate.ctx,
  );
  assert.equal(prompts, 2);
});

test("serializes concurrent prompts and balances Herdr blocked events", async () => {
  const resolvers: ((value: string) => void)[] = [];
  const gate = harness(
    () =>
      new Promise<string>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  const first = gate.call(
    { toolName: "bash", input: { command: "rm -rf ./one" } },
    gate.ctx,
  );
  const second = gate.call(
    { toolName: "bash", input: { command: "rm -rf ./two" } },
    gate.ctx,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolvers.length, 1);
  assert.equal(gate.emitted.length, 1);

  resolvers[0]!("Deny");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolvers.length, 2);
  resolvers[1]!("Deny");
  await Promise.all([first, second]);
  assert.deepEqual(
    gate.emitted.map((entry) => (entry[1] as { active: boolean }).active),
    [true, false, true, false],
  );
});

test("headless command and sensitive-path access fail closed", async () => {
  const gate = harness(async () => "Allow once");
  const headless = { ...gate.ctx, hasUI: false };
  const command = await gate.call(
    { toolName: "bash", input: { command: "git reset --hard" } },
    headless,
  );
  const path = await gate.call(
    { toolName: "simply_grep", input: { path: ".env", pattern: "TOKEN" } },
    headless,
  );
  assert.equal(command.block, true);
  assert.equal(path.block, true);
});

test("simply_grep hidden searches prompt and preserve Herdr state lifecycle", async () => {
  const gate = harness(async () => "Deny");
  const result = await gate.call(
    { toolName: "simply_grep", input: { pattern: "secret", hidden: true } },
    gate.ctx,
  );
  assert.equal(result.block, true);
  assert.deepEqual(
    gate.emitted.map((entry) => entry[1]),
    [
      { active: true, label: "Waiting for risky permission approval" },
      { active: false },
    ],
  );
});
