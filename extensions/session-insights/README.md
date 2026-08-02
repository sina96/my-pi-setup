# simply-session-insights

A tabbed, theme-aware Neovim-style popup for local Pi usage and current-context
insights. The session parser is based on Armin Ronacher's Apache-2.0
[`session-breakdown.ts`](https://raw.githubusercontent.com/mitsuhiko/agent-stuff/refs/heads/main/extensions/session-breakdown.ts).

The popup layout and tab treatment take visual inspiration from the MIT-licensed
[`pi-atlas`](https://github.com/MohnDoe/pi-atlas/tree/707f84fe3fd051dd2925a2a5959a319e7be5489d/media),
while the Context tab is conceptually inspired by
[`context-command.ts`](https://github.com/abhinand5/pi-setup/blob/39f1eced5ce9655ca0ad43e77cd6f83ec63ac0dd/extensions/context-command.ts).
The implementation here is purpose-built for this extension and uses only Pi's
local APIs and session files.

## Popup tabs

- **Overview** — Sessions, turns, tool calls, token and cost totals, active days,
  activity sparkline, token flow, and the leading model/project/tool.
- **Models** — Model token usage and percentage share.
- **Projects** — Project-directory token usage and percentage share.
- **Tools** — Tool call totals and percentage share.
- **Context** — Current model context usage, free space, and estimated consumption
  from the system prompt, active tools, context files, skills, conversation, and
  conversation roles.

The Context total uses Pi's provider-reported context usage when available.
Category rows are approximate token estimates and are labeled as such in the UI.

## Commands

All three commands open the same centered popup:

```text
/usage
/session-insights
/session-breakdown
```

Optional arguments select the initial range, tab, or bypass the short cache:

```text
/usage 7
/usage 30 models
/usage context
/usage 90 projects refresh
```

## Popup controls

```text
Tab / Shift+Tab      Next or previous tab
1 / 2 / 3 / 4 / 5   Open Overview/Models/Projects/Tools/Context
Left / Right, h / l  Change 7/30/90-day range
Up / Down            Scroll table rows
Page Up / Page Down  Scroll by ten rows
r                    Rescan session files
q, Escape, Ctrl+C    Close
```

The footer always shows the essential controls, including how to close the
popup. Loading also uses a small centered overlay instead of replacing the main
session viewport.

## Efficiency

- Reads `getAgentDir()/sessions/**/*.jsonl`; no external process or dependency.
- Streams files line by line instead of loading complete transcripts into memory.
- Stores only aggregate metadata, never historical message content.
- Reuses scan results for 15 seconds when reopening the popup.
- Supports cancellation during scanning.
- In headless mode, emits a concise 30-day text summary instead of opening UI.
- Builds the Context tab from the active in-memory session without transmitting it.

## Interpretation

Historical token totals are summed from each assistant response's provider usage
object. They include cached context when the provider includes it in
`totalTokens`, so they are best understood as billed/processed tokens rather than
unique text tokens. Cost is the provider-reported estimate; subscription-backed
or unpriced models may report zero.

Sessions are assigned to the local calendar day on which they started. Project
statistics use the session's recorded working directory.

## Privacy

The extension reads local session history but does not transmit it. Historical
scanning extracts only timestamps, working directories, model identifiers, usage
totals, roles, and tool names. Prompt, response, thinking, and tool-output content
is ignored.

The Context tab estimates sizes from the current in-memory prompt and
conversation, but displays only category totals and role totals—not content.

## Try without installing

```bash
pi -e ./extensions/session-insights
```

## Install independently

```bash
pi install ./extensions/session-insights
```

Remove it with:

```bash
pi remove ./extensions/session-insights
```
