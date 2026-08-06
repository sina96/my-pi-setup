# pi-goal-list-loop-audit — third-party referral

> This is **not my extension** and no upstream code is vendored here.

- Repository: <https://github.com/DraconDev/pi-goal-list-loop-audit>
- npm package: `pi-goal-list-loop-audit`
- Author/maintainer: DraconDev (`dracon` in package metadata)
- License: MIT

## Before installing

Try the smaller local [`simply-goal`](../../extensions/goal/README.md) first for one clearly
scoped objective and bounded batches of autonomous turns. Install GLLA when you
specifically need its queues, process loops, durable orchestration, or independent
isolated auditor.

Do not load both: they each register `/goal` and can independently drive new
agent turns.

## What it is

A mission-control extension for long-running, semi-autonomous Pi work. It provides
three related workflows:

- `/goal` — execute one durable goal against a confirmed completion contract.
- `/list` — queue multiple goals and work through them.
- `/loop` — run metric, spec, or project-audit improvement loops.

Its defining feature is **independent verification**. When the implementing agent
claims a goal is complete, the extension launches an isolated Pi auditor session
without the implementing conversation or normal extensions. The auditor must
verify completion using fresh repository evidence and raw command output.

It also includes drafting/confirmation gates, durable state under `.pi-glla/`,
continuation and stall recovery, token/time bounds, status widgets, notifications,
and anti-repetition safeguards.

## Install it when

Consider it when you need one or more of these:

- A task should run for many turns or hours without constant manual prompting.
- “Done” needs independent evidence rather than the implementing agent's opinion.
- You have a queue of substantial tasks that each need their own audit trail.
- Progress can be measured by a reliable command, such as failing tests, TODO
  count, coverage, bundle size, or another numeric metric.
- You want a persistent project-audit loop that repeatedly finds and fixes issues.
- You are prepared to define a clear `Done when:` contract and supervise decision
  pauses.

## Do not install it just for

- Ordinary interactive coding sessions.
- A short checklist or a few todos.
- One-off commands that you can verify directly.
- Work without a meaningful completion contract or trustworthy metric.
- A session already controlled by another autonomous goal/loop driver.

It is a large orchestration system, not a lightweight todo extension. Independent
audits and long loops can consume substantial tokens and provider quota.

## Important compatibility rule

Only one extension should drive new agent turns from `agent_end`. Do **not** run it
alongside another active autonomous driver such as `pi-goal`, `pi-goal-x`,
`pi-loop-mode`, `ralphi`, `pi-ralph*`, or `pi-autoresearch`. Multiple drivers can
schedule contradictory continuations.

The upstream README also warns that task-list extensions overlap with its `/list`;
prefer one source of task state.

## Recommended companion

Upstream describes `@juicesharp/rpiv-ask-user-question` as effectively required
for its intended structured drafting and confirmation UX. Without it, GLLA falls
back to plain-text prompts.

Review the upstream companion and compatibility sections before installation.
Our local `ask_user` extension is not guaranteed to implement the exact tool/API
GLLA expects.

## Try temporarily

Review the source first, then run:

```bash
pi -e npm:pi-goal-list-loop-audit
```

For the intended structured-question experience, upstream currently recommends:

```bash
pi \
  -e npm:pi-goal-list-loop-audit \
  -e npm:@juicesharp/rpiv-ask-user-question
```

A temporary run can still create project state such as `.pi-glla/` and can launch
long-running agent turns. Use it in a clean/test repository first.

## Install

```bash
pi install npm:pi-goal-list-loop-audit
pi install npm:@juicesharp/rpiv-ask-user-question
```

Project-local installation:

```bash
pi install -l npm:pi-goal-list-loop-audit
```

Remove it with:

```bash
pi remove npm:pi-goal-list-loop-audit
```

## First commands to learn

```text
/goal                         Draft and confirm a goal
/goal "Task. Done when: …"    Start from an explicit contract
/goal status                  Inspect current state
/goal pause                   Pause active work
/goal resume                  Resume active work
/goal verify                  Run the isolated verifier
/list                         Show the goal queue
/loop                         Draft a process loop
/loop status                  Inspect loop progress
/loop stop                    Stop a loop
/glla                         Open settings/status
```

The project evolves quickly and has many more controls. Always read the current
[upstream README](https://github.com/DraconDev/pi-goal-list-loop-audit) and
[installation guide](https://github.com/DraconDev/pi-goal-list-loop-audit/blob/main/INSTALL.md)
before installing.
