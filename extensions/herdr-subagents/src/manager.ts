import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  closePane,
  createTab,
  interruptPane,
  resolvePaneId,
  runInPane,
} from "./herdr.ts";
import type { ChildResult, SubagentRun } from "./types.ts";

const MAX_RUNNING = 4;
const MAX_TRACKED = 64;
const POLL_MS = 500;
const RESULT_MAX_CHARS = 24 * 1024;
const RUNTIME_KEY = Symbol.for("simply-herdr-subagents/runtime-v1");

type Deliver = (run: SubagentRun) => void;
type ChangeListener = () => void;

interface SpawnOptions {
  name: string;
  task: string;
  cwd: string;
  provider: string;
  model: string;
  thinking: string;
  trusted: boolean;
  extensionPath: string;
  parentSessionId: string;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function piInvocation(): string[] {
  const script = process.argv[1];
  if (script && existsSync(script)) return [process.execPath, script];
  const executable = process.execPath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return /^(?:node|bun)(?:\.exe)?$/.test(executable)
    ? ["pi"]
    : [process.execPath];
}

function safeName(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "subagent"
  );
}

function artifactRoot(parentSessionId: string, id: string): string {
  const base =
    process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  return join(base, "herdr-subagents", parentSessionId, id);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isTerminal(run: SubagentRun): boolean {
  return run.status === "completed" || run.status === "failed";
}

function boundedOutput(value: string): string {
  if (value.length <= RESULT_MAX_CHARS) return value;
  return `${value.slice(0, RESULT_MAX_CHARS)}\n\n[Result truncated; inspect the child session for the complete transcript.]`;
}

export function resolveTrust(
  parentCwd: string,
  childCwd: string,
  parentTrusted: boolean,
): boolean {
  const rel = relative(resolve(parentCwd), resolve(childCwd));
  return (
    parentTrusted &&
    (rel === "" ||
      (!rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
        rel !== ".." &&
        !isAbsolute(rel)))
  );
}

export class SubagentManager {
  readonly runs = new Map<string, SubagentRun>();
  enabled = false;
  private pi?: ExtensionAPI;
  private ctx?: ExtensionContext;
  private deliver?: Deliver;
  private listeners = new Set<ChangeListener>();
  private pendingDelivery = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  private counter = 0;
  private reserved = 0;

  adopt(pi: ExtensionAPI, ctx: ExtensionContext, deliver: Deliver): void {
    this.pi = pi;
    this.ctx = ctx;
    this.deliver = deliver;
    this.startPolling();
    this.notify();
  }

  detach(): void {
    this.ctx = undefined;
    this.deliver = undefined;
  }

  subscribe(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): SubagentRun[] {
    return [...this.runs.values()].sort((a, b) => a.startedAt - b.startedAt);
  }

  get(id: string): SubagentRun | undefined {
    return this.runs.get(id);
  }

  runningCount(): number {
    return this.list().filter((run) => !isTerminal(run)).length;
  }

  async spawn(options: SpawnOptions): Promise<SubagentRun> {
    if (!this.pi)
      throw new Error("Subagent runtime is not attached to a Pi session");
    if (this.runningCount() + this.reserved >= MAX_RUNNING)
      throw new Error(`At most ${MAX_RUNNING} subagents may run concurrently`);
    this.reserved += 1;
    try {
      if (!options.task.trim())
        throw new Error("Subagent task must not be empty");
      const cwdInfo = await stat(options.cwd).catch(() => undefined);
      if (!cwdInfo?.isDirectory())
        throw new Error(
          `Subagent working directory is not a directory: ${options.cwd}`,
        );

      const id = `sa-${++this.counter}`;
      const token = `${id}-${Math.random().toString(16).slice(2, 10)}`;
      const root = artifactRoot(options.parentSessionId, token);
      const resultPath = join(root, "result.json");
      const exitCodePath = join(root, "exit-code");
      const taskPath = join(root, "task.md");
      const sessionDir = join(root, "session");
      const scriptPath = join(root, "run.sh");
      const paneLabel = `${id} · ${safeName(options.name)} · ${token}`;
      await mkdir(sessionDir, { recursive: true, mode: 0o700 });
      await writeFile(
        taskPath,
        `# Delegated task\n\n${options.task.trim()}\n`,
        { encoding: "utf8", mode: 0o600 },
      );

      const paneId = await createTab(this.pi, paneLabel, options.cwd);
      const args = [
        ...piInvocation(),
        "--provider",
        options.provider,
        "--model",
        options.model,
        "--thinking",
        options.thinking,
        "--session-dir",
        sessionDir,
        "--name",
        `${id} ${options.name}`,
        options.trusted ? "--approve" : "--no-approve",
        "--extension",
        options.extensionPath,
        `@${taskPath}`,
      ];
      const command = [
        "env",
        "PI_HERDR_SUBAGENT_CHILD=1",
        `PI_HERDR_SUBAGENT_ID=${shellQuote(id)}`,
        `PI_HERDR_SUBAGENT_RESULT=${shellQuote(resultPath)}`,
        args.map(shellQuote).join(" "),
      ].join(" ");
      const script = `#!/bin/bash\n${command}\ncode=$?\nprintf '%s\\n' "$code" > ${shellQuote(exitCodePath)}\nexit "$code"\n`;
      await writeFile(scriptPath, script, { encoding: "utf8", mode: 0o700 });

      const run: SubagentRun = {
        id,
        token,
        name: options.name,
        task: options.task,
        cwd: options.cwd,
        paneId,
        paneLabel,
        resultPath,
        exitCodePath,
        sessionDir,
        provider: options.provider,
        model: options.model,
        thinking: options.thinking,
        status: "starting",
        startedAt: Date.now(),
        consumed: false,
        delivered: false,
      };
      this.runs.set(id, run);
      this.prune();
      this.notify();

      try {
        await runInPane(this.pi, paneId, `bash ${shellQuote(scriptPath)}`);
        run.status = "running";
        this.notify();
        return run;
      } catch (error) {
        run.status = "failed";
        run.error = errorMessage(error);
        run.finishedAt = Date.now();
        run.consumed = true;
        await closePane(this.pi, paneId).catch(() => undefined);
        this.settle(run);
        throw error;
      }
    } finally {
      this.reserved -= 1;
    }
  }

  async interrupt(id: string): Promise<SubagentRun> {
    const run = this.require(id);
    if (isTerminal(run)) return run;
    const paneId = await this.currentPane(run);
    if (!paneId || !this.pi)
      throw new Error(`Herdr pane for ${id} no longer exists`);
    await interruptPane(this.pi, paneId);
    run.paneId = paneId;
    run.status = "interrupted";
    this.notify();
    return run;
  }

  async close(id: string, reason = "Closed by user"): Promise<SubagentRun> {
    return this.closeSurface(id, reason);
  }

  async closeSurface(
    id: string,
    reason = "Closed by user",
  ): Promise<SubagentRun> {
    const run = this.require(id);
    if (!run.paneClosed) {
      const paneId = await this.currentPane(run);
      if (paneId && this.pi) await closePane(this.pi, paneId);
      run.paneClosed = true;
    }
    if (!isTerminal(run)) {
      run.status = "failed";
      run.error = reason;
      run.finishedAt = Date.now();
      run.consumed = true;
      this.settle(run);
    } else {
      this.notify();
    }
    return run;
  }

  async focus(id: string): Promise<SubagentRun> {
    const run = this.require(id);
    if (run.paneClosed) throw new Error(`Herdr pane for ${id} is closed`);
    const paneId = await this.currentPane(run);
    if (!paneId || !this.pi)
      throw new Error(`Herdr pane for ${id} no longer exists`);
    const result = await this.pi.exec("herdr", ["agent", "focus", paneId], {
      timeout: 5_000,
    });
    if (result.code !== 0)
      throw new Error(
        `Failed to focus ${id}: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    run.paneId = paneId;
    return run;
  }

  async stopAll(
    reason = "Parent session closed",
    stopPolling = false,
  ): Promise<void> {
    const active = this.list().filter((run) => !isTerminal(run));
    await Promise.all(
      active.map((run) => this.close(run.id, reason).catch(() => undefined)),
    );
    if (stopPolling) this.stopPolling();
  }

  async wait(
    ids: string[],
    signal?: AbortSignal,
    onPending?: (ids: string[]) => void,
  ): Promise<SubagentRun[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0)
      throw new Error("Provide at least one subagent id");
    const previousConsumed = new Map(
      unique.map((id) => [id, this.require(id).consumed]),
    );
    for (const id of unique) this.require(id).consumed = true;

    try {
      for (;;) {
        const pending = unique.filter((id) => !isTerminal(this.require(id)));
        if (pending.length === 0) return unique.map((id) => this.require(id));
        onPending?.(pending);
        await new Promise<void>((resolvePromise, reject) => {
          if (signal?.aborted)
            return reject(new Error("Subagent wait cancelled"));
          const cleanup = () => signal?.removeEventListener("abort", abort);
          const timer = setTimeout(() => {
            cleanup();
            resolvePromise();
          }, 250);
          const abort = () => {
            clearTimeout(timer);
            cleanup();
            reject(new Error("Subagent wait cancelled"));
          };
          signal?.addEventListener("abort", abort, { once: true });
        });
      }
    } catch (error) {
      for (const id of unique) {
        const run = this.require(id);
        run.consumed = previousConsumed.get(id) ?? false;
        if (isTerminal(run) && !run.consumed && !run.delivered)
          this.settle(run);
      }
      throw error;
    }
  }

  reset(): void {
    this.runs.clear();
    this.pendingDelivery.clear();
    this.counter = 0;
    this.reserved = 0;
    this.notify();
  }

  flushDeliveries(): void {
    if (!this.ctx || !this.deliver) return;
    for (const id of [...this.pendingDelivery]) {
      const run = this.runs.get(id);
      this.pendingDelivery.delete(id);
      if (!run || run.consumed || run.delivered) continue;
      run.delivered = true;
      this.deliver(run);
    }
    this.notify();
  }

  private require(id: string): SubagentRun {
    const run = this.runs.get(id);
    if (!run)
      throw new Error(
        `Unknown subagent id: ${id}. Known: ${
          this.list()
            .map((item) => item.id)
            .join(", ") || "none"
        }`,
      );
    return run;
  }

  private async currentPane(run: SubagentRun): Promise<string | undefined> {
    if (!this.pi) return undefined;
    const resolved = await resolvePaneId(this.pi, run.paneId, run.paneLabel);
    if (resolved) run.paneId = resolved;
    return resolved;
  }

  private startPolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref?.();
  }

  private stopPolling(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const run of this.list()) {
        if (isTerminal(run)) continue;
        if (existsSync(run.resultPath)) {
          try {
            const result = JSON.parse(
              await readFile(run.resultPath, "utf8"),
            ) as ChildResult;
            run.status = result.status === "completed" ? "completed" : "failed";
            run.output = boundedOutput(result.output.trim());
            run.error = result.error;
            run.sessionFile = result.sessionFile;
            run.provider = result.provider ?? run.provider;
            run.model = result.model ?? run.model;
            run.thinking = result.thinking ?? run.thinking;
            run.finishedAt = result.finishedAt || Date.now();
            this.settle(run);
            continue;
          } catch {
            // The child publishes atomically; a transient read error can retry.
          }
        }
        if (existsSync(run.exitCodePath)) {
          run.paneMissingSince ??= Date.now();
          if (Date.now() - run.paneMissingSince > 1_000) {
            const code = (
              await readFile(run.exitCodePath, "utf8").catch(
                () => "?" as string,
              )
            ).trim();
            run.status = "failed";
            run.error = `Subagent process exited with code ${code} before publishing a result`;
            run.finishedAt = Date.now();
            this.settle(run);
          }
        }
      }
      this.notify();
    } finally {
      this.ticking = false;
    }
  }

  private settle(run: SubagentRun): void {
    if (!run.consumed && !run.delivered) {
      this.pendingDelivery.add(run.id);
      if (this.ctx?.isIdle()) this.flushDeliveries();
    }
    this.notify();
  }

  private prune(): void {
    if (this.runs.size <= MAX_TRACKED) return;
    for (const run of this.list()) {
      if (this.runs.size <= MAX_TRACKED) break;
      if (isTerminal(run)) this.runs.delete(run.id);
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        /* UI listeners must not break lifecycle state. */
      }
    }
  }
}

export function getManager(): SubagentManager {
  const global = globalThis as Record<PropertyKey, unknown>;
  const existing = global[RUNTIME_KEY] as SubagentManager | undefined;
  // Module classes are recreated by /reload, so instanceof would discard the
  // old watcher registry. Use the small runtime surface as the adoption check.
  if (
    existing &&
    typeof existing.adopt === "function" &&
    typeof existing.list === "function"
  )
    return existing;
  const manager = new SubagentManager();
  global[RUNTIME_KEY] = manager;
  return manager;
}

export const __test = { shellQuote, safeName, boundedOutput };
