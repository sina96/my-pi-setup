import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const MAX_DIFF_BYTES = 10 * 1024 * 1024;

const BLOCKED_OPTIONS = ["--ext-diff", "--textconv", "--output"];

export function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;
  let escaping = false;

  for (const char of input.trim()) {
    if (escaping) {
      token += char;
      escaping = false;
    } else if (char === "\\" && quote !== "'") {
      escaping = true;
    } else if (quote) {
      if (char === quote) quote = undefined;
      else token += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
    } else {
      token += char;
    }
  }

  if (escaping) token += "\\";
  if (quote) throw new Error("Unterminated quote in git diff arguments");
  if (token) tokens.push(token);
  return tokens;
}

export function normalizeDiffArgs(input: string): string[] {
  const args = tokenizeArgs(input);
  const separator = args.indexOf("--");
  return args.map((arg, index) => {
    const isPathspec = separator >= 0 && index > separator;
    const normalized = isPathspec && arg.startsWith("@") ? arg.slice(1) : arg;
    if (
      !isPathspec &&
      BLOCKED_OPTIONS.some(
        (blocked) =>
          normalized === blocked || normalized.startsWith(`${blocked}=`),
      )
    ) {
      throw new Error(`Unsupported git diff option: ${normalized}`);
    }
    return normalized;
  });
}

export async function readGitDiff(
  pi: ExtensionAPI,
  cwd: string,
  input: string,
): Promise<{ text: string; args: string[]; root: string }> {
  const args = normalizeDiffArgs(input);
  const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    timeout: 5_000,
  });
  if (rootResult.code !== 0 || !rootResult.stdout.trim()) {
    throw new Error("Not inside a Git repository");
  }
  const root = rootResult.stdout.trim();
  const result = await pi.exec(
    "git",
    [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--unified=3",
      ...args,
    ],
    { cwd: root, timeout: 20_000 },
  );
  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || `git diff exited with status ${result.code}`,
    );
  }
  if (Buffer.byteLength(result.stdout, "utf8") > MAX_DIFF_BYTES) {
    throw new Error(
      "Diff exceeds 10 MiB; narrow it with a revision range or pathspec",
    );
  }
  return { text: result.stdout, args, root };
}
