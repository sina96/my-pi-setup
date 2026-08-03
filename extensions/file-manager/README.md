# File Manager

A Neovim-style `/files` browser for Pi, backed by the same fast command-line stack as `simply-file-search`:

- `fd` discovers files while respecting ignore files.
- `fzf` ranks filename matches.
- `rg` searches file contents, with optional `fzf` ranking.

## Requirements

`fd` is required. `rg` and `fzf` are optional but recommended. Herdr is required only for the `bat` and `nvim` pane actions. Zed actions use `zed` from `PATH`, or Zed.app's bundled CLI on macOS.

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
- `z` or Enter — open in Zed
- `b` — open with `bat` in a new focused Herdr pane
- `n` — open with Neovim in a new focused Herdr pane
- `d` — open a HEAD-versus-working-copy diff in Zed
- `q` — close

Content-search results retain their line and column when opened in Zed. The `bat` and Neovim actions also jump to or highlight the matching line.

The extension fails cleanly when an optional application or Herdr is unavailable. It does not replace Pi's built-in `@` completion or register additional model tools.
