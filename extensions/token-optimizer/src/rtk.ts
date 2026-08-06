import { constants, accessSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const RTK_REWRITE_TIMEOUT_MS = 2_000;

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

/** Delegate rewrite decisions to RTK's own registry and fail open on any error. */
export async function rewriteRtkCommand(
  pi: Pick<ExtensionAPI, "exec">,
  rtkPath: string,
  command: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const result = await pi.exec(rtkPath, ["rewrite", command], {
      timeout: RTK_REWRITE_TIMEOUT_MS,
      signal,
    });
    if (result.killed || (result.code !== 0 && result.code !== 3)) return undefined;
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
