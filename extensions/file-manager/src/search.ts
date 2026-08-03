import { constants, accessSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type SearchMode = "files" | "content";

export interface FileMatch {
  path: string;
  line?: number;
  column?: number;
  preview?: string;
}

export interface SearchBinaries {
  fd?: string;
  rg?: string;
  fzf?: string;
}

const MAX_FILES = 20_000;
const MAX_MATCHES = 5_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export function findExecutable(name: "fd" | "rg" | "fzf"): string | undefined {
  const suffixes =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  for (const directory of (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)) {
    for (const suffix of suffixes) {
      const candidate = join(directory, `${name}${suffix.toLowerCase()}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Keep looking.
      }
    }
  }
  return undefined;
}

export function discoverBinaries(): SearchBinaries {
  return {
    fd: findExecutable("fd"),
    rg: findExecutable("rg"),
    fzf: findExecutable("fzf"),
  };
}

export async function discoverFiles(
  pi: ExtensionAPI,
  binary: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const result = await pi.exec(
    binary,
    [
      "--type",
      "f",
      "--hidden",
      "--exclude",
      ".git",
      "--color",
      "never",
      "--max-results",
      String(MAX_FILES),
      ".",
      ".",
    ],
    { cwd, signal, timeout: TIMEOUT_MS },
  );
  if (result.code !== 0)
    throw new Error(result.stderr.trim() || `fd exited with ${result.code}`);
  return result.stdout
    .split("\n")
    .map((value) => value.replace(/^\.\//, ""))
    .filter(Boolean);
}

function runWithInput(
  command: string,
  args: string[],
  cwd: string,
  input: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error, code = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else if (code !== 0 && code !== 1)
        reject(
          new Error(
            Buffer.concat(stderr).toString("utf8").trim() ||
              `${command} exited with ${code}`,
          ),
        );
      else resolve(Buffer.concat(stdout).toString("utf8"));
    };
    const abort = () => {
      child.kill("SIGTERM");
      finish(new Error("Search cancelled"));
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("Search timed out"));
    }, TIMEOUT_MS);
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => finish(error));
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        finish(new Error("Search output exceeded 10MB"));
      } else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("close", (code) => finish(undefined, code ?? 1));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export async function fuzzyFiles(
  files: string[],
  query: string,
  binary: string | undefined,
  cwd: string,
  signal?: AbortSignal,
): Promise<FileMatch[]> {
  if (!query.trim()) return files.slice(0, 500).map((path) => ({ path }));
  if (!binary) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return files
      .filter((path) =>
        terms.every((term) => path.toLowerCase().includes(term)),
      )
      .slice(0, 500)
      .map((path) => ({ path }));
  }
  const output = await runWithInput(
    binary,
    ["--filter", query, "--no-color"],
    cwd,
    `${files.join("\n")}\n`,
    signal,
  );
  return output
    .split("\n")
    .filter(Boolean)
    .slice(0, 500)
    .map((path) => ({ path }));
}

export function parseContentMatch(line: string): FileMatch | undefined {
  const match = /^(.*?):(\d+):(\d+):(.*)$/.exec(line);
  if (!match) return undefined;
  return {
    path: match[1],
    line: Number(match[2]),
    column: Number(match[3]),
    preview: match[4].trim(),
  };
}

export async function searchContent(
  query: string,
  binaries: SearchBinaries,
  cwd: string,
  signal?: AbortSignal,
): Promise<FileMatch[]> {
  if (!query.trim() || !binaries.rg) return [];
  const output = await runWithInput(
    binaries.rg,
    [
      "--line-number",
      "--column",
      "--no-heading",
      "--color",
      "never",
      "--smart-case",
      "--hidden",
      "--glob",
      "!.git/**",
      "--",
      query,
      ".",
    ],
    cwd,
    undefined,
    signal,
  );
  const lines = output.split("\n").filter(Boolean).slice(0, MAX_MATCHES);
  const ranked = binaries.fzf
    ? (
        await runWithInput(
          binaries.fzf,
          ["--filter", query, "--no-color"],
          cwd,
          `${lines.join("\n")}\n`,
          signal,
        )
      )
        .split("\n")
        .filter(Boolean)
    : lines;
  return ranked
    .slice(0, 500)
    .map(parseContentMatch)
    .filter((match): match is FileMatch => Boolean(match));
}
