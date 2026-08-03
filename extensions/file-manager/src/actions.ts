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

function zedBinary(): string | undefined {
  const fromPath = process.env.PATH?.split(delimiter)
    .map((directory) => join(directory, "zed"))
    .find(executable);
  if (fromPath) return fromPath;
  const macCli = "/Applications/Zed.app/Contents/MacOS/cli";
  return executable(macCli) ? macCli : undefined;
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

async function openZed(
  pi: ExtensionAPI,
  match: FileMatch,
  cwd: string,
): Promise<void> {
  const zed = zedBinary();
  if (!zed)
    throw new Error(
      "Zed CLI was not found (install the `zed` command or Zed.app)",
    );
  const path = absolutePath(cwd, match);
  const positioned = match.line
    ? `${path}:${match.line}:${match.column ?? 1}`
    : path;
  const result = await pi.exec(zed, [positioned]);
  if (result.code !== 0)
    throw new Error(result.stderr.trim() || `Failed to open ${path} in Zed`);
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
    command === "bat"
      ? `cd ${shellQuote(cwd)} && bat --paging=always${line ? ` --highlight-line ${line}` : ""} -- ${shellQuote(path)}`
      : `cd ${shellQuote(cwd)} && nvim${line ? ` +${line}` : ""} -- ${shellQuote(path)}`;
  const run = await pi.exec("herdr", ["pane", "run", pane, invocation], {
    timeout: 5_000,
  });
  if (run.code !== 0) {
    await pi.exec("herdr", ["pane", "close", pane], { timeout: 5_000 });
    throw new Error(run.stderr.trim() || `Could not start ${command} in Herdr`);
  }
}

async function openDiff(
  pi: ExtensionAPI,
  cwd: string,
  path: string,
): Promise<void> {
  const zed = zedBinary();
  if (!zed)
    throw new Error(
      "Zed CLI was not found (install the `zed` command or Zed.app)",
    );
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
  const opened = await pi.exec(zed, ["--diff", headPath, path]);
  if (opened.code !== 0)
    throw new Error(opened.stderr.trim() || "Could not open the Zed diff");
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
  if (action === "zed") return openZed(pi, match, ctx.cwd);
  if (action === "bat" || action === "nvim")
    return openHerdrPane(pi, ctx.cwd, action, path, match.line);
  return openDiff(pi, ctx.cwd, path);
}
