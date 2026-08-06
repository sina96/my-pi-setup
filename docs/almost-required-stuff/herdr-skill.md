# herdr

Control [herdr](https://herdr.dev) from inside it — manage workspaces, tabs, split
panes, spawn agents, read output, and wait for state changes via CLI commands over
a local unix socket.

This skill is only active when `HERDR_ENV=1` (i.e. when running inside a
herdr-managed pane).

## Install globally

Installed automatically by herdr's Pi integration. If missing, copy the skill
manually to `~/.agents/skills/herdr/`. or in the project level.

## Verify

```bash
ls ~/.agents/skills/herdr/SKILL.md
```
