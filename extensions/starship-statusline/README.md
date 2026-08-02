# starship-statusline

A configurable [Starship](https://starship.rs)-powered statusline for pi.

- **Left:** Starship directory, local Git branch/status, language, and environment modules
- **Right:** pi provider/model, effort, context usage/cap, and session cost
  (`34% ↑43.5k/↓128k $1.988`)
- **Optional GitHub segment:** clickable PR number for the current branch through `gh`

## Requirements

- `starship` in `PATH`
- A Nerd Font for the bundled preset's symbols
- Optional: an authenticated `gh` CLI if GitHub integration is enabled

## Configuration modes

The initial mode is **default**.

| Mode | Configuration |
|---|---|
| `default` | [Catppuccin Mocha](https://github.com/catppuccin/starship/blob/main/themes/mocha.toml) colors and styling combined with Starship's [Nerd Font Symbols preset](https://starship.rs/presets/nerd-font) |
| `user` | Your normal Starship config (`$STARSHIP_CONFIG` or `~/.config/starship.toml`) |
| `custom` | Any TOML file you select |

Open the interactive selector in pi:

```text
/starship-statusline
```

Or select a mode directly:

```text
/starship-statusline default
/starship-statusline user
/starship-statusline custom ~/.config/pi-starship.toml
```

The selection persists in:

```text
~/.pi/agent/starship-statusline.json
```

Use `/starship-statusline-refresh` to manually refresh the left side.

## Optional segments

Model and Git information are shown by default. Open the interactive segment
picker to toggle either independently:

```text
/starship-statusline-segments
```

Or set them directly:

```text
/starship-statusline-segments model on
/starship-statusline-segments model off
/starship-statusline-segments git on
/starship-statusline-segments git off
```

Turning off Git hides Starship's Git modules and the optional GitHub PR segment.
The choices persist with the other statusline settings.

## Optional GitHub integration

GitHub integration is **off by default**. When enabled, the extension runs
`gh pr view` locally and adds a clickable `PR #N` segment for the current
branch. It does not call GitHub directly.

Use the interactive selector:

```text
/starship-statusline-github
```

Or toggle it directly:

```text
/starship-statusline-github on
/starship-statusline-github off
```

If `gh` is missing, unauthenticated, or the branch has no pull request, the
segment is simply omitted.

## Try locally

From the parent directory:

```bash
pi -e ./starship-statusline/src/index.ts
```

Install the local package:

```bash
pi install /Users/sinabastani/Desktop/projects/my-pi-setup/extensions/starship-statusline
```

When editing an installed extension, run `/reload` in pi.

## Bundled preset

`presets/default.toml` combines:

- Starship's `nerd-font-symbols` preset
- Catppuccin's Mocha palette
- Catppuccin's example styling for the character, Git branch, and directory

The unmodified generated symbol preset is retained at
`presets/nerd-font-symbols.toml`.
