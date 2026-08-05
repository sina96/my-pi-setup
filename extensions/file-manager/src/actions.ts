import { constants, accessSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import {
  basename,
  delimiter,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { tmpdir } from "node:os";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { FileMatch } from "./search.ts";

export type FileAction = "copy" | "reveal" | "zed" | "bat" | "nvim" | "diff";

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandPath(name: string): string | undefined {
  return process.env.PATH?.split(delimiter)
    .map((directory) => join(directory, name))
    .find(executable);
}

export type EditorCommand = {
  kind: "zed" | "vscode";
  path: string;
  label: string;
};

export type FileActionCapabilities = {
  editor?: EditorCommand;
  terminalEditor?: { command: "nvim" | "vim"; label: "Neovim" | "Vim" };
  viewer?: "bat" | "cat";
};

export type FileActionDescriptor = {
  key: string;
  action: FileAction;
  label: string;
};

export function resolveEditorCommand(
  options: {
    commandPath?: (name: string) => string | undefined;
    executable?: (path: string) => boolean;
    platform?: NodeJS.Platform;
  } = {},
): EditorCommand | undefined {
  const findCommand = options.commandPath ?? commandPath;
  const isExecutable = options.executable ?? executable;
  const platform = options.platform ?? process.platform;
  const zed = findCommand("zed");
  if (zed) return { kind: "zed", path: zed, label: "Zed" };
  const macZed = "/Applications/Zed.app/Contents/MacOS/cli";
  if (platform === "darwin" && isExecutable(macZed)) {
    return { kind: "zed", path: macZed, label: "Zed" };
  }

  for (const name of ["code", "code-insiders", "codium"]) {
    const path = findCommand(name);
    if (path)
      return {
        kind: "vscode",
        path,
        label: name === "codium" ? "VSCodium" : "VS Code",
      };
  }
  if (platform === "darwin") {
    for (const path of [
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code",
      "/Applications/VSCodium.app/Contents/Resources/app/bin/code",
    ]) {
      if (isExecutable(path))
        return {
          kind: "vscode",
          path,
          label: path.includes("VSCodium") ? "VSCodium" : "VS Code",
        };
    }
  }
  return undefined;
}

export function discoverFileActionCapabilities(): FileActionCapabilities {
  const inHerdr =
    process.env.HERDR_ENV === "1" && Boolean(process.env.HERDR_PANE_ID);
  const terminalEditor = !inHerdr
    ? undefined
    : commandPath("nvim")
      ? { command: "nvim" as const, label: "Neovim" as const }
      : commandPath("vim")
        ? { command: "vim" as const, label: "Vim" as const }
        : undefined;
  const viewer = !inHerdr
    ? undefined
    : commandPath("bat")
      ? ("bat" as const)
      : commandPath("cat")
        ? ("cat" as const)
        : undefined;
  return { editor: resolveEditorCommand(), terminalEditor, viewer };
}

export function availableFileActions(
  capabilities: FileActionCapabilities,
): FileActionDescriptor[] {
  return [
    { key: "y", action: "copy", label: "copy" },
    { key: "r", action: "reveal", label: "reveal" },
    ...(capabilities.editor
      ? [{ key: "z", action: "zed" as const, label: capabilities.editor.label }]
      : []),
    ...(capabilities.viewer
      ? [
          {
            key: "b",
            action: "bat" as const,
            label: `${capabilities.viewer} pane`,
          },
        ]
      : []),
    ...(capabilities.terminalEditor
      ? [
          {
            key: "n",
            action: "nvim" as const,
            label: `${capabilities.terminalEditor.label} pane`,
          },
        ]
      : []),
    ...(capabilities.editor
      ? [{ key: "d", action: "diff" as const, label: "diff" }]
      : []),
  ];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function absolutePath(cwd: string, match: FileMatch): string {
  return resolve(cwd, match.path);
}

async function copyPath(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  path: string,
): Promise<void> {
  const command =
    process.platform === "darwin"
      ? "pbcopy"
      : process.env.WAYLAND_DISPLAY
        ? "wl-copy"
        : "xclip";
  const args = command === "xclip" ? ["-selection", "clipboard"] : [];
  const escaped = shellQuote(path);
  const result = await pi.exec("sh", [
    "-c",
    `printf %s ${escaped} | ${command}${args.length ? ` ${args.join(" ")}` : ""}`,
  ]);
  if (result.code !== 0)
    throw new Error(result.stderr.trim() || "Failed to copy path");
  ctx.ui.notify(`Copied ${path}`, "info");
}

async function reveal(pi: ExtensionAPI, path: string): Promise<void> {
  const result =
    process.platform === "darwin"
      ? await pi.exec("open", ["-R", path])
      : await pi.exec("xdg-open", [dirname(path)]);
  if (result.code !== 0)
    throw new Error(result.stderr.trim() || `Failed to reveal ${path}`);
}

async function openEditor(
  pi: ExtensionAPI,
  match: FileMatch,
  cwd: string,
): Promise<void> {
  const editor = resolveEditorCommand();
  if (!editor) throw new Error("Neither Zed nor VS Code was found");
  const path = absolutePath(cwd, match);
  const positioned = match.line
    ? `${path}:${match.line}:${match.column ?? 1}`
    : path;
  const args = editor.kind === "vscode" ? ["--goto", positioned] : [positioned];
  const result = await pi.exec(editor.path, args);
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || `Failed to open ${path} in ${editor.label}`,
    );
  }
}

function paneIdFromJson(
  stdout: string,
  key: "current" | "split",
): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as Record<string, any>;
    return key === "current"
      ? parsed?.result?.pane?.pane_id
      : parsed?.result?.pane?.pane_id;
  } catch {
    return undefined;
  }
}

async function openHerdrPane(
  pi: ExtensionAPI,
  cwd: string,
  command: "bat" | "nvim",
  path: string,
  line?: number,
): Promise<void> {
  if (process.env.HERDR_ENV !== "1")
    throw new Error(`${command} panes require Pi to be running inside Herdr`);
  const resolvedCommand: "bat" | "cat" | "nvim" | "vim" =
    command === "bat"
      ? commandPath("bat")
        ? "bat"
        : "cat"
      : commandPath("nvim")
        ? "nvim"
        : "vim";
  const binary = commandPath(resolvedCommand);
  if (!binary) {
    throw new Error(
      command === "bat"
        ? "Neither bat nor cat was found in PATH"
        : "Neither nvim nor vim was found in PATH",
    );
  }
  const current = await pi.exec("herdr", ["pane", "current"], {
    timeout: 5_000,
  });
  const currentPane = paneIdFromJson(current.stdout, "current");
  if (current.code !== 0 || !currentPane)
    throw new Error("Could not resolve the current Herdr pane");
  const split = await pi.exec(
    "herdr",
    ["pane", "split", currentPane, "--direction", "right", "--focus"],
    { timeout: 5_000 },
  );
  const pane = paneIdFromJson(split.stdout, "split");
  if (split.code !== 0 || !pane)
    throw new Error(split.stderr.trim() || "Could not create a Herdr pane");
  const invocation =
    resolvedCommand === "bat"
      ? `cd ${shellQuote(cwd)} && ${shellQuote(binary)} --paging=always${line ? ` --highlight-line ${line}` : ""} -- ${shellQuote(path)}`
      : resolvedCommand === "cat"
        ? `cd ${shellQuote(cwd)} && ${shellQuote(binary)} -- ${shellQuote(path)}`
        : `cd ${shellQuote(cwd)} && ${shellQuote(binary)}${line ? ` +${line}` : ""} -- ${shellQuote(path)}`;
  const run = await pi.exec("herdr", ["pane", "run", pane, invocation], {
    timeout: 5_000,
  });
  if (run.code !== 0) {
    await pi.exec("herdr", ["pane", "close", pane], { timeout: 5_000 });
    throw new Error(
      run.stderr.trim() || `Could not start ${resolvedCommand} in Herdr`,
    );
  }
}

async function openDiff(
  pi: ExtensionAPI,
  cwd: string,
  path: string,
): Promise<void> {
  const editor = resolveEditorCommand();
  if (!editor) throw new Error("Neither Zed nor VS Code was found");
  const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
    cwd,
  });
  if (rootResult.code !== 0)
    throw new Error("The selected file is not in a Git repository");
  const root = rootResult.stdout.trim();
  const relativePath = relative(root, path).split(sep).join("/");
  if (!relativePath || relativePath.startsWith("../"))
    throw new Error("The selected file is outside the Git repository");
  const tracked = await pi.exec(
    "git",
    ["cat-file", "-e", `HEAD:${relativePath}`],
    { cwd: root },
  );
  if (tracked.code !== 0)
    throw new Error("The selected file does not exist in HEAD");
  const original = await pi.exec("git", ["show", `HEAD:${relativePath}`], {
    cwd: root,
  });
  if (original.code !== 0)
    throw new Error(
      original.stderr.trim() || "Could not read the HEAD version",
    );
  const directory = await mkdtemp(join(tmpdir(), "pi-file-manager-"));
  const headPath = join(directory, `HEAD-${basename(path)}`);
  await writeFile(headPath, original.stdout, "utf8");
  const opened = await pi.exec(editor.path, ["--diff", headPath, path]);
  if (opened.code !== 0) {
    throw new Error(
      opened.stderr.trim() || `Could not open the ${editor.label} diff`,
    );
  }
}

export async function performAction(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  action: FileAction,
  match: FileMatch,
): Promise<void> {
  const path = absolutePath(ctx.cwd, match);
  if (action === "copy") return copyPath(pi, ctx, path);
  if (action === "reveal") return reveal(pi, path);
  if (action === "zed") return openEditor(pi, match, ctx.cwd);
  if (action === "bat" || action === "nvim")
    return openHerdrPane(pi, ctx.cwd, action, path, match.line);
  return openDiff(pi, ctx.cwd, path);
}
