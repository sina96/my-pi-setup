# simply-package-manager-policy

A project-aware package-manager policy for Pi. It defaults new or uncommitted
workflows to **pnpm** for Node and **uv** for Python, while preserving package
managers already established by project metadata and lockfiles.

The design is independently implemented and takes conceptual inspiration from
Mitsuhiko's MIT-licensed
[`uv.ts`](https://github.com/mitsuhiko/agent-stuff/blob/d265b8ef32f896d3ef3bc6a45bd7b8e0d02150e0/extensions/uv.ts).
Unlike that extension, it does not override Pi's Bash tool, prepend command
shims to `PATH`, or redirect every Python invocation through `uv run`.

## Resolution

### Node

The nearest applicable evidence wins:

1. `package.json#packageManager`
2. `pnpm-lock.yaml` / `pnpm-workspace.yaml`
3. `package-lock.json` / `npm-shrinkwrap.json`
4. `yarn.lock`
5. `bun.lock` / `bun.lockb`
6. No evidence: **pnpm**

An explicit `packageManager` field wins over lockfiles in the same directory.
Conflicting lockfiles are reported instead of guessed, and Node enforcement is
skipped until the conflict is resolved or a session override is selected.

### Python

The extension recognizes `uv.lock`, Poetry metadata, Pipenv metadata, and common
requirements files. With no established manager it defaults to **uv**. Conflicts
between strong manager signals are reported rather than guessed.

The policy covers package and environment management. It does not block plain
`python` or `python3` execution. Under a policy other than `pip` or `pip3`, it
blocks `python -m pip` and `python -m venv` and points the agent to the selected
manager's workflow.

## Enforcement

Before each agent run, a concise policy summary is appended to the system
prompt. Obvious conflicting package-manager commands sent through Pi's `bash`
tool are blocked with an actionable replacement. This composes with other
`tool_call` extensions and does not replace Bash rendering or execution.

This is workflow enforcement, not a security sandbox. User `!` commands, custom
tools, dynamically constructed shell commands, and arbitrary executable paths
may bypass it.

## Commands

Session overrides follow the current conversation branch and survive resume,
reload, tree navigation, and compaction.

```text
/package-manager                 Show effective policy and evidence
/package-manager node auto       Respect project evidence, otherwise pnpm
/package-manager node npm        Use npm for this session
/package-manager node pnpm       Use pnpm for this session
/package-manager python auto     Respect project evidence, otherwise uv
/package-manager python uv       Use uv for this session
/package-manager python pip3     Use pip3 for this session
/package-manager mode enforce    Block conflicting Bash commands (default)
/package-manager mode warn       Warn without blocking
/package-manager mode off        Disable guidance and interception
/package-manager reset           Restore auto/enforce defaults
```

Node choices are `auto`, `pnpm`, `npm`, `yarn`, and `bun`. Python choices are
`auto`, `uv`, `poetry`, `pipenv`, `pip`, and `pip3`.

## Try without installing

```bash
pi -e ./extensions/package-manager-policy
```

Run `/reload` when this repository is already loaded as your Pi package.
