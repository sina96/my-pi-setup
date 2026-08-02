# simply-theme-picker

A fuzzy, live-preview theme picker for Pi. Inspired by the MIT-licensed
[`ldelossa/pi-theme-picker`](https://github.com/ldelossa/pi-theme-picker).

This extension does not bundle themes. It uses Pi's theme registry, so it sees
built-in themes plus valid global, project-local, CLI, settings, and
package-provided themes.

Repository themes such as [`../../themes/nightowl.json`](../../themes/nightowl.json)
must be registered with Pi before the picker can see them. This setup registers
the repository's `themes/` directory through the global `themes` array in
`~/.pi/agent/settings.json`. On another machine, update that path to the local
checkout location.

## Usage

```text
/theme             Open the interactive picker
/theme dark        Apply a theme directly
```

The direct command is case-insensitive and supports argument completion.

Inside the picker:

- Type to fuzzy-filter theme names.
- Use Up/Down to preview the highlighted theme immediately.
- Use Backspace to edit the query and `Ctrl+U` to clear it.
- Press Enter to apply and save the selected theme.
- Press Escape to cancel and restore the original theme.

Selections are persisted as `theme` in `~/.pi/agent/settings.json`. If persistence
fails, the theme remains active for the current session and a warning is shown.

## Why this version is safe to add back

The previous local theme picker was coupled to custom theme files that could fail
Pi startup when a configured theme was missing or invalid. This version:

- Does not ship or assume any custom theme JSON.
- Discovers only themes already registered successfully by Pi.
- Does not alter the configured theme until Enter is pressed.
- Restores the original in-memory theme on cancellation.
- Leaves the current `dark` fallback valid even if this extension is removed.

## Try without installing

```bash
pi -e ./extensions/theme-picker
```

## Install independently

```bash
pi install ./extensions/theme-picker
```

Remove it with:

```bash
pi remove ./extensions/theme-picker
```

Removing the extension does not remove themes or change the theme currently saved
in Pi settings.
