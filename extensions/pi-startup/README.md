# pi-startup

A responsive startup dashboard for Pi, inspired by
[`adrianapan/pikit/agent/extensions/startup`](https://github.com/adrianapan/pikit/tree/7b6040512b8d005fe5035a60c321b2a0d71b1679/agent/extensions/startup).

It replaces the old `pi-header` extension with a bordered, three-column view:

| Column | Content |
|---|---|
| Left | Upstream Pi pixel-logo silhouette, enlarged 3× and colored with the theme's `accent` |
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

Set **Quiet startup** to `"header"` in `/settings`. This hides Pi's native detailed
resource listing while keeping its real header available for restoration. The
custom dashboard replaces that header. `true` also works for the dashboard, but
Pi then does not create its native header, so restoring it requires a restart.

## Original Pi preset

With `simply-theme-picker` loaded, select **Original Pi** in `/theme`, or run
`/theme Original Pi`. This uses Pi's native `system` palette and restores its
built-in header. It does not change your footer/editor extensions or add an
animation to the dashboard. The native header retains Pi's own behavior.

The preset saves `theme: "system"`, `quietStartup: false`, and the extension's
`piStartupHeader: "builtin"` preference in the agent settings file (by default
`~/.pi/agent/settings.json`). Restart Pi for the complete native
startup header/resource listing, particularly if quiet startup was previously
`true`. A theme selected through `/theme` instead saves `piStartupHeader:
"dashboard"` and `quietStartup: "header"`, restoring this dashboard immediately
and suppressing duplicate resource listings on the next startup.

`/settings` and CLI theme overrides change colors without changing this header
preference. Use `/theme` for the combined color/header preset. No upstream source
patch or duplicate `system` theme JSON is needed.

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
