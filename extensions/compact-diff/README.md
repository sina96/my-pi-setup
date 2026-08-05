# compact-diff

A small, dependency-free Git diff viewer for Pi. It opens `/diff` in a centered
popup, supports Vim and arrow-key navigation, can prepare focused analysis
prompts, and opens the selected working-tree file with Zed or tools in a Herdr
pane.

## Usage

```text
/diff
/diff --cached
/diff main...HEAD
/diff -- src/index.ts
```

Arguments are passed to `git diff`. For safety, `--ext-diff`, `--textconv`, and
`--output` are rejected. Diff output is limited to 10 MiB.

## Keys

| Key | Action |
| --- | --- |
| `j` / `k`, `↑` / `↓` | Move one line |
| `n` / `p`, `→` / `←` | Next/previous hunk |
| `]` / `[` | Next/previous file |
| `Ctrl-d` / `Ctrl-u`, `PgDn` / `PgUp` | Move half a page |
| `g` / `G` | First/last line |
| `o` | Open the file-action palette |
| `a` | Put a current-hunk analysis prompt in Pi's editor |
| `A` | Put a complete-diff analysis prompt in Pi's editor |
| `q`, `Esc`, `Ctrl-c` | Close |

The open palette provides:

- `z` — open the current file and line in Zed, VS Code, or VSCodium
- `n` — open it in Neovim, or fall back to Vim, in a focused Herdr pane
- `b` — open it with `bat`, or fall back to `cat`, in a focused Herdr pane
- `r` — reveal it in Finder or the platform file manager
- `y` — copy `path:line`

Removed lines open without a line number because their old line does not
necessarily exist in the working-tree file. Deleted files report a clear error.
Analysis is drafted rather than submitted automatically so it can be reviewed or
edited first.

## Requirements

- Pi interactive TUI
- Git
- Optional: Zed, VS Code, or VSCodium CLI
- Optional: Herdr plus Neovim/Vim or bat/cat

## Try independently

```bash
pi -e ./extensions/compact-diff
```

The open palette is capability-aware: pane actions are hidden outside Herdr,
Neovim falls back to Vim, `bat` falls back to `cat`, and the graphical-editor
action is hidden when neither Zed nor a VS Code-compatible CLI is available.
The action executor still revalidates availability in case the environment
changes after the popup opens.

Do not load it alongside another extension that registers `/diff`.
