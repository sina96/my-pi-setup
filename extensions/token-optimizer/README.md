# Token Optimizer

Session-scoped token controls for Pi. Everything starts **off** in each fresh
session; `/tokens` opens a compact popup for enabling only what the current task
needs.

## Controls

| Row | Values | Optimizes |
| --- | --- | --- |
| Output | `off`, `brief`, `caveman-lite`, `caveman-full`, `caveman-ultra` | Assistant output tokens |
| Coding | `off`, `ponytail-lite`, `ponytail-full`, `ponytail-ultra` | Unnecessary code, files, dependencies, and related tool use |
| Tool output | `off`, `rtk` | Shell output placed into model context |

Use `j/k` or arrow keys to move and `h/l`, left/right, Space, or Enter to change
a value. The popup explains the selected option's behavior, best use, and
trade-off. It also reports current context usage and Bash activity, then gives a
deterministic recommendation such as suggesting RTK for a shell-heavy session.
Press `?` for a compact comparison of every mode.

Active modes appear in one status item. Changes are stored in Pi's session log,
so they survive navigation within that session but are not carried into a new
session. Recommendations are based only on local session metrics and do not call
another model or claim estimated savings.

The RTK row is shown only when the `rtk` executable is on `PATH`. When it is
missing, the popup instead shows `i install RTK`. Choosing it lists the available
Homebrew and Cargo installers, marks Homebrew as recommended when available,
and requests explicit confirmation before running the selected command. If
neither package manager is available, the extension gives setup instructions and
changes nothing.

When RTK is enabled, the extension follows [RTK's official Pi integration
design](https://www.rtk-ai.app/docs/getting-started/supported-agents/#pi): it
intercepts Pi's `tool_call` event and delegates each decision to `rtk rewrite`,
keeping RTK's own command registry as the source of truth. Rewrites
fail open, use a two-second timeout, and can be bypassed for a process with
`RTK_DISABLED=1`. Because this extension already provides the Pi hook, do not
also run `rtk init --agent pi`; that would install a redundant RTK extension.
`rtk rewrite` requires RTK 0.23.0 or newer.

RTK can also be installed manually with either package manager:

```bash
# Recommended when Homebrew is available
brew install rtk-ai/tap/rtk

# Or install the correct crate directly from RTK's repository
cargo install --git https://github.com/rtk-ai/rtk --branch master rtk
```

## One-shot brevity

The bundled `/brief <request>` prompt template prepends the measured, simple
instruction `Be brief.` to one request without changing session state. A prompt
template is used instead of a skill so this small instruction adds no permanent
skill description to the system prompt.

The benchmark discussed in [“I benchmarked caveman against two
words”](https://www.maxtaylor.me/articles/i-benchmarked-caveman-against-two-words)
reported 419 mean output tokens for `Be brief.` versus 636 for baseline, with
the same aggregate quality score. Caveman lite/full reported 401/404; structured
Caveman modes are therefore optional rather than the default.

## Safety

Compression prompts explicitly preserve exact code and errors, necessary steps,
security and destructive-action warnings, material caveats, accessibility,
validation at trust boundaries, and error handling that prevents data loss.
Runtime capability checks remain in place even though unavailable RTK controls
are hidden.

## Origin

The unified control concept and Caveman/RTK/Ponytail grouping were inspired by
[`@xynogen/pix-optimizer`](https://github.com/xynogen/pix-mono/tree/61da59bb2a954b6af894f55924f7c14eed2d0b0e/packages/pix-optimizer)
(MIT). Caveman traces to
[`juliusbrussee/caveman`](https://github.com/juliusbrussee/caveman), and the
Ponytail ruleset to
[`DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail), both
MIT-licensed. This implementation is intentionally session-scoped, starts off,
hides unavailable RTK, and uses a conservative local command rewriter.

## Install independently

```bash
pi install ./extensions/token-optimizer
```

Or load the repository package and run `/reload`:

```bash
pi install .
```
