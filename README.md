# My Pi Setup

![Screenshot](./assets/Pi-Setup-Screenshot-aug26.png)

A modular, shareable [Pi](https://pi.dev) coding environment. Each customization stays separate so it can be installed, removed, or adapted independently. Please do not hard-copy the setup unchanged—use it as a starting point and customize it for your own workflow.

## Recommended tools to use with this setup
- [Pi Coding Agent](https://pi.dev)
- [Herdr](https://herdr.dev)
- [Starship](https://starship.rs)
- [Neovim](https://neovim.io)
- [Zed](https://zed.dev)

## Directories

- `assets/` — screenshots and supporting files
- `extensions/` — Pi extensions and extension referrals
- `skills/` — reusable agent skills
- `themes/` — custom Pi TUI themes

## Custom Extensions

**Herdr only** means the extension intentionally registers no user-facing functionality, or becomes a no-op, when Pi is not running in a Herdr-managed pane. Extensions with only optional Herdr actions remain available elsewhere and are described accordingly.

- [`ask-user`](extensions/ask-user/README.md) — Adds the `ask_user` tool for one focused question with choices, freeform answers, timeouts, and optional Herdr blocked-state integration.
- [`compact-diff`](extensions/compact-diff/README.md) — Adds a compact `/diff` popup with Vim and arrow navigation, analysis drafts, and capability-aware file actions; pane actions appear only in Herdr.
- [`file-manager`](extensions/file-manager/README.md) — Adds a Neovim-style `/files` browser with filename and content search plus capability-aware copy, reveal, editor, and optional Herdr pane actions.
- [`goal`](extensions/goal/README.md) — Runs a persistent, verification-aware objective loop with automatic continuation and bounded turn batches.
- **Herdr only** — [`herdr-blocked-state`](extensions/herdr-blocked-state/README.md) reports `ask_user` and permission-dialog waits as blocked state to Herdr.
- **Herdr only** — [`herdr-subagents`](extensions/herdr-subagents/README.md) adds default-off, asynchronous Pi subagents in dedicated Herdr tabs with automatic result delivery.
- [`permission-gate`](extensions/permission-gate/README.md) — Applies severity-aware approval to risky shell commands and sensitive file/search paths, with scoped policies, exact-command approvals, optional Herdr blocked state, and session YOLO mode.
- [`pi-clip`](extensions/pi-clip/README.md) — Adds `/clip` for selecting and copying code blocks, tables, lists, ranges, prompts, or responses.
- **Herdr only** — [`pi-herdr-btw`](extensions/pi-herdr-btw/README.md) opens a context-aware, tool-enabled `/btw` side thread in a focused Herdr pane with optional merge-back.
- [`pi-startup`](extensions/pi-startup/README.md) — Replaces the standard startup header with a responsive dashboard showing the Pi logo, resource counts, shortcuts, and version.
- [`plan-mode`](extensions/plan-mode/README.md) — Provides a PLAN → EXECUTE workflow with read-only planning tools and controlled transition into implementation.
- [`review`](extensions/review/README.md) — Adds a temporary read-only `/review` workflow for working trees, branches, commits, paths, and GitHub pull requests.
- [`session-insights`](extensions/session-insights/README.md) — Adds a tabbed Neovim-style `/usage` popup for session, token, cost, model, project, tool, and current-context insights.
- [`simply-file-search`](extensions/simply-file-search/README.md) — Registers fast `simply_find` and `simply_grep` tools backed by `fd`, `rg`, and optional fuzzy ranking through `fzf`.
- [`starship-statusline`](extensions/starship-statusline/README.md) — Adds a configurable Starship-powered footer with model and Git information.
- [`theme-picker`](extensions/theme-picker/README.md) — Adds `/theme` with fuzzy search, live preview, rollback on cancellation, and global theme persistence.
- [`token-optimizer`](extensions/token-optimizer/README.md) — Adds default-off, session-scoped output, coding, and RTK token controls via `/tokens`, plus a one-shot `/brief` prompt.
- [`whimsical`](extensions/whimsical/README.md) — Replaces the working message with hundreds of playful first-turn and follow-up phrases, toggled with `/whimsy`.

### Third-party extension referrals

These directories document upstream packages without vendoring or loading them:

- [`pi-fff`](extensions/pi-fff/README.md) — Indexed fuzzy file and content search from `npm:@ff-labs/pi-fff`.
- [`pi-goal-list-loop-audit`](extensions/pi-goal-list-loop-audit/README.md) — Advanced task queues, process loops, and isolated completion audits.

ask your agent to install them when you need them.

#### Notes

**Herdr only:** `extensions/herdr-agent-state.ts` is generated and managed by Herdr and is loaded explicitly by the root package so `ask_user` and permission prompts can report blocked state. It is not a portable custom extension; put custom extensions beside it rather than editing it.


## Themes

- [`aura`](themes/aura.json) — Deep charcoal with violet accents and mint highlights.
- [`catppuccin-mocha`](themes/catppuccin-mocha.json) — Soft Mocha surfaces with teal and blue accents.
- [`dayowl`](themes/dayowl.json) — Bright, clean surfaces with blue, orange, and green accents.
- [`dracula-plus`](themes/dracula-plus.json) — Dark neutral panels with vivid Dracula-inspired green, red, and gold.
- [`gruvbox-dark-hard`](themes/gruvbox-dark-hard.json) — High-contrast Gruvbox dark palette with warm yellow accents.
- [`modern-dark`](themes/modern-dark.json) — Near-black surfaces with warm orange accents and cool blue-gray text.
- [`nightowl`](themes/nightowl.json) — Deep navy Night Owl palette with cyan and blue highlights.
- [`rose-pine`](themes/rose-pine.json) — Muted rose, lavender, gold, and pine tones.
- [`synthwave-84`](themes/synthwave-84.json) — Neon pink and cyan Synthwave colors over deep purple surfaces.
- [`tokyo-night`](themes/tokyo-night.json) — Cool blue and violet Tokyo Night palette with balanced syntax colors.

Use `/theme` when the theme picker extension is active, or select a theme through Pi's settings.

## Install and Update

Install the complete package globally from GitHub:

```bash
pi install https://github.com/sina96/my-pi-setup.git
```

Pull future extension and theme changes with:

```bash
pi update --extensions
```

Then run `/reload` or restart Pi.
