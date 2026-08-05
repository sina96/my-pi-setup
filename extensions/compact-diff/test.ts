import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import extension from "./src/index.ts";
import {
  availableFileActions,
  discoverFileActionCapabilities,
  performFileAction,
  resolveEditorCommand,
  targetForLine,
  type FileActionCapabilities,
} from "./src/actions.ts";
import { normalizeDiffArgs, tokenizeArgs } from "./src/git.ts";
import { parseDiff } from "./src/parser.ts";
import { openCompactDiffPopup } from "./src/popup.ts";

const SAMPLE = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
-old
+new
 context
@@ -10,1 +10,2 @@
 tail
+extra
`;

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => `<selected>${text}</selected>`,
  bold: (text: string) => text,
};

test("tokenizes diff arguments and normalizes Pi path prefixes", () => {
  assert.deepEqual(tokenizeArgs(`main...HEAD -- "src/a b.ts"`), [
    "main...HEAD",
    "--",
    "src/a b.ts",
  ]);
  assert.deepEqual(normalizeDiffArgs("--cached -- @src/a.ts"), [
    "--cached",
    "--",
    "src/a.ts",
  ]);
  assert.deepEqual(normalizeDiffArgs("-- --output"), ["--", "--output"]);
  assert.throws(() => normalizeDiffArgs("--output=/tmp/diff"), /Unsupported/);
  assert.throws(() => tokenizeArgs(`"unfinished`), /Unterminated/);
});

test("parses files, hunks, line numbers, and hunk text", () => {
  const document = parseDiff(SAMPLE);
  assert.equal(document.files.length, 1);
  assert.deepEqual(
    {
      path: document.files[0]?.path,
      additions: document.files[0]?.additions,
      deletions: document.files[0]?.deletions,
    },
    { path: "src/a.ts", additions: 2, deletions: 1 },
  );
  assert.equal(document.hunks.length, 2);
  const addition = document.lines.find((line) => line.text === "+new");
  assert.equal(addition?.newLine, 1);
  assert.equal(addition?.oldLine, undefined);
});

test("maps additions to working-tree locations and removals to files", () => {
  const document = parseDiff(SAMPLE);
  const addition = document.lines.find((line) => line.text === "+new")!;
  const removal = document.lines.find((line) => line.text === "-old")!;
  assert.deepEqual(targetForLine("/repo", addition), {
    path: "src/a.ts",
    absolutePath: "/repo/src/a.ts",
    line: 1,
  });
  assert.deepEqual(targetForLine("/repo", removal), {
    path: "src/a.ts",
    absolutePath: "/repo/src/a.ts",
    line: undefined,
  });
});

const allCapabilities: FileActionCapabilities = {
  editor: { kind: "zed", path: "/fake/zed", label: "Zed" },
  terminalEditor: { command: "nvim", label: "Neovim" },
  viewer: "bat",
};

async function drivePopup(
  inputs: string[],
  capabilities: FileActionCapabilities = allCapabilities,
): Promise<{ renders: string[][]; outcome: unknown }> {
  const renders: string[][] = [];
  let outcome: unknown;
  outcome = await openCompactDiffPopup(
    {
      ui: {
        custom: async (factory: any, options: any) => {
          assert.equal(options.overlay, true);
          return new Promise((resolve) => {
            const tui = {
              terminal: { rows: 24, columns: 100 },
              requestRender() {},
            };
            const component = factory(
              tui,
              theme,
              { matches: () => false },
              resolve,
            );
            renders.push(component.render(100));
            for (const input of inputs) {
              component.handleInput(input);
              renders.push(component.render(100));
            }
          });
        },
      },
    } as never,
    parseDiff(SAMPLE),
    "unstaged changes",
    "/repo",
    capabilities,
    async () => "opened",
  );
  return { renders, outcome };
}

test("supports up/down arrows and left/right hunk navigation", async () => {
  const { renders, outcome } = await drivePopup([
    "\u001b[B",
    "\u001b[C",
    "\u001b[D",
    "\u001b[A",
    "q",
  ]);
  assert.ok(
    renders[1]?.some(
      (line) => line.includes("<selected>") && line.includes("-old"),
    ),
  );
  assert.ok(
    renders[2]?.some(
      (line) => line.includes("<selected>") && line.includes("@@ -10"),
    ),
  );
  assert.ok(
    renders[3]?.some(
      (line) => line.includes("<selected>") && line.includes("@@ -1"),
    ),
  );
  assert.deepEqual(outcome, { action: "close" });
});

test("opens the action palette and drafts current-hunk analysis", async () => {
  const palette = await drivePopup(["o", "\u001b", "a"]);
  assert.ok(palette.renders[1]?.some((line) => line.includes("Open: z Zed")));
  assert.equal((palette.outcome as any).action, "analyze");
  assert.equal((palette.outcome as any).scope, "hunk");
  assert.match((palette.outcome as any).text, /^@@ -1,2/);
});

test("capability discovery hides pane actions outside Herdr", () => {
  const previous = {
    herdr: process.env.HERDR_ENV,
    pane: process.env.HERDR_PANE_ID,
  };
  delete process.env.HERDR_ENV;
  delete process.env.HERDR_PANE_ID;
  try {
    const capabilities = discoverFileActionCapabilities();
    assert.equal(capabilities.terminalEditor, undefined);
    assert.equal(capabilities.viewer, undefined);
  } finally {
    if (previous.herdr == null) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previous.herdr;
    if (previous.pane == null) delete process.env.HERDR_PANE_ID;
    else process.env.HERDR_PANE_ID = previous.pane;
  }
});

test("hides pane actions when Herdr capabilities are unavailable", async () => {
  const capabilities: FileActionCapabilities = {
    editor: { kind: "vscode", path: "/fake/code", label: "VS Code" },
  };
  assert.deepEqual(
    availableFileActions(capabilities).map((action) => action.key),
    ["z", "r", "y"],
  );
  const palette = await drivePopup(["o", "n", "\u001b", "q"], capabilities);
  assert.ok(palette.renders[1]?.some((line) => line.includes("z VS Code")));
  assert.equal(
    palette.renders[1]?.some((line) => line.includes("Neovim")),
    false,
  );
  assert.deepEqual(palette.outcome, { action: "close" });
});

test("falls back from Zed to a VS Code-compatible editor", () => {
  const editor = resolveEditorCommand({
    commandPath: (name) => (name === "code" ? "/fake/code" : undefined),
    executable: () => false,
    platform: "linux",
  });
  assert.deepEqual(editor, {
    kind: "vscode",
    path: "/fake/code",
    label: "VS Code",
  });
});

test("launches Neovim in a Herdr pane with argument-safe file targeting", async () => {
  const previousHerdr = process.env.HERDR_ENV;
  const previousPane = process.env.HERDR_PANE_ID;
  process.env.HERDR_ENV = "1";
  process.env.HERDR_PANE_ID = "w1:p2";
  const calls: Array<{ command: string; args: string[] }> = [];
  try {
    const message = await performFileAction(
      {
        exec: async (command: string, args: string[]) => {
          calls.push({ command, args });
          if (args[0] === "pane" && args[1] === "split") {
            return {
              code: 0,
              stdout: JSON.stringify({
                result: { pane: { pane_id: "w1:p3" } },
              }),
              stderr: "",
            };
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      } as never,
      process.cwd(),
      "nvim",
      {
        path: "README.md",
        absolutePath: `${process.cwd()}/README.md`,
        line: 24,
      },
    );
    assert.match(message, /README\.md:24 in nvim/);
    assert.deepEqual(calls[0]?.args.slice(0, 5), [
      "pane",
      "split",
      "w1:p2",
      "--direction",
      "right",
    ]);
    assert.equal(calls[1]?.args[0], "pane");
    assert.equal(calls[1]?.args[1], "run");
    assert.match(calls[1]?.args[3] ?? "", /nvim.*\+24.*README\.md/);
  } finally {
    if (previousHerdr == null) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previousHerdr;
    if (previousPane == null) delete process.env.HERDR_PANE_ID;
    else process.env.HERDR_PANE_ID = previousPane;
  }
});

test("uses the Vim fallback when Neovim is unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "compact-diff-vim-bin-"));
  const fakeVim = join(directory, "vim");
  await writeFile(fakeVim, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(fakeVim, 0o755);
  const previous = {
    path: process.env.PATH,
    herdr: process.env.HERDR_ENV,
    pane: process.env.HERDR_PANE_ID,
  };
  process.env.PATH = directory;
  process.env.HERDR_ENV = "1";
  process.env.HERDR_PANE_ID = "w1:p2";
  const calls: Array<{ command: string; args: string[] }> = [];
  try {
    const message = await performFileAction(
      {
        exec: async (command: string, args: string[]) => {
          calls.push({ command, args });
          if (args[0] === "pane" && args[1] === "split") {
            return {
              code: 0,
              stdout: JSON.stringify({
                result: { pane: { pane_id: "w1:p3" } },
              }),
              stderr: "",
            };
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      } as never,
      process.cwd(),
      "nvim",
      {
        path: "README.md",
        absolutePath: `${process.cwd()}/README.md`,
        line: 24,
      },
    );
    assert.match(message, /in vim$/);
    assert.match(calls[1]?.args[3] ?? "", /vim.*\+24.*README\.md/);
  } finally {
    if (previous.path == null) delete process.env.PATH;
    else process.env.PATH = previous.path;
    if (previous.herdr == null) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previous.herdr;
    if (previous.pane == null) delete process.env.HERDR_PANE_ID;
    else process.env.HERDR_PANE_ID = previous.pane;
    await rm(directory, { recursive: true, force: true });
  }
});

test("falls back from bat to cat in a Herdr pane", async () => {
  const directory = await mkdtemp(join(tmpdir(), "compact-diff-bin-"));
  const fakeCat = join(directory, "cat");
  await writeFile(fakeCat, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(fakeCat, 0o755);
  const previous = {
    path: process.env.PATH,
    herdr: process.env.HERDR_ENV,
    pane: process.env.HERDR_PANE_ID,
  };
  process.env.PATH = directory;
  process.env.HERDR_ENV = "1";
  process.env.HERDR_PANE_ID = "w1:p2";
  const calls: Array<{ command: string; args: string[] }> = [];
  try {
    const message = await performFileAction(
      {
        exec: async (command: string, args: string[]) => {
          calls.push({ command, args });
          if (args[0] === "pane" && args[1] === "split") {
            return {
              code: 0,
              stdout: JSON.stringify({
                result: { pane: { pane_id: "w1:p3" } },
              }),
              stderr: "",
            };
          }
          return { code: 0, stdout: "", stderr: "" };
        },
      } as never,
      process.cwd(),
      "bat",
      {
        path: "README.md",
        absolutePath: `${process.cwd()}/README.md`,
        line: 24,
      },
    );
    assert.match(message, /in cat$/);
    assert.match(calls[1]?.args[3] ?? "", /cat.*README\.md/);
  } finally {
    if (previous.path == null) delete process.env.PATH;
    else process.env.PATH = previous.path;
    if (previous.herdr == null) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previous.herdr;
    if (previous.pane == null) delete process.env.HERDR_PANE_ID;
    else process.env.HERDR_PANE_ID = previous.pane;
    await rm(directory, { recursive: true, force: true });
  }
});

test("registers /diff and fails safely outside interactive mode", async () => {
  let command: any;
  extension({
    registerCommand(name: string, definition: unknown) {
      assert.equal(name, "diff");
      command = definition;
    },
  } as never);
  const notices: Array<[string, string]> = [];
  await command.handler("", {
    mode: "print",
    ui: {
      notify: (message: string, level: string) =>
        notices.push([message, level]),
    },
  });
  assert.deepEqual(notices, [
    ["/diff requires Pi's interactive TUI", "warning"],
  ]);
});
