# simply-permission-gate

An interactive safety gate for risky `bash` commands, inspired by
[`adrianapan/pikit/agent/extensions/permission-gate`](https://github.com/adrianapan/pikit/tree/7b6040512b8d005fe5035a60c321b2a0d71b1679/agent/extensions/permission-gate).

It is intentionally small and dependency-free. Ordinary commands pass through
without UI. Commands matching a focused risk rule require an explicit decision:

- **Allow once**
- **Allow this exact command for this session**
- **Deny** (also the result of Escape/cancellation)

In headless, print, RPC, or other sessions without interactive UI, matched
commands are denied by default.

## Built-in risk rules

The gate asks before:

- Recursive `rm`
- `sudo`, `doas`, or `su`
- `chmod`/`chown` with `777` or recursive operation
- Environment dumps through `env`, `printenv`, or bare `set`
- `curl`/`wget` piped or redirected into a shell
- Destructive Git commands such as `reset --hard`, force push, `clean -f`, and
  deleting a branch with `-D`
- Disk/filesystem tools such as `mkfs`, `fdisk`, `parted`, and `dd`
- Shutdown/reboot commands
- Docker/Podman system, image, and volume pruning
- npm/pnpm/yarn publication or unpublication

Rules are fixed in `src/index.ts` so the effective policy is easy to audit. Add or
remove a rule there rather than relying on hidden global configuration.

## Session approvals

“Allow this exact command for this session” approves only the trimmed command
string. A changed argument, path, flag, or shell expression is evaluated again.
Approvals are in memory and disappear when Pi exits.

```text
/permission-gate status   Show rule and approval counts
/permission-gate clear    Forget all session approvals
```

## Read-only mode integration

The local `simply-plan-mode`, pikit's plan mode, and `simply-review` enforce their
own stricter bash policies. While one of those read-only gates is active, this
extension does not ask for redundant approval; the active mode remains responsible
for blocking the command.

## Herdr integration

While an approval dialog is open, the extension emits `herdr:blocked` so Herdr can
show that the agent is waiting for user input. Concurrent approval requests are
serialized to avoid overlapping dialogs.

## Limits

This is a guardrail, not a shell parser or security sandbox. Regex rules can have
false negatives and false positives, aliases/functions can hide behavior, and
apparently safe programs can have side effects. Review commands before approval
and use an OS/container sandbox for untrusted work.

The extension gates only the `bash` tool. Pi's `write` and `edit` tools are not
prompted because their changes remain directly reviewable in the normal tool UI.

## Try without installing

```bash
pi -e ./extensions/permission-gate
```

Test it with harmless commands first, then try a matched command such as
`rm -rf ./temporary-test-directory` and choose **Deny**. Do not use a valuable path
for testing.

## Install independently

```bash
pi install ./extensions/permission-gate
```

Remove it with:

```bash
pi remove ./extensions/permission-gate
```
