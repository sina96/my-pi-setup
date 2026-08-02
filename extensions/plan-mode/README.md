# simply-plan-mode

A small plan/execute workflow for Pi, inspired by
[`adrianapan/pikit/agent/extensions/plan-mode`](https://github.com/adrianapan/pikit/tree/7b6040512b8d005fe5035a60c321b2a0d71b1679/agent/extensions/plan-mode).

This version deliberately omits plan-file libraries, configuration layers, custom
menus, and multi-plan management. It keeps the core safety workflow:

1. Enter read-only PLAN mode.
2. Let the agent inspect the project and produce a self-contained `## Plan`.
3. Review or refine the captured plan.
4. Explicitly enter EXECUTE mode.
5. The agent restores normal tools, implements the plan, validates it, and calls
   `plan_complete`.

## Commands

```text
/plan             Toggle PLAN on, or turn the current mode off
/plan on          Start a fresh planning pass
/plan execute     Execute the most recently captured plan
/plan off         Restore normal tools
/plan status      Show mode and whether a plan was captured
```

Shortcut: `ctrl+shift+l` toggles plan mode.

CLI:

```bash
pi --plan
```

## Safety

PLAN mode saves the currently active tool list and exposes only known read-only
search/research tools. It keeps `bash` for inspection but permits a conservative
allowlist such as `git status`, `git diff`, `ls`, `fd`, and `rg`. Shell redirects,
command substitution, mutating commands, and execution flags are blocked.

This is a convenience boundary, not an operating-system sandbox. A hostile or
unexpected external command could still have side effects; use a real sandbox for
untrusted repositories.

EXECUTE mode restores exactly the tool set that was active before PLAN mode and
adds `plan_complete`. Outside EXECUTE mode, `plan_complete` is inactive and
blocked.

## Persistence

Mode and captured plan text are stored as custom entries in the Pi session. They
follow session branches and restore on resume. This lightweight version does not
write `.pi/plans/*.md` files or maintain a reusable plan library.

## UI

A one-line widget and status label show `PLAN · read-only` or
`EXECUTE · approved plan`. The extension follows the active Pi theme.

## Try without installing

```bash
pi -e ./extensions/plan-mode
```

## Install independently

```bash
pi install ./extensions/plan-mode
```

Remove it with:

```bash
pi remove ./extensions/plan-mode
```

## Differences from pikit

The pikit version is better if you need named plan files, an existing-plan picker,
automatic Execute/Refine/Save/Discard menus, configurable tool/pattern lists, or
plan cleanup policies. This local version is easier to audit and maintain for a
single plan per session.
