import { createConnection } from "node:net";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SOURCE = "simply:blocked-state";

type Request = {
  id: string;
  method: "pane.report_agent" | "pane.release_agent";
  params: Record<string, unknown>;
};

function sendRequest(socketPath: string, request: Request): Promise<void> {
  return new Promise((resolve) => {
    let finished = false;
    const socket = createConnection(socketPath);
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      socket.destroy();
      resolve();
    };
    const timeout = setTimeout(finish, 750);
    timeout.unref?.();
    socket.on("error", finish);
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", finish);
    socket.on("end", finish);
  });
}

export default function herdrBlockedState(pi: ExtensionAPI): void {
  const socketPath = process.env.HERDR_SOCKET_PATH;
  const paneId = process.env.HERDR_PANE_ID;
  if (process.env.HERDR_ENV !== "1" || !socketPath || !paneId) return;

  let sequence = Date.now() * 1_000;
  let sessionPath: string | undefined;
  let sessionId: string | undefined;
  const labels: string[] = [];
  let queue = Promise.resolve();

  const enqueue = (request: Request) => {
    queue = queue.then(() => sendRequest(socketPath, request));
  };
  const sessionRef = (): Record<string, unknown> =>
    sessionPath
      ? { agent_session_path: sessionPath }
      : sessionId
        ? { agent_session_id: sessionId }
        : {};
  const request = (
    method: Request["method"],
    params: Record<string, unknown>,
  ): Request => ({
    id: `${SOURCE}:${Date.now()}:${++sequence}`,
    method,
    params: {
      pane_id: paneId,
      source: SOURCE,
      agent: "pi",
      seq: ++sequence,
      ...sessionRef(),
      ...params,
    },
  });

  const publish = () => {
    if (labels.length === 0) {
      enqueue(request("pane.release_agent", {}));
      return;
    }
    enqueue(
      request("pane.report_agent", {
        state: "blocked",
        message: labels[labels.length - 1] ?? "Waiting for user input",
      }),
    );
  };

  pi.events.on("herdr:blocked", (value: unknown) => {
    const data =
      value && typeof value === "object"
        ? (value as { active?: boolean; label?: string })
        : undefined;
    if (data?.active)
      labels.push(data.label?.trim() || "Waiting for user input");
    else if (labels.length > 0) labels.pop();
    publish();
  });

  pi.on("session_start", (_event, ctx) => {
    const file = ctx.sessionManager.getSessionFile();
    sessionPath =
      typeof file === "string" && file.startsWith("/") ? file : undefined;
    const id = ctx.sessionManager.getSessionId();
    sessionId = typeof id === "string" && id ? id : undefined;
  });

  pi.on("session_shutdown", async () => {
    labels.length = 0;
    enqueue(request("pane.release_agent", {}));
    await queue;
  });
}
