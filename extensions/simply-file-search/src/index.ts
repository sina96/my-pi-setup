import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { constants, accessSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { Type } from "typebox";

const FILE_CANDIDATE_LIMIT = 20_000;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const COMMAND_TIMEOUT_MS = 30_000;
const FZF_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

type ToolName = "fd" | "rg" | "fzf";
type BinaryMap = Record<ToolName, string | undefined>;

interface SearchDetails {
  engine: string;
  resultCount: number;
  truncated: boolean;
  fullOutputPath?: string;
}

function findExecutable(name: ToolName): string | undefined {
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const directory of (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension.toLowerCase()}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Try the next PATH entry.
      }
    }
  }
  return undefined;
}

function normalizePath(path: string | undefined): string {
  if (!path) return ".";
  return path.startsWith("@") ? path.slice(1) : path;
}

function takeLines(output: string, limit: number): string {
  return output.split("\n").filter(Boolean).slice(0, limit).join("\n");
}

async function formatResult(
  output: string,
  engine: string,
): Promise<{ text: string; details: SearchDetails }> {
  const normalized = output.trimEnd();
  const resultCount = normalized ? normalized.split("\n").length : 0;
  const truncation = truncateHead(normalized, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  const details: SearchDetails = {
    engine,
    resultCount,
    truncated: truncation.truncated,
  };
  let text = truncation.content;

  if (truncation.truncated) {
    const directory = await mkdtemp(join(tmpdir(), "pi-simply-search-"));
    const fullOutputPath = join(directory, "output.txt");
    await writeFile(fullOutputPath, normalized, "utf8");
    details.fullOutputPath = fullOutputPath;
    text += `\n\n[Output truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. Full output: ${fullOutputPath}]`;
  }

  return { text, details };
}

function runFilter(
  command: string,
  args: string[],
  input: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const finish = (error?: Error, code = 1) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else
        resolve({
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          code,
        });
    };
    const abort = () => {
      child.kill("SIGTERM");
      finish(new Error("fzf search was cancelled"));
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("fzf search timed out"));
    }, COMMAND_TIMEOUT_MS);

    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => finish(error));
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > FZF_MAX_OUTPUT_BYTES) {
        child.kill("SIGTERM");
        finish(new Error("fzf output exceeded 10MB"));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("close", (code) => finish(undefined, code ?? 1));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export default function simplyFileSearch(pi: ExtensionAPI) {
  const binaries: BinaryMap = {
    fd: findExecutable("fd"),
    rg: findExecutable("rg"),
    fzf: findExecutable("fzf"),
  };

  if (binaries.fd) {
    pi.registerTool({
      name: "simply_find",
      label: "fd",
      description:
        "Find files with fd. When fzf is available, non-empty queries are fuzzy-ranked through fzf. Prefer this over the built-in find tool; fall back to find if this tool is unavailable or errors. Results are limited to 500 entries and 50KB.",
      promptSnippet:
        "Find files quickly with fd and optional fzf fuzzy ranking",
      promptGuidelines: [
        "Prefer simply_find over the built-in find tool for file discovery when simply_find is available; use find as the fallback.",
        "Avoid invoking find inside bash when simply_find is available. If file discovery must stay inside a compound shell command, use fd directly instead.",
      ],
      parameters: Type.Object({
        query: Type.Optional(
          Type.String({
            description:
              "File-name query. Fuzzy when fzf is available; fd regex otherwise.",
          }),
        ),
        path: Type.Optional(
          Type.String({
            description:
              "Directory to search, relative to the working directory",
          }),
        ),
        type: Type.Optional(
          StringEnum(["file", "directory", "symlink"] as const),
        ),
        extension: Type.Optional(
          Type.String({
            description:
              "Restrict to a file extension, without the leading dot",
          }),
        ),
        hidden: Type.Optional(
          Type.Boolean({
            description: "Include hidden paths (still excludes .git)",
          }),
        ),
        limit: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: MAX_LIMIT,
            description: "Maximum results",
          }),
        ),
      }),
      async execute(_id, params, signal, _update, ctx) {
        const limit = params.limit ?? DEFAULT_LIMIT;
        const path = normalizePath(params.path);
        const useFzf = Boolean(binaries.fzf && params.query?.trim());
        const args = ["--color", "never", "--exclude", ".git"];
        if (params.hidden) args.push("--hidden");
        if (params.type)
          args.push(
            "--type",
            params.type === "directory"
              ? "d"
              : params.type === "symlink"
                ? "l"
                : "f",
          );
        if (params.extension)
          args.push("--extension", params.extension.replace(/^\./, ""));
        args.push(
          "--max-results",
          String(useFzf ? FILE_CANDIDATE_LIMIT : limit),
        );
        args.push(useFzf ? "." : params.query?.trim() || ".", path);

        const found = await pi.exec(binaries.fd!, args, {
          cwd: ctx.cwd,
          signal,
          timeout: COMMAND_TIMEOUT_MS,
        });
        if (found.code !== 0)
          throw new Error(
            found.stderr.trim() || `fd exited with code ${found.code}`,
          );

        let output = found.stdout;
        let engine = "fd";
        if (useFzf) {
          const filtered = await runFilter(
            binaries.fzf!,
            ["--filter", params.query!.trim()],
            output,
            ctx.cwd,
            signal,
          );
          if (filtered.code !== 0 && filtered.code !== 1) {
            throw new Error(
              filtered.stderr.trim() || `fzf exited with code ${filtered.code}`,
            );
          }
          output = filtered.stdout;
          engine = "fzf";
        }

        output = takeLines(output, limit);
        if (!output)
          return {
            content: [{ type: "text", text: "No files found" }],
            details: { engine, resultCount: 0, truncated: false },
          };
        const formatted = await formatResult(output, engine);
        return {
          content: [{ type: "text", text: formatted.text }],
          details: formatted.details,
        };
      },
      renderCall(args, theme) {
        const query = args.query ? ` “${args.query}”` : "";
        const path = args.path ? ` in ${args.path}` : "";
        const engine = binaries.fzf && args.query?.trim() ? "fzf" : "fd";
        return new Text(
          theme.fg("toolTitle", theme.bold(engine)) +
            theme.fg("accent", query) +
            theme.fg("muted", path),
          0,
          0,
        );
      },
      renderResult(result, { isPartial }, theme) {
        if (isPartial)
          return new Text(theme.fg("warning", "Searching files..."), 0, 0);
        const details = result.details as SearchDetails | undefined;
        if (!details?.resultCount)
          return new Text(theme.fg("dim", "No files found"), 0, 0);
        return new Text(
          theme.fg("success", `${details.resultCount} results`) +
            theme.fg("dim", ` via ${details.engine}`),
          0,
          0,
        );
      },
    });
  }

  if (binaries.rg) {
    pi.registerTool({
      name: "simply_grep",
      label: "rg",
      description:
        "Search file contents with ripgrep. Prefer this over the built-in grep tool; fall back to grep if this tool is unavailable or errors. Results are limited to 500 lines and 50KB.",
      promptSnippet: "Search file contents quickly with ripgrep",
      promptGuidelines: [
        "Prefer simply_grep over the built-in grep tool for content search when simply_grep is available; use grep as the fallback.",
        "Avoid invoking grep inside bash when simply_grep is available. If content search must stay inside a compound shell command, use rg directly instead.",
      ],
      parameters: Type.Object({
        pattern: Type.String({
          description: "Text or regular expression to search for",
        }),
        path: Type.Optional(
          Type.String({ description: "File or directory to search" }),
        ),
        glob: Type.Optional(
          Type.String({
            description:
              "Include/exclude glob accepted by rg, such as *.ts or !dist/**",
          }),
        ),
        fixed_strings: Type.Optional(
          Type.Boolean({ description: "Treat pattern as literal text" }),
        ),
        ignore_case: Type.Optional(
          Type.Boolean({ description: "Force case-insensitive search" }),
        ),
        hidden: Type.Optional(
          Type.Boolean({
            description: "Search hidden paths (still excludes .git)",
          }),
        ),
        context: Type.Optional(
          Type.Integer({
            minimum: 0,
            maximum: 10,
            description: "Context lines around matches",
          }),
        ),
        limit: Type.Optional(
          Type.Integer({
            minimum: 1,
            maximum: MAX_LIMIT,
            description: "Maximum output lines",
          }),
        ),
      }),
      async execute(_id, params, signal, _update, ctx) {
        const limit = params.limit ?? DEFAULT_LIMIT;
        const args = [
          "--line-number",
          "--column",
          "--no-heading",
          "--color",
          "never",
          "--glob",
          "!.git/**",
        ];
        if (params.glob) args.push("--glob", params.glob);
        if (params.fixed_strings) args.push("--fixed-strings");
        if (params.ignore_case) args.push("--ignore-case");
        else args.push("--smart-case");
        if (params.hidden) args.push("--hidden");
        if (params.context !== undefined)
          args.push("--context", String(params.context));
        args.push("--", params.pattern, normalizePath(params.path));

        const searched = await pi.exec(binaries.rg!, args, {
          cwd: ctx.cwd,
          signal,
          timeout: COMMAND_TIMEOUT_MS,
        });
        if (searched.code === 1)
          return {
            content: [{ type: "text", text: "No matches found" }],
            details: { engine: "rg", resultCount: 0, truncated: false },
          };
        if (searched.code !== 0)
          throw new Error(
            searched.stderr.trim() || `rg exited with code ${searched.code}`,
          );

        const output = takeLines(searched.stdout, limit);
        if (!output)
          return {
            content: [{ type: "text", text: "No matches found" }],
            details: { engine: "rg", resultCount: 0, truncated: false },
          };
        const formatted = await formatResult(output, "rg");
        return {
          content: [{ type: "text", text: formatted.text }],
          details: formatted.details,
        };
      },
      renderCall(args, theme) {
        const path = args.path ? ` in ${args.path}` : "";
        return new Text(
          theme.fg("toolTitle", theme.bold("rg ")) +
            theme.fg("accent", `“${args.pattern}”`) +
            theme.fg("muted", path),
          0,
          0,
        );
      },
      renderResult(result, { isPartial }, theme) {
        if (isPartial)
          return new Text(theme.fg("warning", "Searching content..."), 0, 0);
        const details = result.details as SearchDetails | undefined;
        if (!details?.resultCount)
          return new Text(theme.fg("dim", "No matches found"), 0, 0);
        return new Text(
          theme.fg("success", `${details.resultCount} output lines`) +
            theme.fg("dim", " via rg"),
          0,
          0,
        );
      },
    });
  }

  pi.registerCommand("simply-file-search-health", {
    description: "Show which optional search binaries and tools are active",
    handler: async (_args, ctx) => {
      const status = (["fd", "rg", "fzf"] as const)
        .map((name) => `${name}: ${binaries[name] ?? "not found"}`)
        .join("\n");
      ctx.ui.notify(status, binaries.fd || binaries.rg ? "info" : "warning");
    },
  });
}
