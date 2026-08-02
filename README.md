# My Pi Setup

A modular, shareable Pi coding environment. Each customization stays separate so
it can be installed or removed independently. Please dont hard copy. Use your fingers or an agent to customize for your needs.

![Screenshot](./assets/Pi-Setup-Screenshot-aug26.png)

# Directories
- `assets/` — images and other supporting files
- `extensions/` — Pi extensions
- `skills/` — Pi agent skills
- `themes/` — reserved for optional full Pi UI themes

# Custom Extensions

## Starship statusline

`extensions/starship-statusline/` provides the existing Starship-powered footer.
Its configuration and commands are documented in
[`extensions/starship-statusline/README.md`](extensions/starship-statusline/README.md).

Use `/starship-statusline-segments` to interactively show or hide model and Git
information. Install or remove it independently:

```bash
pi install ./extensions/starship-statusline
pi remove ./extensions/starship-statusline
```

## File search

Two independent options live under `extensions/`:

- [`simply-file-search`](extensions/simply-file-search/README.md) registers
  `simply_find` from `fd` and `simply_grep` from `rg` when those executables are
  available. `fzf` adds fuzzy file ranking. Pi's built-in tools remain fallbacks.
- [`pi-fff`](extensions/pi-fff/README.md) documents how to try or install the
  upstream `npm:@ff-labs/pi-fff` package without vendoring it here.

Try both together without installing:

```bash
pi \
  -e npm:@ff-labs/pi-fff \
  -e ./extensions/simply-file-search \
  --fff-mode tools-only
```

## Ask user

[`extensions/ask-user/`](extensions/ask-user/README.md) provides a lightweight,
dependency-free `ask_user` tool for one focused question, optional choices,
freeform answers, and timeouts. It uses Pi's built-in dialogs and emits Herdr's
blocked lifecycle event while waiting.

For searchable lists, multi-select, split panes, comments, overlay controls, and
a bundled decision-gating skill, use the more mature upstream `pi-ask-user`
package instead. Do not load both because they register the same tool name.

Try the local version without installing:

```bash
pi -e ./extensions/ask-user
```

## Clipboard picker

[`extensions/pi-clip/`](extensions/pi-clip/README.md) adds `/clip` for copying a
specific code block, table, list, quote, line range, prompt, response, or confirmed
conversation through Pi's portable clipboard API. It intentionally avoids a
custom shortcut and complex table-grid UI.

```bash
pi -e ./extensions/pi-clip
```

## Session insights

[`extensions/session-insights/`](extensions/session-insights/README.md) adds a
compact, theme-aware `/usage` dashboard for 7/30/90-day session, token, cost,
model, project, and tool statistics. It streams local JSONL history and ignores
conversation content.

```bash
pi -e ./extensions/session-insights
```

## Goal loop

[`extensions/goal/`](extensions/goal/README.md) is the recommended first option
for long-running autonomous work: one persistent objective, automatic
continuations, verification-aware completion, and bounded 1–20-turn batches. Use
the documented third-party GLLA referral only when queues, process loops, or an
independent isolated auditor justify the extra orchestration.

```bash
pi -e ./extensions/goal -e ./extensions/permission-gate
```

Do not load both goal drivers.

## Code review

[`extensions/review/`](extensions/review/README.md) adds a temporary, read-only
`/review` workflow for working-tree changes, staged changes, branches, commits,
project paths, and GitHub PRs. It never checks out PRs or automatically fixes
findings, and restores the previous tool set after the review turn.

```bash
pi -e ./extensions/review -e ./extensions/permission-gate
```

## Permission gate

[`extensions/permission-gate/`](extensions/permission-gate/README.md) pauses risky
shell commands for explicit approval. It supports allow-once, exact-command
session approval, deny-by-default headless behavior, and Herdr blocked-state
notifications.

```bash
pi -e ./extensions/permission-gate
```

## Plan mode

[`extensions/plan-mode/`](extensions/plan-mode/README.md) provides a lightweight
PLAN → EXECUTE workflow. PLAN mode restricts the agent to known read-only tools
and safe inspection commands; `/plan execute` restores the previous tools and
injects the captured plan for implementation.

```bash
pi -e ./extensions/plan-mode
```

Use `/plan`, refine the generated plan if needed, then run `/plan execute`.

## Theme picker

[`extensions/theme-picker/`](extensions/theme-picker/README.md) adds `/theme`
with fuzzy search, live preview, direct selection, cancellation rollback, and
persistence to Pi's global settings. It discovers Pi's registered themes.

The repository's validated `themes/` collection currently includes `aura`,
`catppuccin-mocha`, `dracula-plus`, `gruvbox-dark-hard`, and `nightowl`. The local
checkout's theme directory is registered in `~/.pi/agent/settings.json`; update
that path after moving or sharing the checkout.

```bash
pi -e ./extensions/theme-picker
```

## Working messages

[`extensions/whimsical/`](extensions/whimsical/README.md) provides a restrained
set of coding-focused, lightly playful working messages. `/whimsy` toggles it per
session branch.

```bash
pi -e ./extensions/whimsical
```

## Startup dashboard

`extensions/pi-startup/` replaces the previous `pi-header` with a responsive,
three-column startup box inspired by pikit. It shows a theme-aware Pi logo,
loaded-resource counts, current shortcut hints, and the Pi version.

Set **Quiet startup** to `true` in `/settings` to avoid Pi's native detailed
resource listing appearing below the dashboard. Then try it with the statusline
without installing anything:

```bash
pi \
  -e ./extensions/pi-startup \
  -e ./extensions/starship-statusline/src/index.ts
```

Install or remove only the startup dashboard with:

```bash
pi install ./extensions/pi-startup
pi remove ./extensions/pi-startup
```

See [`extensions/pi-startup/README.md`](extensions/pi-startup/README.md) for details.

## Third-party referrals

Documentation-only directories under `extensions/` do not vendor or load the
referenced packages:

- [`pi-fff`](extensions/pi-fff/README.md) — indexed fuzzy file/content search.
- [`pi-goal-list-loop-audit`](extensions/pi-goal-list-loop-audit/README.md) —
  advanced task queues, process loops, and isolated completion audits when the
  local bounded goal loop is not enough.

## Notes

`extensions/herdr-agent-state.ts` is generated and managed by Herdr. Put custom
extensions beside it rather than editing it.
