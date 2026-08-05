# simply-ask-user

A small `ask_user` tool for Pi, inspired by:

- [`edlsh/pi-ask-user`](https://github.com/edlsh/pi-ask-user)
- [`davis7dotsh/my-pi-setup/extensions/ask-user`](https://github.com/davis7dotsh/my-pi-setup/tree/4a37b7830bda00d4a7e861218f70e70097ddf2e8/extensions/ask-user)

The agent can ask one focused question with:

- An optional context summary
- Up to eight choices
- Optional freeform response
- Optional timeout
- Structured result details
- Graceful headless fallback
- `herdr:blocked` events while waiting

It uses Pi's built-in `select` and `input` dialogs instead of maintaining a large
custom TUI. There are no runtime dependencies beyond Pi. In this root setup,
`herdr-blocked-state` forwards the tool's `herdr:blocked` events to Herdr; install
that reporter alongside an independent ask-user installation when blocked-state
reporting is wanted.

## When the upstream package is better

Use [`pi-ask-user`](https://github.com/edlsh/pi-ask-user) instead when you need:

- Searchable long option lists
- Multi-select
- Split-pane descriptions
- Overlay/inline modes and overlay hiding
- Optional comments/extra context
- Advanced responsive behavior for small terminals
- A bundled decision-gating skill
- Its extensive test suite and active upstream maintenance

The upstream package is the safer general-purpose choice. This local extension is
preferable only when a small, auditable implementation covers your needs. Do not
load both: each registers a tool named `ask_user`.

## Try this extension without installing

```bash
pi -e ./extensions/ask-user
```

## Install independently

```bash
pi install ./extensions/ask-user
```

Remove it with:

```bash
pi remove ./extensions/ask-user
```

## Try the upstream package instead

```bash
pi -e npm:pi-ask-user
```

Install it with:

```bash
pi install npm:pi-ask-user
```

## Tool shape

```json
{
  "question": "Which database should we use?",
  "context": "Both options meet the current scale requirements.",
  "options": [
    { "label": "SQLite", "description": "Simple, local, zero administration" },
    { "label": "PostgreSQL", "description": "Networked and easier to scale" }
  ],
  "allowFreeform": true,
  "timeout": 120000
}
```
