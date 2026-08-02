# simply-whimsical

An expanded adaptation of Armin Ronacher's Apache-2.0
[`whimsical.ts`](https://raw.githubusercontent.com/mitsuhiko/agent-stuff/refs/heads/main/extensions/whimsical.ts).

It replaces Pi's working message with hundreds of playful phrases from the
upstream collection. This version keeps a separate pool of fun, exploratory
first-turn messages, uses the full collection for follow-up turns, and avoids
immediate repeats.

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
