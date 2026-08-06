# simply-session-insights

A tabbed, theme-aware Neovim-style popup for local Pi usage and current-context
insights. The session parser is based on Armin Ronacher's Apache-2.0
[`session-breakdown.ts`](https://raw.githubusercontent.com/mitsuhiko/agent-stuff/refs/heads/main/extensions/session-breakdown.ts).

The popup layout and tab treatment take visual inspiration from the MIT-licensed
[`pi-atlas`](https://github.com/MohnDoe/pi-atlas/tree/707f84fe3fd051dd2925a2a5959a319e7be5489d/media).
The Context tab's block-grid presentation is inspired by Claude Code and the
MIT-licensed [`pi-context`](https://github.com/ttttmr/pi-context), while its
accounting and responsive rendering are independently implemented for this
extension using only Pi's local APIs and session files.

## Popup tabs

- **Overview** — Sessions, turns, tool calls, token and cost totals, active days,
  activity sparkline, token flow, and the leading model/project/tool.
- **Models** — Model token usage and percentage share.
- **Projects** — Project-directory token usage and percentage share.
- **Tools** — Tool call totals and percentage share.
- **Context** — A Claude-style block grid for current model context usage and
  available space, with estimated System Prompt, System Tools, Tool Activity,
  and Messages categories plus a message-role breakdown.

The Context total uses Pi's provider-reported context usage when available. Its
category distribution starts with local character-based estimates, includes the
full active tool schemas and Pi's compaction-aware active message context, and is
then calibrated to the reported total. Categories remain approximate and are
labeled as such in the UI.

## Commands

All four commands open the same centered popup. `/insights` is the concise
full-dashboard command; no `/context` alias is registered, avoiding collisions
with dedicated context-management extensions.

```text
/insights
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
