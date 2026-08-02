# simply-session-insights

A compact, theme-aware view of local Pi usage, based on Armin Ronacher's
Apache-2.0 [`session-breakdown.ts`](https://raw.githubusercontent.com/mitsuhiko/agent-stuff/refs/heads/main/extensions/session-breakdown.ts).

This version is tailored to this setup's preference for small, auditable,
independently removable extensions. It keeps the useful session parser but omits
the large calendar renderer, fixed RGB palettes, provider grouping controls,
weekday/time-of-day analytics, and configuration surface.

## What it shows

- Sessions, assistant turns, and tool calls
- Input, output, cache-read, reasoning, and total billed tokens
- Estimated provider-reported cost
- Activity sparkline
- Top models
- Top project directories
- Most-used tools (`bash`, `read`, `edit`, `write`, and extension tools)

The UI uses Pi theme tokens, so it follows `nightowl`, `dark`, or any theme chosen
through the local theme picker.

## Commands

All three commands open the same view:

```text
/usage
/session-insights
/session-breakdown
```

Optional arguments select the initial range or bypass the short cache:

```text
/usage 7
/usage 30
/usage 90
/usage refresh
/usage 30 refresh
```

Inside the view:

```text
Left/Right or h/l   Change 7/30/90-day range
Tab/Shift+Tab       Cycle summary/models/projects/tools
1/2/3               Jump directly to 7/30/90 days
r                   Rescan session files
q, Escape, Ctrl+C   Close
```

## Efficiency

- Reads `getAgentDir()/sessions/**/*.jsonl`; no external process or dependency.
- Streams files line by line instead of loading complete transcripts into memory.
- Stores only aggregate metadata, never message content.
- Reuses scan results for 15 seconds when reopening the view.
- Supports cancellation during scanning.
- In headless mode, emits a concise 30-day text summary instead of opening UI.

## Interpretation

Token totals are summed from each assistant response's provider usage object. They
include cached context when the provider includes it in `totalTokens`, so they are
best understood as billed/processed tokens rather than unique text tokens. Cost is
the provider-reported estimate; subscription-backed or unpriced models may report
zero.

Sessions are assigned to the local calendar day on which they started. Project
statistics use the session's recorded working directory.

## Privacy

The extension reads local session history but does not transmit it. It extracts
only timestamps, working directories, model identifiers, usage totals, roles, and
tool names. Prompt, response, thinking, and tool-output content is ignored.

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
