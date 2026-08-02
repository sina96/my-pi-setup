import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export interface StartupCounts {
  models: number;
  contextFiles: number;
  extensions: number;
  skills: number;
  prompts: number;
  mcpServers: number;
}

function readJson(path: string): any | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

function countAvailableModels(ctx: ExtensionContext): number {
  // Match the model set shown by /models: every model from a provider with
  // configured authentication. scopedModels is only the optional cycling scope
  // and is empty when all models are enabled, so it must not drive this count.
  const available = ctx.modelRegistry.getAvailable();
  if (available.length > 0) return available.length;

  // During very early startup the availability snapshot can still be empty.
  // Derive the same set synchronously until the background registry refresh
  // finishes and triggers another dashboard render.
  const configured = ctx.modelRegistry.getAll().filter((model) => ctx.modelRegistry.hasConfiguredAuth(model));
  return configured.length || (ctx.model ? 1 : 0);
}

function countContextFiles(cwd: string): number {
  const files = new Set<string>();
  const global = join(homedir(), ".pi", "agent", "AGENTS.md");
  if (existsSync(global)) files.add(global);

  const ancestors: string[] = [];
  let current = resolve(cwd);
  while (true) {
    ancestors.unshift(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  for (const directory of ancestors) {
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const path = join(directory, name);
      if (existsSync(path)) files.add(path);
    }
  }
  return files.size;
}

function extensionEntries(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const entries: string[] = [];
  try {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      if (item.name.startsWith(".") || item.name === "node_modules") continue;
      const path = join(directory, item.name);
      let isFile = item.isFile();
      let isDirectory = item.isDirectory();
      if (item.isSymbolicLink()) {
        const stat = statSync(path);
        isFile = stat.isFile();
        isDirectory = stat.isDirectory();
      }
      if (isFile && /\.(?:ts|js|mjs|cjs)$/.test(item.name)) {
        entries.push(path);
        continue;
      }
      if (!isDirectory) continue;

      const manifest = readJson(join(path, "package.json"))?.pi?.extensions;
      if (Array.isArray(manifest)) {
        for (const value of manifest) {
          if (typeof value !== "string" || /[*?!+-]/.test(value)) continue;
          const candidate = resolve(path, value);
          if (existsSync(candidate)) entries.push(candidate);
        }
        continue;
      }
      for (const candidate of [join(path, "index.ts"), join(path, "index.js"), join(path, "src", "index.ts")]) {
        if (existsSync(candidate)) {
          entries.push(candidate);
          break;
        }
      }
    }
  } catch {
    return entries;
  }
  return entries;
}

function extensionLabel(path: string): string {
  const file = basename(path).replace(/\.(?:ts|js|mjs|cjs)$/, "");
  if (file !== "index") return file;
  const parent = basename(dirname(path));
  return parent === "src" ? basename(dirname(dirname(path))) : parent;
}

function countExtensions(pi: ExtensionAPI, cwd: string): number {
  const labels = new Set<string>();
  for (const command of pi.getCommands()) {
    if (command.source === "extension" && !command.sourceInfo.path.startsWith("<")) {
      labels.add(extensionLabel(command.sourceInfo.path));
    }
  }
  for (const tool of pi.getAllTools()) {
    if (tool.sourceInfo.source !== "builtin" && tool.sourceInfo.source !== "sdk" && !tool.sourceInfo.path.startsWith("<")) {
      labels.add(extensionLabel(tool.sourceInfo.path));
    }
  }
  for (const directory of [join(homedir(), ".pi", "agent", "extensions"), join(cwd, ".pi", "extensions"), join(cwd, "extensions")]) {
    for (const path of extensionEntries(directory)) labels.add(extensionLabel(path));
  }
  return labels.size;
}

function countMcpServers(): number {
  const config = readJson(join(homedir(), ".pi", "agent", "configs", "mcp.json"));
  return config?.mcpServers && typeof config.mcpServers === "object"
    ? Object.keys(config.mcpServers).length
    : 0;
}

export function discoverCounts(pi: ExtensionAPI, ctx: ExtensionContext): StartupCounts {
  const commands = pi.getCommands();
  return {
    models: countAvailableModels(ctx),
    contextFiles: countContextFiles(ctx.cwd),
    extensions: countExtensions(pi, ctx.cwd),
    skills: new Set(commands.filter((command) => command.source === "skill").map((command) => command.name)).size,
    prompts: new Set(commands.filter((command) => command.source === "prompt").map((command) => command.name)).size,
    mcpServers: countMcpServers(),
  };
}
