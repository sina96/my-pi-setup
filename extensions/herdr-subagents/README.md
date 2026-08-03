# herdr-subagents

Toggleable asynchronous Pi subagents running in dedicated [Herdr](https://herdr.dev) tabs.

The extension is **off by default in every session**. Start Pi inside Herdr, then enable it:

```text
/subagents on
```

Disable it without stopping existing children:

```text
/subagents off
```

Other commands:

```text
/subagents status
/subagents list
/subagents stop-all
```

## Model tools

When enabled, the extension activates:

- `subagent_spawn` — start a child and return immediately
- `subagent_check` — inspect one tracked run
- `subagent_cancel` — interrupt its current turn or close its pane
- `subagent_wait` — explicitly wait and consume automatic delivery
- `subagent_list` — list tracked runs

Each child gets its own Herdr tab and Pi session. Completion is published through an atomic result sidecar and delivered to the parent as a follow-up message. Artifacts are stored below `~/.pi/agent/herdr-subagents/` (or `$PI_CODING_AGENT_DIR/herdr-subagents/`).

## Current scope

This initial implementation supports Pi children, inherited or overridden model/thinking settings, up to four concurrent runs, result delivery, interruption, shutdown cleanup, compact status UI, and watcher preservation across `/reload`.

Agent definition files, session forking, resume, `caller_ping`, and a takeover dashboard are intentionally deferred.
