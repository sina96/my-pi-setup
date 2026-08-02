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

Use `/permission-gate rule list` to open the rule browser. Each row starts with
the effective scope (`GLOBAL`, `PROJECT`, or `SESSION`) and shows the rule name,
ID, and as much of its guarded operations as fits on one line. Built-in defaults
appear under `GLOBAL`; selecting one identifies its origin as a built-in default.
Custom rules show their regex when no friendly operation summary is configured.

The browser shows only effective rules. When a project or session rule replaces
an inherited rule with the same ID, the overridden version is omitted.

## Rule scopes and precedence

Rules can be customized at three scopes. They are applied in this order:

1. Built-in defaults
2. Global config
3. Trusted project config
4. Session rules

A later rule with the same ID replaces an earlier rule. A config file can remove
an inherited rule by listing its ID under `disabledRules`.

Config changes are loaded on session startup, session tree navigation, or
`/reload`. Rules added through commands become active immediately.

### Commands for every scope

Use the same command shape for session, project, and global rules:

```text
/permission-gate rule add <scope> <id> <label> :: <regex>
/permission-gate rule remove <scope> <id>
```

`<scope>` is `session`, `project`, or `global`. If omitted, it defaults to
`session` for backwards compatibility.

```text
# Current session branch only
/permission-gate rule add session all-git All Git operations :: \bgit\b

# Current trusted project; writes .pi/permission-gate.json
/permission-gate rule add project production-deploy Production deployment :: \bdeploy\s+production\b

# Every project; writes ~/.pi/agent/permission-gate.json
/permission-gate rule add global all-git All Git operations :: \bgit\b
```

Rules added by command are case-insensitive. Edit the JSON directly when you
need other regex flags or want to use `disabledRules`.

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
any command containing the `git` token. You can produce the same added rule
without manually editing JSON:

```text
/permission-gate rule add global all-git-operations All Git operations :: \bgit\b
```

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

The command equivalent is:

```text
/permission-gate rule add project production-deploy Production deployment :: \bdeploy\s+(?:--env[= ]|)(?:prod|production)\b
```

### Ask the agent to configure it

You do not need to write the JSON or regular expressions yourself. Ask the agent
to inspect the commands you want protected, propose a narrowly scoped regex,
and update the global or project config. For example:

```text
Add a project permission-gate rule for terraform apply and terraform destroy.
Show me the regex and config change before finishing.
```

```text
Update my global permission-gate policy so every kubectl delete requires
approval. Preserve all existing rules.
```

The agent can edit `.pi/permission-gate.json` or
`~/.pi/agent/permission-gate.json` directly. Review the resulting regex because
permission rules are guardrails rather than a complete shell parser.

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
escaped, so regex `\bgit\b` is written as `"\\bgit\\b"`. Add an optional
`"operations"` string when you want the rule browser to show a friendly summary
instead of the regex.

## Session rules

Session rules are stored in the Pi session branch and do not modify global or
project files.

For example, require approval for every Git operation in the current session:

```text
/permission-gate rule add session all-git All Git operations :: \bgit\b
```

The shorter form still defaults to session scope:

```text
/permission-gate rule add all-git All Git operations :: \bgit\b
```

Open the interactive rule browser or remove the session rule:

```text
/permission-gate rule list
/permission-gate rule remove session all-git
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

## Approval prompt and transcript scrolling

In TUI mode, approval is a compact widget below the editor instead of a centered
modal. It does not take focus, and the animated working row is paused while Pi
waits. The full tool call remains in the transcript, so you can scroll up to
inspect the command and surrounding code, then return to the bottom and choose:

```text
[1] Allow once
[2] Allow this exact command for the session
[3] Deny
```

Escape and Ctrl+C also deny. Approval input is consumed so it is not inserted
into the editor. Native terminal scrollback does not trigger a Pi rerender, which
avoids the old snap-to-dialog behavior. If a terminal is configured to send
wheel events to applications instead of opening scrollback, use its native
scrollback modifier (commonly Shift while scrolling); this is terminal behavior
outside the extension API.

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
