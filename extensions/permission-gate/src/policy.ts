export type Severity = "critical" | "dangerous" | "risky";

export interface RiskRule {
  id: string;
  label: string;
  pattern: RegExp;
  severity: Severity;
  operations?: string;
  source: "default" | "global" | "project" | "session";
}

export interface StoredRule {
  id: string;
  label: string;
  pattern: string;
  flags?: string;
  severity?: Severity;
  operations?: string;
}

export interface PathRule {
  id: string;
  label: string;
  pattern: RegExp;
  severity: "block" | "warn" | "info";
  operations?: ("read" | "write" | "search")[];
}

export interface PathConcern {
  label: string;
  detail: string;
  severity: Severity;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 3,
  dangerous: 2,
  risky: 1,
};

export const DEFAULT_RULES: RiskRule[] = [
  {
    id: "catastrophic-recursive-deletion",
    label: "recursive deletion of filesystem or home root",
    pattern:
      /(?:^|[;&|])\s*(?:rtk\s+)?rm\b[^\n;&|]*(?:\s-[a-z]*r[a-z]*f[a-z]*\b|\s-[a-z]*f[a-z]*r[a-z]*\b|\s--recursive\b[^\n;&|]*\s--force\b|\s--force\b[^\n;&|]*\s--recursive\b)[^\n;&|]*(?:\s\/(?:\*|\.)?|\s(?:~|\$HOME)(?:\/(?:\*|\.)?)?)\s*(?=[;&|]|$)/i,
    severity: "critical",
    operations: "rm -rf /, ~, or $HOME",
    source: "default",
  },
  {
    id: "recursive-file-deletion",
    label: "recursive file deletion",
    pattern:
      /(?:^|[;&|])\s*(?:rtk\s+)?rm\b[^\n;&|]*(?:\s-[a-z]*r[a-z]*\b|\s--recursive\b)/i,
    severity: "dangerous",
    operations: "rm -r, rm -R, rm --recursive",
    source: "default",
  },
  {
    id: "privilege-escalation",
    label: "privilege escalation",
    pattern: /(?:^|[;&|])\s*(?:sudo|doas|su)(?:\s|$)/i,
    severity: "dangerous",
    operations: "sudo, doas, su",
    source: "default",
  },
  {
    id: "dangerous-permission-change",
    label: "dangerous permission change",
    pattern:
      /(?:^|[;&|])\s*(?:rtk\s+)?(?:chmod|chown)\b[^\n;&|]*(?:\b777\b|\s-[a-z]*R[a-z]*\b)/i,
    severity: "dangerous",
    operations: "chmod/chown 777 or recursive",
    source: "default",
  },
  {
    id: "environment-secret-exposure",
    label: "environment or secret exposure",
    pattern: /(?:^|[;&|])\s*(?:(?:env|printenv)(?:\s|$)|set\s*(?=$|[;&|]))/i,
    severity: "dangerous",
    operations: "env, printenv, bare set",
    source: "default",
  },
  {
    id: "download-piped-to-shell",
    label: "download piped into a shell",
    pattern:
      /(?:^|[;&|])\s*(?:rtk\s+)?(?:curl|wget)\b[^\n]*(?:\||>)\s*(?:sudo\s+)?(?:ba|z|fi|da)?sh\b/i,
    severity: "critical",
    operations: "curl/wget piped or redirected to a shell",
    source: "default",
  },
  {
    id: "destructive-git-operation",
    label: "destructive Git operation",
    pattern:
      /(?:^|[;&|])\s*(?:rtk\s+)?git\s+(?:reset\s+--hard\b|clean\s+[^\n;&|]*-[a-z]*f|push\s+[^\n;&|]*(?:--force(?:-with-lease)?\b|-f\b)|branch\s+-D\b|checkout\s+(?:-[a-z]*f|--force|--\s+\.)|restore\s+\.|stash\s+drop\b)/i,
    severity: "dangerous",
    operations:
      "git reset --hard, clean -f, force push, branch -D, forced checkout/restore, stash drop",
    source: "default",
  },
  {
    id: "disk-filesystem-operation",
    label: "filesystem formatting or partitioning",
    pattern:
      /(?:^|[;&|])\s*(?:rtk\s+)?(?:mkfs(?:\.\w+)?|fdisk|parted)(?:\s|$)/i,
    severity: "critical",
    operations: "mkfs, fdisk, parted",
    source: "default",
  },
  {
    id: "raw-disk-write",
    label: "raw disk write",
    pattern:
      /(?:(?:^|[;&|])\s*(?:rtk\s+)?dd\b[^\n;&|]*\bof=\s*\/dev\/(?:sd[a-z]\d*|nvme\S*|r?disk\S*|mmcblk\S*|vd[a-z]\d*)|>\s*\/dev\/(?:sd[a-z]\d*|nvme\S*|r?disk\S*|mmcblk\S*|vd[a-z]\d*))/i,
    severity: "critical",
    operations: "dd or redirection to a raw block device",
    source: "default",
  },
  {
    id: "disk-copy-operation",
    label: "low-level disk copy",
    pattern: /(?:^|[;&|])\s*(?:rtk\s+)?dd(?:\s|$)/i,
    severity: "dangerous",
    operations: "dd",
    source: "default",
  },
  {
    id: "fork-bomb",
    label: "shell fork bomb",
    pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;:/,
    severity: "critical",
    operations: "fork bomb",
    source: "default",
  },
  {
    id: "kill-all-processes",
    label: "kill all accessible processes",
    pattern: /(?:^|[;&|])\s*(?:rtk\s+)?kill\s+-9\s+-1\b/i,
    severity: "critical",
    operations: "kill -9 -1",
    source: "default",
  },
  {
    id: "system-shutdown-reboot",
    label: "system shutdown or reboot",
    pattern:
      /(?:^|[;&|])\s*(?:rtk\s+)?(?:shutdown|reboot|poweroff|halt)(?:\s|$)/i,
    severity: "critical",
    operations: "shutdown, reboot, poweroff, halt",
    source: "default",
  },
  {
    id: "container-destructive-cleanup",
    label: "destructive container cleanup",
    pattern:
      /(?:^|[;&|])\s*(?:rtk\s+)?(?:docker|podman)\s+(?:system\s+prune|volume\s+(?:prune|rm)|image\s+prune|rm\s+-f)\b/i,
    severity: "dangerous",
    operations: "container prune, volume removal, docker/podman rm -f",
    source: "default",
  },
  {
    id: "package-publication",
    label: "package publication",
    pattern:
      /(?:^|[;&|])\s*(?:rtk\s+)?(?:npm|pnpm|yarn)\s+(?:publish|unpublish)\b/i,
    severity: "dangerous",
    operations: "npm/pnpm/yarn publish or unpublish",
    source: "default",
  },
  {
    id: "environment-file-write",
    label: "write to an environment file",
    pattern: />{1,2}\s*[^\n;&|]*\.env(?:\.[A-Za-z0-9_-]+)?\b/i,
    severity: "risky",
    operations: "shell redirection into .env files",
    source: "default",
  },
];

export const DEFAULT_PATH_RULES: PathRule[] = [
  {
    id: "path-private-key",
    label: "private key or keystore",
    pattern:
      /(?:^|\/)(?:id_(?:rsa|dsa|ecdsa|ed25519)|[^/]+\.(?:key|p12|pfx|jks|keystore))$/i,
    severity: "block",
  },
  {
    id: "path-pem-file",
    label: "PEM file that may contain a private key",
    pattern: /\.pem$/i,
    severity: "warn",
  },
  {
    id: "path-cloud-credentials",
    label: "cloud or service credentials",
    pattern:
      /(?:^|\/)(?:\.aws\/credentials|(?:credentials|service-account)\.(?:json|ya?ml|toml))$/i,
    severity: "block",
  },
  {
    id: "path-netrc",
    label: "netrc credentials",
    pattern: /(?:^|\/)\.netrc$/i,
    severity: "block",
  },
  {
    id: "path-environment-file",
    label: "environment secrets file",
    pattern:
      /(?:^|\/)(?:\.env(?:\.(?!example$|sample$|template$)[A-Za-z0-9_-]+)?|[^/]+\.env)$/i,
    severity: "warn",
  },
  {
    id: "path-package-credentials",
    label: "package registry credentials",
    pattern: /(?:^|\/)(?:\.npmrc|\.pypirc)$/i,
    severity: "warn",
  },
  {
    id: "path-secrets-file",
    label: "secrets file",
    pattern: /(?:^|\/)(?:secrets?)\.(?:json|ya?ml|toml)$/i,
    severity: "warn",
  },
  {
    id: "path-ssh-directory",
    label: "SSH configuration directory",
    pattern: /(?:^|\/)\.ssh(?:\/|$)/i,
    severity: "warn",
  },
  {
    id: "path-git-internals",
    label: "Git internals",
    pattern: /(?:^|\/)\.git(?:\/|$)/,
    severity: "info",
    operations: ["write"],
  },
  {
    id: "path-dependencies",
    label: "installed dependencies",
    pattern: /(?:^|\/)node_modules(?:\/|$)/,
    severity: "info",
    operations: ["write"],
  },
];

export function compileRule(
  value: unknown,
  source: RiskRule["source"],
): { rule?: RiskRule; error?: string } {
  if (!value || typeof value !== "object") {
    return { error: "rule must be an object" };
  }
  const candidate = value as Partial<StoredRule>;
  if (
    typeof candidate.id !== "string" ||
    !/^[a-z0-9][a-z0-9._-]*$/i.test(candidate.id)
  ) {
    return {
      error: "rule id must use letters, numbers, dots, underscores, or hyphens",
    };
  }
  if (typeof candidate.label !== "string" || !candidate.label.trim()) {
    return { error: `rule ${candidate.id} needs a label` };
  }
  if (typeof candidate.pattern !== "string" || !candidate.pattern) {
    return { error: `rule ${candidate.id} needs a pattern` };
  }
  const flags = candidate.flags ?? "i";
  if (
    typeof flags !== "string" ||
    !/^[imsu]*$/.test(flags) ||
    new Set(flags).size !== flags.length
  ) {
    return {
      error: `rule ${candidate.id} has invalid flags; use only i, m, s, or u`,
    };
  }
  if (
    candidate.operations !== undefined &&
    typeof candidate.operations !== "string"
  ) {
    return { error: `rule ${candidate.id} operations must be a string` };
  }
  if (
    candidate.severity !== undefined &&
    !["critical", "dangerous", "risky"].includes(candidate.severity)
  ) {
    return { error: `rule ${candidate.id} has invalid severity` };
  }
  try {
    return {
      rule: {
        id: candidate.id,
        label: candidate.label.trim(),
        pattern: new RegExp(candidate.pattern, flags),
        severity: candidate.severity ?? "dangerous",
        operations: candidate.operations?.trim() || undefined,
        source,
      },
    };
  } catch (error) {
    return {
      error: `rule ${candidate.id} has an invalid regex: ${(error as Error).message}`,
    };
  }
}

export function matchingRules(command: string, rules: RiskRule[]): RiskRule[] {
  return rules
    .filter((rule) => rule.pattern.test(command))
    .sort(
      (left, right) =>
        SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity],
    );
}

export function classifyPath(
  path: string,
  operation: "read" | "write" | "search",
  rules: PathRule[] = DEFAULT_PATH_RULES,
): PathRule | undefined {
  return rules.find(
    (rule) =>
      (!rule.operations || rule.operations.includes(operation)) &&
      rule.pattern.test(path.replace(/^@/, "")),
  );
}

function pathConcern(
  path: string,
  operation: "read" | "write" | "search",
): PathConcern | undefined {
  const rule = classifyPath(path, operation);
  if (!rule || rule.severity === "info") return undefined;
  return {
    label: rule.label,
    detail: `${operation} ${path}`,
    severity: rule.severity === "block" ? "critical" : "dangerous",
  };
}

export function pathConcernsForTool(
  toolName: string,
  input: Record<string, unknown>,
): { concerns: PathConcern[]; info: string[] } {
  let operation: "read" | "write" | "search" | undefined;
  const candidates: string[] = [];

  if (toolName === "read") {
    operation = "read";
    if (typeof input.path === "string") candidates.push(input.path);
  } else if (toolName === "write" || toolName === "edit") {
    operation = "write";
    if (typeof input.path === "string") candidates.push(input.path);
  } else if (toolName === "simply_grep") {
    operation = "search";
    if (typeof input.path === "string") candidates.push(input.path);
    if (typeof input.glob === "string")
      candidates.push(input.glob.replace(/^!/, ""));
  } else if (toolName === "simply_find") {
    operation = "search";
    if (typeof input.path === "string") candidates.push(input.path);
  } else {
    return { concerns: [], info: [] };
  }

  const concerns: PathConcern[] = [];
  const info: string[] = [];
  for (const candidate of candidates) {
    const rule = classifyPath(candidate, operation);
    if (!rule) continue;
    if (rule.severity === "info") {
      info.push(`${rule.label}: ${candidate}`);
      continue;
    }
    const concern = pathConcern(candidate, operation);
    if (concern) concerns.push(concern);
  }

  if (
    toolName === "simply_grep" &&
    input.hidden === true &&
    !concerns.some((concern) => concern.label === "hidden-file content search")
  ) {
    concerns.push({
      label: "hidden-file content search",
      detail: `search ${typeof input.path === "string" ? input.path : "."} with hidden files enabled`,
      severity: "risky",
    });
  }

  return { concerns, info };
}

/** Extract explicit path-like tokens from Bash for credential-path checks. */
export function extractPathsFromBash(command: string): string[] {
  const paths: string[] = [];
  const pattern =
    /(?:^|[\s=><|;&"'`(])((?:\.\.\/|\.\/|\/|~\/)[^\s"'`<>|;&)]+|\.env(?:\.[A-Za-z0-9_-]+)?|[A-Za-z0-9_./-]+\.(?:pem|key|p12|pfx|jks|keystore|env|envrc|netrc))/g;
  for (const match of command.matchAll(pattern)) {
    if (match[1]) paths.push(match[1]);
  }
  return paths;
}

export function pathConcernsForBash(command: string): PathConcern[] {
  return extractPathsFromBash(command)
    .map((path) => pathConcern(path, "read"))
    .filter((value): value is PathConcern => Boolean(value));
}
