import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CONFIG_DIR_NAME,
  DynamicBorder,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  type SelectItem,
  SelectList,
  Text,
} from "@earendil-works/pi-tui";
import {
  compileRule,
  DEFAULT_PATH_RULES,
  DEFAULT_RULES,
  matchingRules,
  pathConcernsForBash,
  pathConcernsForTool,
  SEVERITY_ORDER,
  type PathConcern,
  type RiskRule,
  type Severity,
  type StoredRule,
} from "./policy.ts";

interface RuleConfig {
  disabledRules?: unknown;
  rules?: unknown;
}

interface SessionSettings {
  yoloMode?: boolean;
  rules?: StoredRule[];
}

type RuleScope = "session" | "project" | "global";

const ENTRY_TYPE = "simply-permission-gate-settings";
const GLOBAL_CONFIG_PATH = join(getAgentDir(), "permission-gate.json");

function stricterReadOnlyGateIsActive(): boolean {
  const globalState = globalThis as Record<string, unknown>;
  const local = globalState.__simplyPlanMode as { mode?: string } | undefined;
  const upstream = globalState.__planMode as { mode?: string } | undefined;
  const review = globalState.__simplyReview as { active?: boolean } | undefined;
  return (
    local?.mode === "plan" ||
    upstream?.mode === "plan" ||
    review?.active === true
  );
}

async function readRuleConfig(
  path: string,
  source: "global" | "project",
  ctx: ExtensionContext,
): Promise<RuleConfig | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("top level must be a JSON object");
    }
    return parsed as RuleConfig;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    if (ctx.hasUI) {
      ctx.ui.notify(
        `Could not load ${source} permission-gate config at ${path}: ${(error as Error).message}`,
        "warning",
      );
    }
    return undefined;
  }
}

function applyRuleConfig(
  rules: Map<string, RiskRule>,
  config: RuleConfig | undefined,
  source: "global" | "project",
  errors: string[],
): void {
  if (!config) return;

  if (Array.isArray(config.disabledRules)) {
    for (const id of config.disabledRules) {
      if (typeof id === "string") rules.delete(id);
      else errors.push(`${source} disabledRules entries must be strings`);
    }
  } else if (config.disabledRules !== undefined) {
    errors.push(`${source} disabledRules must be an array`);
  }

  if (Array.isArray(config.rules)) {
    for (const value of config.rules) {
      const result = compileRule(value, source);
      if (result.rule) rules.set(result.rule.id, result.rule);
      else if (result.error) errors.push(`${source}: ${result.error}`);
    }
  } else if (config.rules !== undefined) {
    errors.push(`${source} rules must be an array`);
  }
}

function storedRule(rule: RiskRule): StoredRule {
  return {
    id: rule.id,
    label: rule.label,
    pattern: rule.pattern.source,
    flags: rule.pattern.flags,
    severity: rule.severity,
    operations: rule.operations,
  };
}

async function editRuleFile(
  path: string,
  transform: (rules: unknown[]) => { rules: unknown[]; changed: boolean },
): Promise<boolean> {
  let config: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("top level must be a JSON object");
    }
    config = parsed as Record<string, unknown>;
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }

  if (config.rules !== undefined && !Array.isArray(config.rules)) {
    throw new Error("rules must be an array before it can be edited");
  }

  const existingRules = Array.isArray(config.rules) ? config.rules : [];
  const result = transform(existingRules);
  if (!result.changed) return false;
  config.rules = result.rules;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return true;
}

export default function permissionGate(pi: ExtensionAPI) {
  const sessionApprovals = new Set<string>();
  const sessionRules = new Map<string, RiskRule>();
  let configuredRules = new Map(DEFAULT_RULES.map((rule) => [rule.id, rule]));
  let yoloMode = false;
  let promptQueue: Promise<void> = Promise.resolve();

  function persistSessionSettings(): void {
    pi.appendEntry(ENTRY_TYPE, {
      yoloMode,
      rules: [...sessionRules.values()].map(storedRule),
    } satisfies SessionSettings);
  }

  function restoreSessionSettings(ctx: ExtensionContext): void {
    yoloMode = false;
    sessionRules.clear();

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
      const data = entry.data as SessionSettings | undefined;
      if (typeof data?.yoloMode === "boolean") yoloMode = data.yoloMode;
      if (!Array.isArray(data?.rules)) continue;

      sessionRules.clear();
      for (const value of data.rules) {
        const result = compileRule(value, "session");
        if (result.rule) sessionRules.set(result.rule.id, result.rule);
      }
    }
  }

  async function loadConfiguredRules(ctx: ExtensionContext): Promise<void> {
    const rules = new Map(DEFAULT_RULES.map((rule) => [rule.id, rule]));
    const errors: string[] = [];
    applyRuleConfig(
      rules,
      await readRuleConfig(GLOBAL_CONFIG_PATH, "global", ctx),
      "global",
      errors,
    );

    if (ctx.isProjectTrusted()) {
      const projectPath = join(
        ctx.cwd,
        CONFIG_DIR_NAME,
        "permission-gate.json",
      );
      applyRuleConfig(
        rules,
        await readRuleConfig(projectPath, "project", ctx),
        "project",
        errors,
      );
    }

    configuredRules = rules;
    if (errors.length > 0 && ctx.hasUI) {
      ctx.ui.notify(
        `Permission-gate config warnings:\n${errors.join("\n")}`,
        "warning",
      );
    }
  }

  function allRules(): RiskRule[] {
    const rules = new Map(configuredRules);
    for (const [id, rule] of sessionRules) rules.set(id, rule);
    return [...rules.values()];
  }

  function commandConcerns(command: string): PathConcern[] {
    return matchingRules(command, allRules()).map((rule) => ({
      label: rule.label,
      detail: rule.operations ?? rule.pattern.source,
      severity: rule.severity,
    }));
  }

  function configPathForScope(
    scope: Exclude<RuleScope, "session">,
    ctx: ExtensionContext,
  ): string {
    if (scope === "global") return GLOBAL_CONFIG_PATH;
    if (!ctx.isProjectTrusted()) {
      throw new Error(
        "Project rules can only be changed after this project is trusted",
      );
    }
    return join(ctx.cwd, CONFIG_DIR_NAME, "permission-gate.json");
  }

  async function showRuleList(ctx: ExtensionContext): Promise<void> {
    const scopeFor = (rule: RiskRule): RuleScope =>
      rule.source === "default" ? "global" : rule.source;
    const order: Record<RuleScope, number> = {
      global: 0,
      project: 1,
      session: 2,
    };
    const rules = allRules().sort(
      (left, right) =>
        order[scopeFor(left)] - order[scopeFor(right)] ||
        left.label.localeCompare(right.label),
    );
    const counts = rules.reduce<Record<RuleScope, number>>(
      (result, rule) => {
        result[scopeFor(rule)] += 1;
        return result;
      },
      { global: 0, project: 0, session: 0 },
    );
    const summary = (["global", "project", "session"] as const)
      .filter((scope) => counts[scope] > 0)
      .map((scope) => `${scope}: ${counts[scope]}`)
      .join(" · ");
    const operationText = (rule: RiskRule): string =>
      rule.operations ?? `/${rule.pattern.source}/${rule.pattern.flags}`;
    const labelText = (rule: RiskRule): string =>
      `${rule.severity.toUpperCase().padEnd(9)} │ ${scopeFor(rule).toUpperCase().padEnd(7)} │ ${rule.label}  (${rule.id})`;

    if (!ctx.hasUI) {
      ctx.ui.notify(
        `Permission-gate command rules (${rules.length})\n${summary}\n\n${rules
          .map((rule) => `${labelText(rule)} │ ${operationText(rule)}`)
          .join("\n")}`,
        "info",
      );
      return;
    }

    let selectedId: string | null | undefined;
    if (ctx.mode === "tui") {
      const items: SelectItem[] = rules.map((rule) => ({
        value: rule.id,
        label: labelText(rule),
        description: operationText(rule),
      }));
      selectedId = await ctx.ui.custom<string | null>(
        (tui, theme, _keybindings, done) => {
          const container = new Container();
          container.addChild(
            new DynamicBorder((text: string) => theme.fg("accent", text)),
          );
          container.addChild(
            new Text(
              theme.fg(
                "accent",
                theme.bold(
                  `Permission-gate command rules · ${rules.length} active`,
                ),
              ) +
                "\n" +
                theme.fg("muted", summary),
              1,
              0,
            ),
          );
          const list = new SelectList(
            items,
            Math.min(items.length, 12),
            {
              selectedPrefix: (text) => theme.fg("accent", text),
              selectedText: (text) => theme.fg("accent", text),
              description: (text) => theme.fg("muted", text),
              scrollInfo: (text) => theme.fg("dim", text),
              noMatch: (text) => theme.fg("warning", text),
            },
            { minPrimaryColumnWidth: 34, maxPrimaryColumnWidth: 52 },
          );
          list.onSelect = (item) => done(item.value);
          list.onCancel = () => done(null);
          container.addChild(list);
          container.addChild(
            new Text(
              theme.fg("dim", "↑↓ navigate · enter inspect · esc close"),
              1,
              0,
            ),
          );
          container.addChild(
            new DynamicBorder((text: string) => theme.fg("accent", text)),
          );
          return {
            render: (width: number) => container.render(width),
            invalidate: () => container.invalidate(),
            handleInput: (data: string) => {
              list.handleInput(data);
              tui.requestRender();
            },
          };
        },
      );
    } else {
      const options = rules.map(
        (rule) => `${labelText(rule)} │ ${operationText(rule)}`,
      );
      const selected = await ctx.ui.select(
        `Permission-gate command rules · ${rules.length} active\n${summary}`,
        options,
      );
      selectedId = selected ? rules[options.indexOf(selected)]?.id : undefined;
    }

    const rule = rules.find((candidate) => candidate.id === selectedId);
    if (!rule) return;
    await ctx.ui.select(
      `${rule.label}\n\nSeverity:   ${rule.severity}\nScope:      ${scopeFor(rule)}\nOrigin:     ${rule.source === "default" ? "built-in default" : rule.source}\nID:         ${rule.id}\nOperations: ${operationText(rule)}\nPattern:    /${rule.pattern.source}/${rule.pattern.flags}`,
      ["Close"],
    );
  }

  async function askPermission(
    ctx: ExtensionContext,
    subject: string,
    concerns: PathConcern[],
    allowSessionApproval: boolean,
  ): Promise<"once" | "session" | "deny"> {
    let release!: () => void;
    const previous = promptQueue;
    promptQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    const highest = concerns.reduce<Severity>(
      (result, concern) =>
        SEVERITY_ORDER[concern.severity] > SEVERITY_ORDER[result]
          ? concern.severity
          : result,
      "risky",
    );
    const timeout =
      highest === "critical"
        ? 15_000
        : highest === "dangerous"
          ? 30_000
          : 60_000;
    const labels = concerns.map(
      (concern) => `${concern.severity.toUpperCase()}: ${concern.label}`,
    );
    const choices =
      highest === "critical"
        ? ["Deny", "Allow once"]
        : [
            "Allow once",
            ...(allowSessionApproval
              ? ["Allow this exact command for this session"]
              : []),
            "Deny",
          ];

    pi.events.emit("herdr:blocked", {
      active: true,
      label: `Waiting for ${highest} permission approval`,
    });
    try {
      const title =
        ctx.mode === "tui"
          ? `Permission required\n${labels.join("\n")}\nReview the pending tool call above, then choose.`
          : `Permission required · ${labels.join(", ")}\n\n${subject}`;
      const choice = await ctx.ui.select(title, choices, { timeout });
      if (choice === "Allow once") return "once";
      if (choice === "Allow this exact command for this session")
        return "session";
      return "deny";
    } finally {
      pi.events.emit("herdr:blocked", { active: false });
      release();
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    sessionApprovals.clear();
    restoreSessionSettings(ctx);
    await loadConfiguredRules(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => {
    restoreSessionSettings(ctx);
    await loadConfiguredRules(ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (yoloMode) return;

    const toolName = String(event.toolName);
    const input = event.input as Record<string, unknown>;

    if (toolName !== "bash") {
      const { concerns, info } = pathConcernsForTool(toolName, input);
      for (const message of info) ctx.ui.notify(message, "info");
      if (concerns.length === 0) return;

      const detail = concerns.map((concern) => concern.detail).join(", ");
      if (!ctx.hasUI) {
        return {
          block: true,
          reason: `[permission-gate] Blocked sensitive path access without interactive approval (${detail})`,
        };
      }
      const decision = await askPermission(
        ctx,
        `${toolName}: ${detail}`,
        concerns,
        false,
      );
      if (decision === "once") return;
      return {
        block: true,
        reason: `[permission-gate] User denied sensitive path access (${detail})`,
      };
    }

    const command = String(input.command ?? "").trim();
    if (!command) return;
    const concerns = [
      ...commandConcerns(command),
      ...pathConcernsForBash(command),
    ];
    if (concerns.length === 0) return;

    const highest = concerns.reduce<Severity>(
      (result, concern) =>
        SEVERITY_ORDER[concern.severity] > SEVERITY_ORDER[result]
          ? concern.severity
          : result,
      "risky",
    );
    if (sessionApprovals.has(command) && highest !== "critical") return;

    // PLAN mode has its own stricter bash gate and will reject mutations. Avoid
    // asking the user to approve a command that plan-mode will block anyway.
    if (stricterReadOnlyGateIsActive()) return;

    const labels = concerns.map((concern) => concern.label);
    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `[permission-gate] Blocked without interactive approval (${labels.join(", ")}): ${command}`,
      };
    }

    const decision = await askPermission(ctx, `$ ${command}`, concerns, true);
    if (decision === "session") {
      sessionApprovals.add(command);
      ctx.ui.notify("Exact command allowed for this session", "info");
      return;
    }
    if (decision === "once") return;

    return {
      block: true,
      reason: `[permission-gate] User denied command (${labels.join(", ")}): ${command}`,
    };
  });

  pi.registerCommand("permission-gate", {
    description:
      "Manage permission-gate rules, approvals, and session yolo mode",
    handler: async (args, ctx) => {
      const input = args.trim();
      const [rawAction = "status", ...restParts] = input.split(/\s+/);
      const action = rawAction.toLowerCase();
      const rest = restParts.join(" ");

      if (action === "status") {
        const rules = allRules();
        ctx.ui.notify(
          `Permission gate ${yoloMode ? "DISABLED (yolo mode)" : "active"} · ${rules.length} command rules (${sessionRules.size} session) · ${DEFAULT_PATH_RULES.length} path rules · ${sessionApprovals.size} exact-command approval${sessionApprovals.size === 1 ? "" : "s"}`,
          yoloMode ? "warning" : "info",
        );
        return;
      }

      if (action === "clear") {
        sessionApprovals.clear();
        ctx.ui.notify(
          "Permission-gate exact-command approvals cleared",
          "info",
        );
        return;
      }

      if (action === "yolo-mode") {
        const mode = rest.toLowerCase();
        if (!mode || mode === "on") yoloMode = true;
        else if (mode === "off") yoloMode = false;
        else if (mode !== "status") {
          ctx.ui.notify(
            "Usage: /permission-gate yolo-mode [on|off|status]",
            "warning",
          );
          return;
        }
        persistSessionSettings();
        ctx.ui.notify(
          yoloMode
            ? "YOLO mode enabled for this session branch · permission prompts are disabled"
            : "YOLO mode disabled · permission prompts are active",
          yoloMode ? "warning" : "info",
        );
        return;
      }

      if (action === "rule") {
        if (rest.toLowerCase() === "list") {
          await showRuleList(ctx);
          return;
        }

        const addMatch = rest.match(
          /^add\s+(?:(session|project|global)\s+)?([a-z0-9][a-z0-9._-]*)\s+(.+?)\s+::\s+(.+)$/i,
        );
        if (addMatch) {
          const scope = (addMatch[1]?.toLowerCase() ?? "session") as RuleScope;
          const [, , id, label, pattern] = addMatch;
          const result = compileRule({ id, label, pattern, flags: "i" }, scope);
          if (!result.rule) {
            ctx.ui.notify(result.error ?? "Invalid rule", "warning");
            return;
          }

          if (scope === "session") {
            sessionRules.set(id, result.rule);
            persistSessionSettings();
            ctx.ui.notify(`Session rule added: ${id} · ${label}`, "info");
            return;
          }

          try {
            const path = configPathForScope(scope, ctx);
            const value = storedRule(result.rule);
            await editRuleFile(path, (rules) => ({
              rules: [
                ...rules.filter(
                  (rule) =>
                    !rule ||
                    typeof rule !== "object" ||
                    (rule as { id?: unknown }).id !== id,
                ),
                value,
              ],
              changed: true,
            }));
            await loadConfiguredRules(ctx);
            ctx.ui.notify(
              `${scope === "global" ? "Global" : "Project"} rule saved: ${id}\n${path}`,
              "info",
            );
          } catch (error) {
            ctx.ui.notify(
              `Could not save ${scope} rule: ${(error as Error).message}`,
              "warning",
            );
          }
          return;
        }

        const removeMatch = rest.match(
          /^remove\s+(?:(session|project|global)\s+)?([a-z0-9][a-z0-9._-]*)$/i,
        );
        if (removeMatch) {
          const scope = (removeMatch[1]?.toLowerCase() ??
            "session") as RuleScope;
          const id = removeMatch[2];

          if (scope === "session") {
            if (!sessionRules.delete(id)) {
              ctx.ui.notify(`No session rule named ${id}`, "warning");
              return;
            }
            persistSessionSettings();
            ctx.ui.notify(`Session rule removed: ${id}`, "info");
            return;
          }

          try {
            const path = configPathForScope(scope, ctx);
            const changed = await editRuleFile(path, (rules) => {
              const filtered = rules.filter(
                (rule) =>
                  !rule ||
                  typeof rule !== "object" ||
                  (rule as { id?: unknown }).id !== id,
              );
              return {
                rules: filtered,
                changed: filtered.length !== rules.length,
              };
            });
            if (!changed) {
              ctx.ui.notify(`No ${scope} rule named ${id}`, "warning");
              return;
            }
            await loadConfiguredRules(ctx);
            ctx.ui.notify(
              `${scope === "global" ? "Global" : "Project"} rule removed: ${id}`,
              "info",
            );
          } catch (error) {
            ctx.ui.notify(
              `Could not remove ${scope} rule: ${(error as Error).message}`,
              "warning",
            );
          }
          return;
        }

        ctx.ui.notify(
          "Usage: /permission-gate rule [list|add [session|project|global] <id> <label> :: <regex>|remove [session|project|global] <id>]",
          "warning",
        );
        return;
      }

      ctx.ui.notify(
        "Usage: /permission-gate [status|clear|yolo-mode [on|off|status]|rule ...]",
        "warning",
      );
    },
  });
}
