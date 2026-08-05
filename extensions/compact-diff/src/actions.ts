import { constants, accessSync } from "node:fs";
import { delimiter, dirname, join, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DiffLine } from "./parser.ts";

export type FileAction = "zed" | "nvim" | "bat" | "reveal" | "copy";

export type FileTarget = {
  path: string;
  absolutePath: string;
  line?: number;
};

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
  const zed =
    findCommand("zed") ??
    (platform === "darwin" &&
    isExecutable("/Applications/Zed.app/Contents/MacOS/cli")
      ? "/Applications/Zed.app/Contents/MacOS/cli"
      : undefined);
  if (zed) return { kind: "zed", path: zed, label: "Zed" };

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
    ...(capabilities.editor
      ? [{ key: "z", action: "zed" as const, label: capabilities.editor.label }]
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
    ...(capabilities.viewer
      ? [
          {
            key: "b",
            action: "bat" as const,
            label: `${capabilities.viewer} pane`,
          },
        ]
      : []),
    { key: "r", action: "reveal", label: "reveal" },
    { key: "y", action: "copy", label: "copy" },
  ];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function paneId(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as {
      result?: { pane?: { pane_id?: unknown } };
    };
    return typeof parsed.result?.pane?.pane_id === "string"
      ? parsed.result.pane.pane_id
      : undefined;
  } catch {
    return undefined;
  }
}

export function targetForLine(
  root: string,
  line: DiffLine,
): FileTarget | undefined {
  if (!line.filePath || line.filePath === "unknown") return undefined;
  const absolutePath = resolve(root, line.filePath);
  const projectPath = relative(root, absolutePath);
  if (projectPath.startsWith("..") || projectPath === "") return undefined;
  return {
    path: projectPath.split(sep).join("/"),
    absolutePath,
    line: line.newLine,
  };
}

async function openHerdr(
  pi: ExtensionAPI,
  root: string,
  action: "nvim" | "bat",
  target: FileTarget,
): Promise<string> {
  if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_PANE_ID) {
    throw new Error(`${action} requires Pi to be running inside Herdr`);
  }
  const resolvedAction: "nvim" | "vim" | "bat" | "cat" =
    action === "nvim"
      ? commandPath("nvim")
        ? "nvim"
        : "vim"
      : commandPath("bat")
        ? "bat"
        : "cat";
  const binary = commandPath(resolvedAction);
  if (!binary) {
    throw new Error(
      action === "bat"
        ? "Neither bat nor cat was found in PATH"
        : "Neither nvim nor vim was found in PATH",
    );
  }
  const split = await pi.exec(
    "herdr",
    [
      "pane",
      "split",
      process.env.HERDR_PANE_ID,
      "--direction",
      "right",
      "--cwd",
      root,
      "--focus",
    ],
    { timeout: 5_000 },
  );
  const createdPane = paneId(split.stdout);
  if (split.code !== 0 || !createdPane) {
    throw new Error(split.stderr.trim() || "Could not create a Herdr pane");
  }

  const command =
    resolvedAction === "nvim" || resolvedAction === "vim"
      ? `${shellQuote(binary)}${target.line ? ` +${target.line}` : ""} -- ${shellQuote(target.absolutePath)}`
      : resolvedAction === "bat"
        ? `${shellQuote(binary)} --paging=always${target.line ? ` --highlight-line ${target.line}` : ""} -- ${shellQuote(target.absolutePath)}`
        : `${shellQuote(binary)} -- ${shellQuote(target.absolutePath)}`;
  const run = await pi.exec("herdr", ["pane", "run", createdPane, command], {
    timeout: 5_000,
  });
  if (run.code !== 0) {
    await pi.exec("herdr", ["pane", "close", createdPane], { timeout: 5_000 });
    throw new Error(run.stderr.trim() || `Could not start ${resolvedAction}`);
  }
  return `Opened ${target.path}${target.line ? `:${target.line}` : ""} in ${resolvedAction}`;
}

export async function performFileAction(
  pi: ExtensionAPI,
  root: string,
  action: FileAction,
  target: FileTarget,
): Promise<string> {
  if (action === "copy") {
    const value = `${target.path}${target.line ? `:${target.line}` : ""}`;
    const clipboard =
      process.platform === "darwin"
        ? "pbcopy"
        : process.env.WAYLAND_DISPLAY
          ? "wl-copy"
          : "xclip -selection clipboard";
    const result = await pi.exec(
      "sh",
      ["-c", `printf %s ${shellQuote(value)} | ${clipboard}`],
      {
        timeout: 5_000,
      },
    );
    if (result.code !== 0)
      throw new Error(result.stderr.trim() || "Could not copy location");
    return `Copied ${value}`;
  }

  try {
    accessSync(target.absolutePath, constants.R_OK);
  } catch {
    throw new Error(`The working-tree file does not exist: ${target.path}`);
  }

  if (action === "nvim" || action === "bat") {
    return openHerdr(pi, root, action, target);
  }
  if (action === "zed") {
    const editor = resolveEditorCommand();
    if (!editor) throw new Error("Neither Zed nor VS Code was found");
    const positioned = target.line
      ? `${target.absolutePath}:${target.line}:1`
      : target.absolutePath;
    const args =
      editor.kind === "vscode" ? ["--goto", positioned] : [positioned];
    const result = await pi.exec(editor.path, args, { timeout: 5_000 });
    if (result.code !== 0) {
      throw new Error(result.stderr.trim() || `Could not open ${editor.label}`);
    }
    return `Opened ${target.path}${target.line ? `:${target.line}` : ""} in ${editor.label}`;
  }
  if (action === "reveal") {
    const result =
      process.platform === "darwin"
        ? await pi.exec("open", ["-R", target.absolutePath], { timeout: 5_000 })
        : await pi.exec("xdg-open", [dirname(target.absolutePath)], {
            timeout: 5_000,
          });
    if (result.code !== 0)
      throw new Error(result.stderr.trim() || "Could not reveal file");
    return `Revealed ${target.path}`;
  }

  throw new Error(`Unsupported file action: ${action}`);
}
