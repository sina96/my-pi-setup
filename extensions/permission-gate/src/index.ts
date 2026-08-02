import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface RiskRule {
  label: string;
  pattern: RegExp;
}

const RULES: RiskRule[] = [
  {
    label: "recursive file deletion",
    pattern: /\brm\b[^\n;&|]*(?:\s-[a-z]*r[a-z]*\b|\s--recursive\b)/i,
  },
  {
    label: "privilege escalation",
    pattern: /(?:^|[;&|]\s*|\s)(?:sudo|doas|su)(?:\s|$)/i,
  },
  {
    label: "dangerous permission change",
    pattern: /\b(?:chmod|chown)\b[^\n;&|]*(?:\b777\b|\s-[a-z]*R[a-z]*\b)/i,
  },
  {
    label: "environment or secret exposure",
    pattern: /(?:^|[;&|]\s*|\s)(?:printenv|set)(?:\s|$)|(?:^|[;&|]\s*)env(?:\s|$)/i,
  },
  {
    label: "download piped into a shell",
    pattern: /\b(?:curl|wget)\b[^\n]*(?:\||>)\s*(?:sudo\s+)?(?:ba|z|fi|da)?sh\b/i,
  },
  {
    label: "destructive Git operation",
    pattern: /\bgit\s+(?:reset\s+--hard\b|clean\s+[^\n;&|]*-[a-z]*f|push\s+[^\n;&|]*(?:--force(?:-with-lease)?\b|-f\b)|branch\s+-D\b|checkout\s+--\s+\.|restore\s+\.)/i,
  },
  {
    label: "disk or filesystem operation",
    pattern: /(?:^|[;&|]\s*|\s)(?:mkfs(?:\.\w+)?|fdisk|parted|dd)(?:\s|$)/i,
  },
  {
    label: "system shutdown or reboot",
    pattern: /(?:^|[;&|]\s*|\s)(?:shutdown|reboot|poweroff|halt)(?:\s|$)/i,
  },
  {
    label: "container-wide destructive cleanup",
    pattern: /\b(?:docker|podman)\s+(?:system\s+prune|volume\s+prune|image\s+prune)\b/i,
  },
  {
    label: "package publication",
    pattern: /\b(?:npm|pnpm|yarn)\s+(?:publish|unpublish)\b/i,
  },
];

function stricterReadOnlyGateIsActive(): boolean {
  const globalState = globalThis as Record<string, unknown>;
  const local = globalState.__simplyPlanMode as { mode?: string } | undefined;
  const upstream = globalState.__planMode as { mode?: string } | undefined;
  const review = globalState.__simplyReview as { active?: boolean } | undefined;
  return local?.mode === "plan" || upstream?.mode === "plan" || review?.active === true;
}

function risksFor(command: string): string[] {
  return RULES.filter((rule) => rule.pattern.test(command)).map((rule) => rule.label);
}

export default function permissionGate(pi: ExtensionAPI) {
  const sessionApprovals = new Set<string>();
  let promptQueue: Promise<void> = Promise.resolve();

  async function askPermission(
    ctx: ExtensionContext,
    command: string,
    risks: string[],
  ): Promise<"once" | "session" | "deny"> {
    let release!: () => void;
    const previous = promptQueue;
    promptQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    pi.events.emit("herdr:blocked", { active: true, label: "Waiting for command approval" });
    try {
      const choice = await ctx.ui.select(
        `Permission required · ${risks.join(", ")}\n\n$ ${command}`,
        ["Allow once", "Allow this exact command for this session", "Deny"],
      );
      if (choice === "Allow once") return "once";
      if (choice === "Allow this exact command for this session") return "session";
      return "deny";
    } finally {
      pi.events.emit("herdr:blocked", { active: false });
      release();
    }
  }

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;

    const command = String((event.input as { command?: unknown }).command ?? "").trim();
    if (!command || sessionApprovals.has(command)) return;

    const risks = risksFor(command);
    if (risks.length === 0) return;

    // PLAN mode has its own stricter bash gate and will reject mutations. Avoid
    // asking the user to approve a command that plan-mode will block anyway.
    if (stricterReadOnlyGateIsActive()) return;

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `[permission-gate] Blocked without interactive approval (${risks.join(", ")}): ${command}`,
      };
    }

    const decision = await askPermission(ctx, command, risks);
    if (decision === "session") {
      sessionApprovals.add(command);
      ctx.ui.notify("Exact command allowed for this session", "info");
      return;
    }
    if (decision === "once") return;

    return {
      block: true,
      reason: `[permission-gate] User denied command (${risks.join(", ")}): ${command}`,
    };
  });

  pi.registerCommand("permission-gate", {
    description: "Show permission-gate status or clear session approvals",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (!action || action === "status") {
        ctx.ui.notify(
          `Permission gate active · ${RULES.length} rules · ${sessionApprovals.size} session approval${sessionApprovals.size === 1 ? "" : "s"}`,
          "info",
        );
        return;
      }
      if (action === "clear") {
        sessionApprovals.clear();
        ctx.ui.notify("Permission-gate session approvals cleared", "info");
        return;
      }
      ctx.ui.notify("Usage: /permission-gate [status|clear]", "warning");
    },
  });
}
