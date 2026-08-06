import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export type NodeManager = "pnpm" | "npm" | "yarn" | "bun";
export type PythonManager = "uv" | "poetry" | "pipenv" | "pip" | "pip3";
export type PolicyMode = "enforce" | "warn" | "off";
type NodeChoice = NodeManager | "auto";
type PythonChoice = PythonManager | "auto";

export interface PolicyState {
  version: 1;
  node: NodeChoice;
  python: PythonChoice;
  mode: PolicyMode;
}

export interface ManagerDetection<T extends string> {
  manager?: T;
  source?: string;
  conflict?: T[];
}

export interface ProjectManagers {
  node: ManagerDetection<NodeManager>;
  python: ManagerDetection<PythonManager>;
}

interface EffectiveManager<T extends string> {
  manager?: T;
  source: string;
  conflict?: T[];
}

interface EffectivePolicy {
  node: EffectiveManager<NodeManager>;
  python: EffectiveManager<PythonManager>;
  mode: PolicyMode;
}

export interface ManagerViolation {
  ecosystem: "node" | "python";
  attempted: string;
  selected: string;
  reason: string;
}

const STATE_TYPE = "simply-package-manager-policy-state";
const DEFAULT_STATE: PolicyState = { version: 1, node: "auto", python: "auto", mode: "enforce" };
const DEFAULT_NODE: NodeManager = "pnpm";
const DEFAULT_PYTHON: PythonManager = "uv";
const NODE_MANAGERS = new Set<NodeManager>(["pnpm", "npm", "yarn", "bun"]);
const PYTHON_MANAGERS = new Set<PythonManager>(["uv", "poetry", "pipenv", "pip", "pip3"]);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

async function searchDirectories(cwd: string): Promise<string[]> {
  const directories: string[] = [];
  let current = resolve(cwd);
  while (true) {
    directories.push(current);
    if (await exists(join(current, ".git"))) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return directories;
}

function packageManagerField(value: unknown): NodeManager | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().split("@")[0] as NodeManager;
  return NODE_MANAGERS.has(name) ? name : undefined;
}

async function detectNode(directories: string[]): Promise<ManagerDetection<NodeManager>> {
  for (const directory of directories) {
    const packageJsonPath = join(directory, "package.json");
    const packageJson = await readText(packageJsonPath);
    if (packageJson) {
      try {
        const explicit = packageManagerField(JSON.parse(packageJson).packageManager);
        if (explicit) return { manager: explicit, source: `${packageJsonPath}#packageManager` };
      } catch {
        // Invalid package.json is ignored here; the package manager will report it later.
      }
    }

    const candidates: Array<[NodeManager, string]> = [
      ["pnpm", "pnpm-lock.yaml"],
      ["pnpm", "pnpm-workspace.yaml"],
      ["npm", "package-lock.json"],
      ["npm", "npm-shrinkwrap.json"],
      ["yarn", "yarn.lock"],
      ["bun", "bun.lock"],
      ["bun", "bun.lockb"],
    ];
    const found: Array<[NodeManager, string]> = [];
    for (const candidate of candidates) {
      if (await exists(join(directory, candidate[1]))) found.push(candidate);
    }
    const managers = [...new Set(found.map(([manager]) => manager))];
    if (managers.length === 1) {
      const evidence = found.find(([manager]) => manager === managers[0])!;
      return { manager: managers[0], source: join(directory, evidence[1]) };
    }
    if (managers.length > 1) return { conflict: managers, source: directory };
  }
  return {};
}

async function detectPython(directories: string[]): Promise<ManagerDetection<PythonManager>> {
  for (const directory of directories) {
    const strong: Array<[PythonManager, string]> = [];
    for (const candidate of [
      ["uv", "uv.lock"],
      ["poetry", "poetry.lock"],
      ["pipenv", "Pipfile.lock"],
      ["pipenv", "Pipfile"],
    ] as Array<[PythonManager, string]>) {
      if (await exists(join(directory, candidate[1]))) strong.push(candidate);
    }

    const pyprojectPath = join(directory, "pyproject.toml");
    const pyproject = await readText(pyprojectPath);
    if (pyproject) {
      if (/^\s*\[tool\.uv(?:\.|\])/m.test(pyproject)) strong.push(["uv", "pyproject.toml#tool.uv"]);
      if (/^\s*\[tool\.poetry(?:\.|\])/m.test(pyproject)) strong.push(["poetry", "pyproject.toml#tool.poetry"]);
    }

    const managers = [...new Set(strong.map(([manager]) => manager))];
    if (managers.length === 1) {
      const evidence = strong.find(([manager]) => manager === managers[0])!;
      return { manager: managers[0], source: join(directory, evidence[1]) };
    }
    if (managers.length > 1) return { conflict: managers, source: directory };

    for (const requirements of ["requirements.txt", "requirements-dev.txt"]) {
      if (await exists(join(directory, requirements))) {
        return { manager: "pip", source: join(directory, requirements) };
      }
    }
  }
  return {};
}

export async function detectProjectManagers(cwd: string): Promise<ProjectManagers> {
  const directories = await searchDirectories(cwd);
  const [node, python] = await Promise.all([
    detectNode(directories),
    detectPython(directories),
  ]);
  return { node, python };
}

function effectiveManager<T extends string>(
  choice: T | "auto",
  detection: ManagerDetection<T>,
  fallback: T,
): EffectiveManager<T> {
  if (choice !== "auto") return { manager: choice, source: "session override" };
  if (detection.conflict?.length) {
    return { source: detection.source ?? "project", conflict: detection.conflict };
  }
  if (detection.manager) return { manager: detection.manager, source: detection.source ?? "project" };
  return { manager: fallback, source: "default" };
}

function resolvePolicy(state: PolicyState, detected: ProjectManagers): EffectivePolicy {
  return {
    node: effectiveManager(state.node, detected.node, DEFAULT_NODE),
    python: effectiveManager(state.python, detected.python, DEFAULT_PYTHON),
    mode: state.mode,
  };
}

function shellCommands(command: string, names: readonly string[]): string[] {
  const alternatives = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(
    `(?:^|\\n|;|&&|\\|\\||\\|)\\s*(?:env\\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\\S+\\s+)*(?:sudo\\s+)?(?:rtk\\s+)?(?:\\S+/)?(${alternatives})(?=\\s|$)`,
    "g",
  );
  return [...command.matchAll(pattern)].map((match) => match[1]);
}

function nodeManagerForCommand(command: string): NodeManager {
  if (command === "npm" || command === "npx") return "npm";
  if (command === "pnpm" || command === "pnpx") return "pnpm";
  if (command === "yarn" || command === "yarnpkg") return "yarn";
  return "bun";
}

function pythonManagerForCommand(command: string): PythonManager {
  if (/^pip3(?:\.\d+)?$/.test(command)) return "pip3";
  if (command === "pip") return "pip";
  return command as PythonManager;
}

function replacementHint(ecosystem: "node" | "python", manager: string): string {
  if (ecosystem === "node") {
    if (manager === "pnpm") return "Use pnpm (pnpm add/install/run or pnpm dlx).";
    if (manager === "npm") return "Use npm (npm install/run or npm exec).";
    if (manager === "yarn") return "Use yarn (yarn add/install/run or yarn dlx).";
    return "Use bun (bun add/install/run or bunx).";
  }
  if (manager === "uv") return "Use uv (uv add, uv sync, uv venv, uv run, or uv run --with).";
  if (manager === "poetry") return "Use Poetry (poetry add, install, env, or run).";
  if (manager === "pipenv") return "Use Pipenv (pipenv install, sync, or run).";
  if (manager === "pip3") return "Use the project's pip3/venv workflow.";
  return "Use the project's pip/venv workflow.";
}

export function findManagerViolation(command: string, policy: EffectivePolicy): ManagerViolation | undefined {
  if (policy.mode === "off") return undefined;

  if (policy.node.manager) {
    for (const attempted of shellCommands(command, ["npm", "npx", "pnpm", "pnpx", "yarn", "yarnpkg", "bun", "bunx"])) {
      if (nodeManagerForCommand(attempted) !== policy.node.manager) {
        return {
          ecosystem: "node",
          attempted,
          selected: policy.node.manager,
          reason: `Node uses ${policy.node.manager} (${policy.node.source}). ${replacementHint("node", policy.node.manager)}`,
        };
      }
    }
  }

  if (policy.python.manager) {
    for (const attempted of shellCommands(command, ["pip", "pip3", "pip3.10", "pip3.11", "pip3.12", "pip3.13", "uv", "poetry", "pipenv"])) {
      if (pythonManagerForCommand(attempted) !== policy.python.manager) {
        return {
          ecosystem: "python",
          attempted,
          selected: policy.python.manager,
          reason: `Python uses ${policy.python.manager} (${policy.python.source}). ${replacementHint("python", policy.python.manager)}`,
        };
      }
    }

    if (policy.python.manager !== "pip" && policy.python.manager !== "pip3") {
      const moduleCalls = shellCommands(command, ["python", "python3", "python3.10", "python3.11", "python3.12", "python3.13"]);
      if (moduleCalls.length > 0 && /(?:^|\s)-m\s*(?:pip|venv)\b|(?:^|\s)-m(?:pip|venv)\b/.test(command)) {
        return {
          ecosystem: "python",
          attempted: "python -m pip/venv",
          selected: policy.python.manager,
          reason: `Python uses ${policy.python.manager} (${policy.python.source}). ${replacementHint("python", policy.python.manager)}`,
        };
      }
    }
  }
  return undefined;
}

function validState(value: unknown): value is PolicyState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<PolicyState>;
  return state.version === 1
    && (state.node === "auto" || NODE_MANAGERS.has(state.node as NodeManager))
    && (state.python === "auto" || PYTHON_MANAGERS.has(state.python as PythonManager))
    && (state.mode === "enforce" || state.mode === "warn" || state.mode === "off");
}

export function restorePolicyState(ctx: Pick<ExtensionContext, "sessionManager">): PolicyState {
  let state = { ...DEFAULT_STATE };
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === STATE_TYPE && validState(entry.data)) {
      state = { ...entry.data };
    }
  }
  return state;
}

function describeManager(label: string, manager: EffectiveManager<string>): string {
  if (manager.conflict?.length) return `${label}: unresolved conflict (${manager.conflict.join(", ")}) at ${manager.source}`;
  return `${label}: ${manager.manager} (${manager.source})`;
}

async function policySummary(state: PolicyState, ctx: Pick<ExtensionContext, "cwd">): Promise<string> {
  const policy = resolvePolicy(state, await detectProjectManagers(ctx.cwd));
  return [
    `Package-manager policy: ${policy.mode}`,
    describeManager("Node", policy.node),
    describeManager("Python", policy.python),
    `Session choices: node=${state.node}, python=${state.python}`,
  ].join("\n");
}

export default function packageManagerPolicy(pi: ExtensionAPI): void {
  let state = { ...DEFAULT_STATE };
  const restore = (ctx: ExtensionContext) => { state = restorePolicyState(ctx); };

  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("session_compact", (_event, ctx) => restore(ctx));

  pi.on("before_agent_start", async (event, ctx) => {
    if (state.mode === "off") return;
    const policy = resolvePolicy(state, await detectProjectManagers(ctx.cwd));
    const guidance = [
      "Package-manager policy:",
      `- ${describeManager("Node", policy.node)}`,
      `- ${describeManager("Python", policy.python)}`,
      policy.mode === "enforce"
        ? "Use the selected managers for package, environment, script, and exec commands; conflicting Bash commands are blocked."
        : "Prefer the selected managers; conflicting Bash commands produce warnings.",
    ].join("\n");
    return { systemPrompt: `${event.systemPrompt}\n\n${guidance}` };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash" || state.mode === "off") return;
    const input = event.input as { command?: unknown };
    if (typeof input.command !== "string") return;
    const policy = resolvePolicy(state, await detectProjectManagers(ctx.cwd));
    const violation = findManagerViolation(input.command, policy);
    if (!violation) return;
    const message = `[package-manager-policy] Blocked ${violation.attempted}. ${violation.reason}`;
    if (state.mode === "warn") {
      if (ctx.hasUI) ctx.ui.notify(message.replace("Blocked", "Warning for"), "warning");
      return;
    }
    return { block: true, reason: message };
  });

  const persist = (next: PolicyState) => {
    state = next;
    pi.appendEntry(STATE_TYPE, state);
  };

  pi.registerCommand("package-manager", {
    description: "Show or change session package-manager policy",
    getArgumentCompletions: (prefix) => {
      const values = [
        "node auto", "node pnpm", "node npm", "node yarn", "node bun",
        "python auto", "python uv", "python poetry", "python pipenv", "python pip", "python pip3",
        "mode enforce", "mode warn", "mode off", "reset",
      ];
      const normalized = prefix.trim().toLowerCase();
      const matches = values.filter((value) => value.startsWith(normalized));
      return matches.length ? matches.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx: ExtensionCommandContext) => {
      const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        ctx.ui.notify(await policySummary(state, ctx), "info");
        return;
      }
      if (words.length === 1 && words[0] === "reset") {
        persist({ ...DEFAULT_STATE });
      } else if (words.length === 2 && words[0] === "node" && (words[1] === "auto" || NODE_MANAGERS.has(words[1] as NodeManager))) {
        persist({ ...state, node: words[1] as NodeChoice });
      } else if (words.length === 2 && words[0] === "python" && (words[1] === "auto" || PYTHON_MANAGERS.has(words[1] as PythonManager))) {
        persist({ ...state, python: words[1] as PythonChoice });
      } else if (words.length === 2 && words[0] === "mode" && ["enforce", "warn", "off"].includes(words[1])) {
        persist({ ...state, mode: words[1] as PolicyMode });
      } else {
        ctx.ui.notify("Usage: /package-manager [node MANAGER | python MANAGER | mode enforce|warn|off | reset]", "warning");
        return;
      }
      ctx.ui.notify(await policySummary(state, ctx), "info");
    },
  });
}
