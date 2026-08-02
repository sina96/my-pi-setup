# pi-startup

A responsive startup dashboard for Pi, inspired by
[`adrianapan/pikit/agent/extensions/startup`](https://github.com/adrianapan/pikit/tree/7b6040512b8d005fe5035a60c321b2a0d71b1679/agent/extensions/startup).

It replaces the old `pi-header` extension with a bordered, three-column view:

| Column | Content |
|---|---|
| Left | Theme-aware Pi ASCII logo |
| Middle | Counts for models, extensions, skills, MCP servers, prompts, and context files |
| Right | Current keyboard hints for commands, bash, model/thinking cycling, and tool expansion |

The top border includes the Pi version. The layout uses the active Pi theme,
adapts to terminal width, and hides below 44 columns.

The model count matches the available model registry displayed by `/models`. It
is not the active model count and is not limited by the optional model-cycling
scope. A background refresh updates the initial snapshot after provider catalogs
finish loading.

## Nerd Font detection

The box uses a Nerd Font icon when the terminal appears to support one and plain
text otherwise. Override detection when needed:

```bash
export PI_STARTUP_NERD_FONTS=1  # force Nerd Font icon
export PI_STARTUP_NERD_FONTS=0  # force plain text
```

A terminal application cannot select its own font. Configure your terminal to use
a Nerd Font such as JetBrainsMono Nerd Font Mono.

## Avoiding duplicate startup information

Set **Quiet startup** to `true` in `/settings`. This hides Pi's native detailed
resource listing while leaving this custom dashboard visible.

## Try without installing

```bash
pi -e ./extensions/pi-startup
```

## Install independently

```bash
pi install ./extensions/pi-startup
```

Remove it with:

```bash
pi remove ./extensions/pi-startup
```

## Commands

- `/pi-startup-refresh` recounts loaded resources.
- `/builtin-header` restores Pi's built-in header for the current session.
