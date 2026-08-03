# pi-herdr-btw

A [Pi](https://pi.dev) extension that opens a tool-enabled side conversation in a focused [Herdr](https://herdr.dev) pane without changing the parent transcript.

Unlike a one-shot, tool-free overlay, this side thread runs in a separate Pi process and supports editing the initial question, tools, follow-ups, and merging the side thread back into the parent with a follow-up prompt.

This local adaptation is based on Oscar Gabriel's MIT-licensed [`pi-herdr-btw`](https://github.com/oscabriel/pi-herdr-btw) and informed by mitsuhiko's in-process [`btw.ts`](https://github.com/mitsuhiko/agent-stuff/blob/main/extensions/btw.ts). It explicitly passes its local extension path to child Pi processes so development checkouts work before package installation or update.

## Behavior

- snapshots the parent's current, compaction-aware context
- inherits its cwd, model, and thinking level by default
- prefills the question for review by default
- leaves the parent session unchanged
- remains usable while the parent is working

## Requirements

- [Pi](https://pi.dev/) and [Herdr](https://herdr.dev) v0.7.4+ installed (launches use `herdr pane split` + `herdr agent start --kind pi --pane`).
- Pi running in a Herdr-managed pane

## Install

This extension is included in the repository's Pi package and is loaded by the root package configuration. Install or update the complete setup, then run `/reload` or restart Pi.

## Usage

```text
/btw                              open an empty side pane
/btw <question...>                open a side pane with a draft question
/btw ask <question...>            escape hatch for questions starting with a reserved word
/btw config [...]                 show or change defaults
/btw merge <prompt...>            fold this side thread into the parent and continue with the prompt
/btw help                         show the grammar
```

Only the exact first words `ask`, `config`, `merge`, and `help` are subcommands; anything else is a question. The new pane opens with the question ready to edit or submit.

## Merge

In the side pane, `/btw merge <prompt>` closes the loop: it packages the side conversation (user/assistant turns, no tool payloads) as a transcript, hands it to the parent together with your prompt, refocuses the parent pane, and closes the side pane. The parent appends the transcript as one visible, context-participating message and auto-submits your prompt, so it is already working with the side thread's findings by the time you are back. Bare `/btw merge` opens an editor to compose the prompt.

Delivery waits for the parent to settle if it is busy and survives reloads; an unacknowledged merge outlives the closed pane until the parent picks it up. In the parent, `/btw merge` rescans for pending requests.

## Config

Run `/btw config` to show current defaults.

```text
/btw config auto-submit on|off
/btw config model inherit|provider/model
/btw config thinking inherit|off|minimal|low|medium|high|xhigh|max
/btw config tools inherit|all|read-only|none
/btw config split right|down
/btw config reset
```

Settings are stored in Pi's agent directory (`~/.pi/agent/pi-herdr-btw.json` by default).

## Prompt cache

When the child inherits the parent's model, tools, and thinking level (the defaults), it replays the parent's exact system prompt and native messages so providers with prefix-based prompt caching (notably Anthropic) can reuse the warm parent cache. Configured model, tool, or thinking overrides are explicit cache-breaking choices; the child then falls back to a portable flattened snapshot and says why. OpenAI/gateway cache routing across the new child session is not guaranteed.

## Caveats

The child receives a static context snapshot and does not see later parent activity; use `/btw merge <prompt>` to fold the side thread back in. The child shares the working directory, so enabled tools can modify shared files. Very large parent contexts may exceed the child's context limit.

Launch data is stored in a private temporary directory, removed when the child exits normally (unacknowledged merges are retained until delivered), and cleaned up after 24 hours if left stale.

## Development

```bash
npm install
npm run check
npm run pack:check
```

## License

MIT
