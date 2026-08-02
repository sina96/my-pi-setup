# simply-pi-clip

A compact clipboard helper inspired by the MIT-licensed
[`bigboss2063/pi-clip`](https://github.com/bigboss2063/pi-clip).

Pi already copies the complete last assistant response through its built-in copy
action. This extension is for copying one precise piece without terminal mouse
selection.

## Commands

```text
/clip                         Pick a structural block from the last response
/clip code                    Copy/select a fenced code block
/clip code 2                  Copy the second code block directly
/clip table [N]               Copy a whole Markdown table
/clip list [N]                Copy a Markdown list
/clip quote [N]               Copy a blockquote
/clip lines 4-9               Copy an inclusive response line range
/clip lines                   Prompt for a line or range
/clip response                Copy the raw last assistant response
/clip prompt                  Copy the latest user prompt
/clip conversation            Copy user/assistant text from the session branch
```

`/clip all` and `/clip last` are accepted aliases for `conversation` and
`response`.

If `/clip` finds no code, table, list, or quote blocks, it copies the complete last
response directly. With multiple blocks, Pi's built-in themed selector is used.

## Deliberate differences from upstream

This version is optimized for a small, auditable setup:

- Uses Pi's built-in `select`, `input`, and `confirm` dialogs.
- Has no custom overlay renderer, table cell grid, fuzzy filter, or visual line
  window.
- Copies tables whole; use `/clip lines` for a narrower selection.
- Adds `/clip prompt`, which is useful for reusing coding requests.
- Requires interactive confirmation before copying the full conversation.
- Does not register `Ctrl+Shift+C`, avoiding conflicts with terminal/OS copy.
- Has no external clipboard command or dependency.

For searchable live previews, table cell/row/column selection, and a visual line
range editor, the upstream `npm:@bigboss2063/pi-clip` is the better option. Do not
load both because both register `/clip`.

## Clipboard and privacy

Clipboard writes use Pi's built-in `copyToClipboard`, which supports the native
clipboard and Pi's terminal fallbacks such as OSC 52. Tool results and thinking
blocks are excluded; conversation export includes only user and assistant text.

Full-conversation copying is refused outside interactive TUI mode because a branch
may contain prompts, paths, source code, or secrets. Structural and direct-range
copies remain explicit commands.

## Try without installing

```bash
pi -e ./extensions/pi-clip
```

## Install independently

```bash
pi install ./extensions/pi-clip
```

Remove it with:

```bash
pi remove ./extensions/pi-clip
```
