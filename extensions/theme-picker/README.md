# simply-theme-picker

A fuzzy, live-preview theme picker for Pi. Inspired by the MIT-licensed
[`ldelossa/pi-theme-picker`](https://github.com/ldelossa/pi-theme-picker).

This extension does not bundle themes. It uses Pi's theme registry, so it sees
built-in themes plus valid global, project-local, CLI, settings, and
package-provided themes. When the complete `my-pi-setup` package is installed,
the repository themes are registered by its root package manifest.

## Usage

```text
/theme             Open the interactive picker
/theme dark        Apply a theme directly
```

The direct command is case-insensitive and supports argument completion.

The picker opens as a centered, Neovim-style popup with the theme list on the
left and an isolated sample UI on the right. The preview includes core text,
status colors, selections, user and extension messages, tool states, Markdown,
TypeScript syntax, diffs, and thinking levels.

Inside the picker:

- Type to fuzzy-filter theme names.
- Use Up/Down or Page Up/Page Down to change the isolated preview.
- Use Backspace to edit the query and `Ctrl+U` to clear it.
- Press Enter to apply and save the selected theme.
- Press Escape to cancel without changing the active theme.

Browsing does not call Pi's global `setTheme`, so a large session is not
recolored and rerendered for every highlighted option. The selected theme is
applied to the full session only after Enter is pressed.

Selections are persisted as `theme` in `~/.pi/agent/settings.json`. If persistence
fails, the theme remains active for the current session and a warning is shown.

## Why this version is safe to add back

The previous local theme picker was coupled to custom theme files that could fail
Pi startup when a configured theme was missing or invalid. This version:

- Does not ship or assume any custom theme JSON.
- Discovers only themes already registered successfully by Pi.
- Does not alter either the configured or in-memory session theme until Enter is pressed.
- Renders candidate colors only inside the bounded preview popup.
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
