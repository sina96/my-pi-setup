# pi-fff

This directory intentionally does not vendor third-party source. Use the published
Pi package [`@ff-labs/pi-fff`](https://pi.dev/packages/@ff-labs/pi-fff), currently
maintained at [dmtrKovalenko/fff](https://github.com/dmtrKovalenko/fff).

FFF provides pre-indexed, Rust-native fuzzy file and content search, frecency and
history ranking, Git-aware boosts, cursor pagination, multi-pattern grep, and
optional `@` autocomplete integration.

## Try without installing

Default tools plus FFF-backed `@` autocomplete:

```bash
pi -e npm:@ff-labs/pi-fff
```

Tools only, preserving Pi's default `@` autocomplete:

```bash
pi -e npm:@ff-labs/pi-fff --fff-mode tools-only
```

To try it alongside this repository's simpler `fd`/`rg`/`fzf` extension:

```bash
pi \
  -e npm:@ff-labs/pi-fff \
  -e ./extensions/simply-file-search \
  --fff-mode tools-only
```

## Install

```bash
pi install npm:@ff-labs/pi-fff
```

Project-local:

```bash
pi install -l npm:@ff-labs/pi-fff
```

Remove it with:

```bash
pi remove npm:@ff-labs/pi-fff
```

## Modes

- `tools-and-ui` (default): adds `fffind`, `ffgrep`, and `fff-multi-grep`, and
  replaces `@` autocomplete.
- `tools-only`: adds the tools but leaves default autocomplete alone.
- `override`: replaces built-in `find` and `grep`; avoid this mode while comparing
  fallback behavior with `simply-file-search`.

## Security and state

Pi packages execute with your user permissions. Review the upstream source before
installing. Upstream states that the extension runs locally with no shell execution,
network calls, telemetry, or credential handling; optional search state is stored
under `~/.pi/agent/fff/`.
