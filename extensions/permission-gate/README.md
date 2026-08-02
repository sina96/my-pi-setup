# simply-permission-gate

An interactive safety gate for risky `bash` commands, inspired by
[`adrianapan/pikit/agent/extensions/permission-gate`](https://github.com/adrianapan/pikit/tree/7b6040512b8d005fe5035a60c321b2a0d71b1679/agent/extensions/permission-gate).

Ordinary commands pass through without UI. Commands matching a risk rule require
an explicit decision:

- **Allow once**
- **Allow this exact command for this session**
- **Deny** (also the result of Escape/cancellation)

In headless, print, JSON, or other sessions without interactive UI, matched
commands are denied by default.

## Built-in rules

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

Use `/permission-gate rule list` to see every active rule, its stable ID, source,
and regular expression.

## Rule scopes and precedence

Rules can be customized at three scopes. They are applied in this order:

1. Built-in defaults
2. Global config
3. Trusted project config
4. Session rules

A later rule with the same ID replaces an earlier rule. A config file can remove
an inherited rule by listing its ID under `disabledRules`.

Config changes are loaded on session startup, session tree navigation, or
`/reload`.

### Global rules

Create `~/.pi/agent/permission-gate.json` to apply rules in every project:

```json
{
  "disabledRules": ["package-publication"],
  "rules": [
    {
      "id": "all-git-operations",
      "label": "all Git operations",
      "pattern": "\\bgit\\b",
      "flags": "i"
    }
  ]
}
```

This example removes the built-in package-publication rule and adds a prompt for
any command containing the `git` token.

### Directory/project rules

Create `.pi/permission-gate.json` in a project:

```json
{
  "rules": [
    {
      "id": "production-deploy",
      "label": "production deployment",
      "pattern": "\\bdeploy\\s+(?:--env[= ]|)(?:prod|production)\\b",
      "flags": "i"
    }
  ]
}
```

Project config is read only after the project is trusted. Commit this file when
the policy should be shared with the project. Add it to `.gitignore` when it is
only for your local checkout.

### Updating or disabling a built-in rule

Find the built-in ID with `/permission-gate rule list`. To replace its regex,
define a rule with the same ID:

```json
{
  "rules": [
    {
      "id": "recursive-file-deletion",
      "label": "any rm operation",
      "pattern": "\\brm\\b",
      "flags": "i"
    }
  ]
}
```

To disable it instead:

```json
{
  "disabledRules": ["recursive-file-deletion"]
}
```

Valid regex flags are `i`, `m`, `s`, and `u`. JSON requires backslashes to be
escaped, so regex `\bgit\b` is written as `"\\bgit\\b"`.

## Session rules

Session rules are stored in the Pi session branch and do not modify global or
project files.

Add a case-insensitive rule with:

```text
/permission-gate rule add <id> <label> :: <regex>
```

For example, require approval for every Git operation in the current session:

```text
/permission-gate rule add all-git All Git operations :: \bgit\b
```

List active rules or remove a session rule:

```text
/permission-gate rule list
/permission-gate rule remove all-git
```

Session rules can replace a configured rule by using the same ID. The original
configured rule returns when the session rule is removed.

## YOLO mode

Disable all permission-gate prompts for the current session branch:

```text
/permission-gate yolo-mode
```

Restore the gate or inspect its state:

```text
/permission-gate yolo-mode off
/permission-gate yolo-mode status
```

`yolo-mode` is deliberately session-scoped and emits a visible warning when it
is enabled. It does not modify global or project configuration. Plan mode and
review mode still enforce their own independent read-only restrictions.

## Exact-command approvals

“Allow this exact command for this session” approves only the trimmed command
string. A changed argument, path, flag, or shell expression is evaluated again.
Exact-command approvals are kept in memory and disappear when Pi exits.

```text
/permission-gate status   Show gate, rule, and approval status
/permission-gate clear    Forget exact-command approvals
```

## Read-only mode integration

The local `simply-plan-mode`, pikit's plan mode, and `simply-review` enforce their
own stricter bash policies. While one of those read-only gates is active, this
extension does not ask for redundant approval; the active mode remains
responsible for blocking the command.

## Herdr integration

While an approval dialog is open, the extension emits `herdr:blocked` so Herdr
can show that the agent is waiting for user input. Concurrent approval requests
are serialized to avoid overlapping dialogs.

## Limits

This is a guardrail, not a shell parser or security sandbox. Regex rules can have
false negatives and false positives, aliases/functions can hide behavior, and
apparently safe programs can have side effects. Review commands before approval
and use an OS/container sandbox for untrusted work.

The extension gates only the agent's `bash` tool. Pi's `write` and `edit` tools,
user-entered `!` commands, and shell execution inside other extension tools are
not prompted.

## Try without installing

```bash
pi -e ./extensions/permission-gate
```

Test it with a harmless command first, then try a matched command such as
`rm -rf ./temporary-test-directory` and choose **Deny**. Do not use a valuable
path for testing.

## Install independently

```bash
pi install ./extensions/permission-gate
```

Remove it with:

```bash
pi remove ./extensions/permission-gate
```
