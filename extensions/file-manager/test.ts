import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import extension from "./src/index.ts";
import {
  availableFileActions,
  discoverFileActionCapabilities,
  performAction,
  resolveEditorCommand,
  type FileActionCapabilities,
} from "./src/actions.ts";
import { openFileBrowserPopup } from "./src/popup.ts";
import { fuzzyFiles, parseContentMatch } from "./src/search.ts";

test("parses ripgrep matches including paths containing colons", () => {
  assert.deepEqual(parseContentMatch("src/a:b.ts:12:7:const answer = 42"), {
    path: "src/a:b.ts",
    line: 12,
    column: 7,
    preview: "const answer = 42",
  });
  assert.equal(parseContentMatch("not a match"), undefined);
});

test("falls back to deterministic filename filtering without fzf", async () => {
  const matches = await fuzzyFiles(
    ["src/file-manager.ts", "src/manager.ts", "README.md"],
    "src manager",
    undefined,
    "/repo",
  );
  assert.deepEqual(
    matches.map((match) => match.path),
    ["src/file-manager.ts", "src/manager.ts"],
  );
});

test("renders the browser and closes with a normal-mode q", async () => {
  let rendered: string[] = [];
  const outcome = await openFileBrowserPopup(
    {
      cwd: "/repo",
      ui: {
        custom: async (factory: any) =>
          new Promise((resolve) => {
            const component = factory(
              { requestRender() {} },
              {
                fg: (_color: string, text: string) => text,
                bg: (_color: string, text: string) => text,
                bold: (text: string) => text,
              },
              { matches: () => false },
              resolve,
            );
            setImmediate(() => {
              rendered = component.render(100);
              component.handleInput("q");
            });
          }),
      },
    } as never,
    ["src/index.ts", "README.md"],
    {},
    {
      editor: { kind: "zed", path: "/fake/zed", label: "Zed" },
      terminalEditor: { command: "nvim", label: "Neovim" },
      viewer: "bat",
    },
  );
  assert.ok(rendered.some((line) => line.includes("File Manager")));
  assert.ok(rendered.some((line) => line.includes("src/index.ts")));
  assert.equal(outcome?.action, "close");
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

test("hides Herdr and editor actions when capabilities are unavailable", () => {
  const capabilities: FileActionCapabilities = {};
  assert.deepEqual(
    availableFileActions(capabilities).map((action) => action.key),
    ["y", "r"],
  );
});

test("uses Vim and cat labels when those fallbacks are selected", () => {
  const actions = availableFileActions({
    terminalEditor: { command: "vim", label: "Vim" },
    viewer: "cat",
  });
  assert.deepEqual(
    actions.map(({ key, label }) => [key, label]),
    [
      ["y", "copy"],
      ["r", "reveal"],
      ["b", "cat pane"],
      ["n", "Vim pane"],
    ],
  );
});

test("falls back from Zed to a VS Code-compatible editor", () => {
  const editor = resolveEditorCommand({
    commandPath: (name) => (name === "codium" ? "/fake/codium" : undefined),
    executable: () => false,
    platform: "linux",
  });
  assert.deepEqual(editor, {
    kind: "vscode",
    path: "/fake/codium",
    label: "VSCodium",
  });
});

test("falls back from bat to cat in a Herdr pane", async () => {
  const directory = await mkdtemp(join(tmpdir(), "file-manager-bin-"));
  const fakeCat = join(directory, "cat");
  await writeFile(fakeCat, "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(fakeCat, 0o755);
  const previous = { path: process.env.PATH, herdr: process.env.HERDR_ENV };
  process.env.PATH = directory;
  process.env.HERDR_ENV = "1";
  const calls: Array<{ command: string; args: string[] }> = [];
  try {
    await performAction(
      {
        exec: async (command: string, args: string[]) => {
          calls.push({ command, args });
          if (args[0] === "pane" && args[1] === "current") {
            return {
              code: 0,
              stdout: JSON.stringify({
                result: { pane: { pane_id: "w1:p2" } },
              }),
              stderr: "",
            };
          }
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
      { cwd: process.cwd(), ui: { notify() {} } } as never,
      "bat",
      { path: "README.md", line: 24, column: 1 },
    );
    assert.match(calls[2]?.args[3] ?? "", /cat.*README\.md/);
  } finally {
    if (previous.path == null) delete process.env.PATH;
    else process.env.PATH = previous.path;
    if (previous.herdr == null) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previous.herdr;
    await rm(directory, { recursive: true, force: true });
  }
});

test("registers only the /files command and fails safely outside TUI", async () => {
  let command: { handler(args: string, ctx: any): Promise<void> } | undefined;
  const tools: unknown[] = [];
  extension({
    registerCommand(name: string, definition: typeof command) {
      assert.equal(name, "files");
      command = definition;
    },
    registerTool(tool: unknown) {
      tools.push(tool);
    },
  } as never);

  assert.equal(tools.length, 0);
  assert.ok(command);
  const notices: Array<[string, string]> = [];
  await command!.handler("", {
    mode: "print",
    ui: {
      notify: (message: string, level: string) =>
        notices.push([message, level]),
    },
  });
  assert.deepEqual(notices, [
    ["/files requires Pi's interactive TUI", "warning"],
  ]);
});
