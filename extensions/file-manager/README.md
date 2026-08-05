# File Manager

A Neovim-style `/files` browser for Pi, backed by the same fast command-line stack as `simply-file-search`:

- `fd` discovers files while respecting ignore files.
- `fzf` ranks filename matches.
- `rg` searches file contents, with optional `fzf` ranking.

## Requirements

`fd` is required. `rg` and `fzf` are optional but recommended. Herdr is required only for terminal pane actions. Terminal editing prefers Neovim and falls back to Vim; file viewing prefers `bat` and falls back to `cat`. Editor actions prefer Zed, then fall back to VS Code (`code`, `code-insiders`, or `codium`, including common macOS app paths).

The popup discovers these capabilities when `/files` opens. Unavailable actions and their keys are omitted from the help row instead of producing expected runtime errors.

## Usage

```text
/files
```

The browser starts in Normal mode.

- `i` or `/` — enter Insert mode and search
- `Esc` — return to Normal mode
- `j`/`k` or arrows — move
- `g`/`G` — first/last result
- `Tab` — switch between filename and content search
- `y` — copy the absolute path to the clipboard
- `r` — reveal in Finder (or the platform file manager)
- `z` or Enter — open in Zed, VS Code, or VSCodium
- `b` — open with `bat`, or fall back to `cat`, in a new focused Herdr pane
- `n` — open with Neovim, or fall back to Vim, in a new focused Herdr pane
- `d` — open a HEAD-versus-working-copy diff in Zed, VS Code, or VSCodium
- `q` — close

Content-search results retain their line and column when opened in Zed or a VS Code-compatible editor. Neovim, Vim, and `bat` also jump to or highlight the matching line; plain `cat` has no line highlighting. Outside Herdr, the `n` and `b` actions are hidden. If no graphical editor is available, `z`, Enter-to-open, and `d` are disabled and omitted.

The extension fails cleanly when an optional application or Herdr is unavailable. It does not replace Pi's built-in `@` completion or register additional model tools.
