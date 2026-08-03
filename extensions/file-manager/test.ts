import assert from "node:assert/strict";
import test from "node:test";
import extension from "./src/index.ts";
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
  );
  assert.ok(rendered.some((line) => line.includes("File Manager")));
  assert.ok(rendered.some((line) => line.includes("src/index.ts")));
  assert.equal(outcome?.action, "close");
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
