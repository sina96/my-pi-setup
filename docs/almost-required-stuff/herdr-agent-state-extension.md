# herdr-agent-state

Reports Pi's agent state (`working`, `blocked`, `idle`) to herdr over a local unix
socket so the herdr sidebar shows live status for each agent pane.

Installed and managed automatically by herdr's Pi integration
(`HERDR_INTEGRATION_ID=pi`). The extension is only active when `HERDR_ENV=1`.

## Install

Installed automatically by herdr when it detects Pi. see [herdr's integrations docs](https://herdr.dev/docs/integrations/#install-integrations)
The integration places `herdr-agent-state.ts` in your extensions directory. If it is missing, reinstall
the herdr Pi integration or copy the file from a working herdr setup.

Herdr overwrites this file on integration updates — add custom hooks beside it
rather than editing it directly.

## Verify

The extension should appear in herdr's Pi integration directory. Check that
`HERDR_ENV=1` and `HERDR_SOCKET_PATH` are set in your shell when running inside
herdr.
