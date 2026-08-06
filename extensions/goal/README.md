# simply-goal

A bounded, session-persistent autonomous goal loop adapted from Armin Ronacher's
Apache-2.0 [`goal.ts`](https://raw.githubusercontent.com/mitsuhiko/agent-stuff/refs/heads/main/extensions/goal.ts).

This is the recommended **first option** for long-running work in this setup. It
keeps the core goal → progress → verify → continue loop while adding a conservative
turn limit and avoiding the orchestration complexity of GLLA.

## Start a goal

```text
/goal Implement the feature described in docs/spec.md
/goal start Fix the failing integration tests --turns 8
```

The default safety limit is **6 automatic turns per batch**. The accepted range is
1–20. Reaching the limit pauses rather than claiming completion or continuing
indefinitely.

## Commands

```text
/goal                         Show status
/goal <objective>             Start or replace a goal
/goal <objective> --turns N   Set this batch's automatic-turn limit
/goal pause                   Pause immediately
/goal resume                  Resume with the existing limit and a fresh batch
/goal resume 10               Resume with a new limit
/goal edit                    Edit the objective interactively
/goal done                    Mark complete explicitly as the user
/goal clear                   Remove goal state after confirmation
```

## Agent completion tool

While working, the agent can call:

```text
finish_goal({ status: "complete" | "blocked", report: "…" })
```

The system prompt requires requirement-by-requirement evidence before completion.
`blocked` is reserved for work that genuinely requires user input or an external
state change. Ordinary difficulty or incomplete work remains active.

## Safety and lifecycle

- Goal state, counters, and status are appended to the Pi session and follow
  session branches.
- A themed widget shows goal state, current batch turns, and processed tokens.
- Each completed agent run counts as one turn.
- Errors and aborts pause the goal.
- Permission-gate dialogs still apply during autonomous turns.
- PLAN/EXECUTE and REVIEW modes refuse to overlap with an active goal; pause the
  goal first.
- Hidden continuation messages are deduplicated from model context.
- The objective is escaped and explicitly treated as untrusted user data.

Token totals are provider-reported processed tokens and can include cached input.
The turn limit—not token accounting—is the hard runaway safeguard.

## When to use this instead of GLLA

Use `simply-goal` first when:

- One objective can be expressed clearly in a sentence or referenced spec.
- A handful of autonomous turns is enough.
- You want to review progress between bounded batches.
- The implementing agent can verify completion directly.

Use third-party
[`pi-goal-list-loop-audit`](../../docs/third-party-extensions/pi-goal-list-loop-audit.md) when you need
queues, metrics, durable project-wide loops, decision/consent gates, stall
recovery, or an isolated independent completion auditor.

Do **not** load both: each can drive new turns automatically and both use `/goal`.
Also avoid any other autonomous `agent_end` driver in the same session.

## Try without installing

```bash
pi \
  -e ./extensions/goal \
  -e ./extensions/permission-gate
```

Start with a low-risk test repository and a 2-turn batch:

```text
/goal Inspect this project and improve its README accuracy --turns 2
```

## Install independently

```bash
pi install ./extensions/goal
```

Remove it with:

```bash
pi remove ./extensions/goal
```
