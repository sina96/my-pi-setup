# herdr-blocked-state

A small infrastructure extension that turns shared `herdr:blocked` events into
Herdr agent-state reports over the active session socket.

`ask-user` and `permission-gate` emit these events while their dialogs wait for
input. This reporter marks the pane as **blocked** with the supplied label and
releases its report when the dialog closes, leaving Herdr's generated Pi
integration responsible for ordinary working, idle, retry, and shutdown state.

The extension is a no-op outside Herdr or when the pane/socket environment is
unavailable. It registers no commands or tools.

The root setup loads this extension automatically. Independent installations
that need blocked-state reporting should install it alongside the prompting
extension:

```bash
pi install ./extensions/herdr-blocked-state
```
