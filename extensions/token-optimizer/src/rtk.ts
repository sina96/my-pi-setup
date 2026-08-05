import { constants, accessSync } from "node:fs";
import { delimiter, join } from "node:path";

const RTK_COMMANDS = new Set([
  "aws",
  "bun",
  "cargo",
  "cat",
  "docker",
  "dotnet",
  "eslint",
  "gh",
  "git",
  "grep",
  "head",
  "jest",
  "kubectl",
  "ls",
  "npm",
  "npx",
  "pnpm",
  "playwright",
  "prettier",
  "prisma",
  "psql",
  "tail",
  "tree",
  "tsc",
  "vitest",
  "wc",
  "yarn",
]);

const OPERATORS = new Set(["&&", "||", ";", "|"]);

export const RTK_PROMPT = `RTK MODE. Prefix supported shell commands with \`rtk\` to reduce tool output tokens (for example, \`rtk git status\`). The extension also rewrites recognized bash command segments defensively. Use RTK's compact output unless exact raw output is required.`;

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function commandPath(
  name: string,
  path = process.env.PATH,
): string | undefined {
  return path
    ?.split(delimiter)
    .map((directory) => join(directory, name))
    .find(executable);
}

/** Split only shell chains we can rewrite without guessing. */
export function splitChain(command: string): string[] | undefined {
  if (command.includes("$(") || command.includes("`")) return undefined;

  const parts: string[] = [];
  let buffer = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let index = 0; index < command.length; index++) {
    const character = command[index]!;
    const next = command[index + 1];

    if (escaped) {
      buffer += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      buffer += character;
      escaped = true;
      continue;
    }
    if (quote) {
      buffer += character;
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      buffer += character;
      continue;
    }
    if (
      (character === "&" && next === "&") ||
      (character === "|" && next === "|")
    ) {
      parts.push(buffer, character + next);
      buffer = "";
      index++;
      continue;
    }
    if (character === ";" || character === "|") {
      parts.push(buffer, character);
      buffer = "";
      continue;
    }
    if (character === "&") return undefined;
    buffer += character;
  }

  if (quote || escaped) return undefined;
  parts.push(buffer);
  return parts;
}

export function rewriteRtkChain(command: string): string {
  const parts = splitChain(command);
  if (!parts) return command;

  let changed = false;
  const rewritten = parts.map((part) => {
    if (OPERATORS.has(part.trim())) return part;
    const leading = part.match(/^\s*/)?.[0] ?? "";
    const body = part.slice(leading.length);
    const firstWord = body.split(/\s+/, 1)[0];
    if (!firstWord || firstWord === "rtk" || !RTK_COMMANDS.has(firstWord)) {
      return part;
    }
    changed = true;
    return `${leading}rtk ${body}`;
  });

  return changed ? rewritten.join("") : command;
}
