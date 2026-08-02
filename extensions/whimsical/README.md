# simply-whimsical

A restrained version of Armin Ronacher's Apache-2.0
[`whimsical.ts`](https://raw.githubusercontent.com/mitsuhiko/agent-stuff/refs/heads/main/extensions/whimsical.ts).

It replaces Pi's working message with a small set of coding-focused, lightly
playful phrases. This local version uses roughly two dozen curated messages
instead of hundreds, avoids immediate repeats, and uses calmer first-turn text
while the agent is still inspecting the project.

```text
/whimsy          Toggle for the current session branch
/whimsy on       Enable
/whimsy off      Disable
/whimsy status   Show current state
```

The choice is stored in the Pi session and follows session branches. It does not
change global settings. The normal Pi working message is restored after each
turn and immediately when disabled.

## Try without installing

```bash
pi -e ./extensions/whimsical
```

## Install independently

```bash
pi install ./extensions/whimsical
```

Remove it with:

```bash
pi remove ./extensions/whimsical
```

Do not combine it with another extension that owns `setWorkingMessage`; the last
extension to update that shared UI slot wins.
