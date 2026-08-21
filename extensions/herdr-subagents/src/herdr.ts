import { createConnection, type Socket } from "node:net";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface PaneRecord {
  pane_id?: unknown;
  label?: unknown;
  title?: unknown;
  pane_label?: unknown;
}

function parseJson(output: string, operation: string): Record<string, unknown> {
  try {
    return JSON.parse(output) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Unexpected Herdr ${operation} output: ${output.trim() || "(empty)"}`,
    );
  }
}

function rootPaneId(output: string): string {
  const parsed = parseJson(output, "tab create");
  const result = parsed.result as
    { root_pane?: { pane_id?: unknown } } | undefined;
  const id = result?.root_pane?.pane_id;
  if (typeof id !== "string" || !id)
    throw new Error("Herdr tab create returned no root pane id");
  return id;
}

function paneRecords(output: string): PaneRecord[] {
  const parsed = parseJson(output, "pane list");
  const result = parsed.result as { panes?: unknown } | undefined;
  return Array.isArray(result?.panes) ? (result.panes as PaneRecord[]) : [];
}

function recordLabel(record: PaneRecord): string | undefined {
  for (const value of [record.label, record.title, record.pane_label]) {
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

export function assertHerdrEnvironment(): void {
  if (process.env.HERDR_ENV !== "1") {
    throw new Error(
      "herdr-subagents requires Pi to be running inside Herdr (HERDR_ENV=1)",
    );
  }
}

export async function checkHerdr(pi: ExtensionAPI): Promise<void> {
  assertHerdrEnvironment();
  const result = await pi.exec("herdr", ["pane", "current"], {
    timeout: 5_000,
  });
  if (result.code !== 0)
    throw new Error(
      `Herdr is unavailable: ${result.stderr.trim() || result.stdout.trim()}`,
    );
}

async function workspaceId(pi: ExtensionAPI): Promise<string> {
  if (process.env.HERDR_WORKSPACE_ID) return process.env.HERDR_WORKSPACE_ID;
  const current = await pi.exec("herdr", ["pane", "current"], {
    timeout: 5_000,
  });
  if (current.code !== 0)
    throw new Error(
      current.stderr.trim() ||
        "Unable to determine the current Herdr workspace",
    );
  const parsed = parseJson(current.stdout, "pane current");
  const pane = (
    parsed.result as { pane?: { workspace_id?: unknown } } | undefined
  )?.pane;
  if (typeof pane?.workspace_id !== "string" || !pane.workspace_id) {
    throw new Error("Herdr pane current returned no workspace id");
  }
  return pane.workspace_id;
}

export async function createTab(
  pi: ExtensionAPI,
  label: string,
  cwd: string,
): Promise<string> {
  await checkHerdr(pi);
  const workspace = await workspaceId(pi);
  const created = await pi.exec(
    "herdr",
    [
      "tab",
      "create",
      "--workspace",
      workspace,
      "--label",
      label,
      "--cwd",
      cwd,
      "--no-focus",
    ],
    { timeout: 10_000 },
  );
  if (created.code !== 0)
    throw new Error(
      `Failed to create Herdr tab: ${created.stderr.trim() || created.stdout.trim()}`,
    );
  const paneId = rootPaneId(created.stdout);
  await pi.exec("herdr", ["pane", "rename", paneId, label], { timeout: 5_000 });
  return paneId;
}

/**
 * Herdr's compact public IDs can change as panes close. Prefer resolving a
 * run by its unique pane label before operating on a cached ID.
 */
export async function resolvePaneId(
  pi: ExtensionAPI,
  cachedId: string,
  uniqueLabel: string,
): Promise<string | undefined> {
  const listed = await pi.exec("herdr", ["pane", "list"], { timeout: 5_000 });
  if (listed.code === 0) {
    const records = paneRecords(listed.stdout);
    const labelled = records.find(
      (record) => recordLabel(record) === uniqueLabel,
    );
    if (typeof labelled?.pane_id === "string") return labelled.pane_id;
    if (records.some((record) => record.pane_id === cachedId)) return cachedId;
  }

  const current = await pi.exec("herdr", ["pane", "get", cachedId], {
    timeout: 5_000,
  });
  return current.code === 0 ? cachedId : undefined;
}

export async function runInPane(
  pi: ExtensionAPI,
  paneId: string,
  command: string,
): Promise<void> {
  const result = await pi.exec("herdr", ["pane", "run", paneId, command], {
    timeout: 5_000,
  });
  if (result.code !== 0)
    throw new Error(
      `Failed to start subagent: ${result.stderr.trim() || result.stdout.trim()}`,
    );
}

export async function interruptPane(
  pi: ExtensionAPI,
  paneId: string,
): Promise<void> {
  const result = await pi.exec(
    "herdr",
    ["pane", "send-keys", paneId, "Escape"],
    { timeout: 5_000 },
  );
  if (result.code !== 0)
    throw new Error(
      `Failed to interrupt subagent: ${result.stderr.trim() || result.stdout.trim()}`,
    );
}

export async function closePane(
  pi: ExtensionAPI,
  paneId: string,
): Promise<void> {
  const result = await pi.exec("herdr", ["pane", "close", paneId], {
    timeout: 5_000,
  });
  if (
    result.code !== 0 &&
    !/not[_ ]found/i.test(`${result.stderr}\n${result.stdout}`)
  ) {
    throw new Error(
      `Failed to close subagent pane: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

export interface PaneAgentStatusEvent {
  paneId: string;
  status: "idle" | "working" | "blocked" | "done" | "unknown";
}

type LifecycleListener = (event: PaneAgentStatusEvent) => void;

/**
 * A small persistent client for Herdr's public `events.subscribe` socket API.
 * The protocol is newline-delimited JSON; subscriptions are replaced by
 * reconnecting when the tracked pane set changes.
 */
export class HerdrLifecycleWatcher {
  private socket?: Socket;
  private retry?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private paneIds: string[] = [];
  private buffer = "";

  constructor(
    private readonly socketPath: string | undefined,
    private readonly listener: LifecycleListener,
  ) {}

  start(paneIds: Iterable<string>): void {
    this.stopped = false;
    this.update(paneIds);
  }

  update(paneIds: Iterable<string>): void {
    const next = [...new Set(paneIds)].sort();
    if (next.join("\u0000") === this.paneIds.join("\u0000") && this.socket)
      return;
    this.paneIds = next;
    this.disconnect();
    if (this.paneIds.length) this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.paneIds = [];
    this.disconnect();
  }

  private connect(): void {
    if (this.stopped || !this.socketPath || this.socket || !this.paneIds.length)
      return;
    this.buffer = "";
    const socket = createConnection(this.socketPath);
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      const subscriptions = this.paneIds.map((pane_id) => ({
        type: "pane.agent_status_changed",
        pane_id,
      }));
      socket.write(
        `${JSON.stringify({
          id: `herdr-subagents-${Date.now()}`,
          method: "events.subscribe",
          params: { subscriptions },
        })}\n`,
      );
    });
    socket.on("data", (chunk: string) => this.receive(chunk));
    socket.on("error", () => undefined);
    socket.on("close", () => {
      // A replaced socket may close after its successor has connected. Its
      // partial frame was discarded by disconnect(), so never clear the new
      // socket's buffer here.
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.buffer = "";
      if (!this.stopped && this.paneIds.length) this.scheduleReconnect();
    });
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      try {
        const event = JSON.parse(line) as {
          event?: unknown;
          data?: { pane_id?: unknown; agent_status?: unknown };
        };
        if (
          event.event === "pane.agent_status_changed" &&
          typeof event.data?.pane_id === "string" &&
          typeof event.data.agent_status === "string" &&
          ["idle", "working", "blocked", "done", "unknown"].includes(
            event.data.agent_status,
          )
        ) {
          this.listener({
            paneId: event.data.pane_id,
            status: event.data.agent_status as PaneAgentStatusEvent["status"],
          });
        }
      } catch {
        // Ignore malformed socket frames and retain the polling fallback.
      }
    }
  }

  private disconnect(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.buffer = "";
    socket?.destroy();
  }

  private scheduleReconnect(): void {
    if (this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.connect();
    }, 2_000);
    this.retry.unref?.();
  }
}

export const __test = { parseJson, rootPaneId, paneRecords, recordLabel };
