# simply-file-search

A small, local Pi extension inspired by
[`davis7dotsh/my-pi-setup/extensions/file-search`](https://github.com/davis7dotsh/my-pi-setup/tree/4a37b7830bda00d4a7e861218f70e70097ddf2e8/extensions/file-search).

It prefers executables already available in `PATH` and never downloads binaries:

- `simply_find` uses `fd`; when `fzf` is also present, queries are fuzzy-ranked
  through `fzf`.
- `simply_grep` uses `ripgrep` (`rg`).
- `/simply-file-search-health` reports detected binary paths.

The extension does **not** replace Pi's built-in `find` or `grep`. It registers a
custom tool only when its required executable exists and tells the agent to prefer
that tool. Pi's built-ins stay active as fallbacks. `fzf` is an optional enhancer;
missing `fzf` falls back to normal `fd` matching.

Outputs are bounded, truncated at Pi's standard 2,000-line/50KB limit, and saved
to a temporary file if byte truncation is necessary.

## Requirements

Install any combination you want:

```bash
brew install fd ripgrep fzf
```

On this machine all three are currently available.

## Try without installing

```bash
pi -e ./extensions/simply-file-search
```

Then run `/simply-file-search-health` or ask Pi to find a file/search content.

## Install independently

```bash
pi install ./extensions/simply-file-search
```

Remove it with:

```bash
pi remove ./extensions/simply-file-search
```

## Why not override built-ins?

Keeping distinct tool names makes fallback reliable. If a binary disappears or a
custom search fails, the agent can still call Pi's normal `find` or `grep` tools.
It also makes this package safe to try alongside `pi-fff`.
