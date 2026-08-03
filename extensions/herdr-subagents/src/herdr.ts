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

export const __test = { parseJson, rootPaneId, paneRecords, recordLabel };
