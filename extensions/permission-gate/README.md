# simply-permission-gate

An interactive safety gate for risky shell commands and sensitive file access,
inspired by
[`adrianapan/pikit/agent/extensions/permission-gate`](https://github.com/adrianapan/pikit/tree/7b6040512b8d005fe5035a60c321b2a0d71b1679/agent/extensions/permission-gate)
and informed by
[`@xynogen/pix-gate`](https://github.com/xynogen/pix-mono/tree/61da59bb2a954b6af894f55924f7c14eed2d0b0e/packages/pix-gate).

Ordinary operations pass through without UI. Matched operations are classified:

- **Critical** — deny-first, 15-second timeout, allow once only
- **Dangerous** — allow-first, 30-second timeout, with exact-command session approval for Bash
- **Risky** — allow-first, 60-second timeout, with exact-command session approval for Bash

Escape, cancellation, and every timeout deny. In headless, print, JSON, or other
sessions without interactive UI, every matched command or path access is denied
regardless of severity.

## Built-in rules

The gate asks before:

- Recursive `rm`; deleting `/`, `~`, or `$HOME` with recursive force is critical
- `sudo`, `doas`, or `su`
- `chmod`/`chown` with `777` or recursive operation
- Environment dumps through `env`, `printenv`, or bare `set`
- `curl`/`wget` piped or redirected into a shell (critical)
- Destructive Git commands such as `reset --hard`, force push, `clean -f`,
  deleting a branch with `-D`, forced checkout, and `stash drop`
- Filesystem formatting, partitioning, raw-device writes, and `dd`
- Fork bombs and `kill -9 -1`
- Shutdown/reboot commands
- Docker/Podman pruning, forced container removal, and volume removal
- npm/pnpm/yarn publication or unpublication
- Shell redirection into `.env` files

Use `/permission-gate rule list` to open the command-rule browser. Each row starts with
the effective scope (`GLOBAL`, `PROJECT`, or `SESSION`) and shows the rule name,
ID, and as much of its guarded operations as fits on one line. Built-in defaults
appear under `GLOBAL`; selecting one identifies its origin as a built-in default.
Custom rules show their regex when no friendly operation summary is configured.
The browser also shows each rule's effective severity.

The browser shows only effective command rules. When a project or session rule replaces
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

Rules added by command are case-insensitive and default to `dangerous`. Edit the
JSON directly when you need another severity (`critical`, `dangerous`, or
`risky`), other regex flags, or `disabledRules`.

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
      "flags": "i",
      "severity": "risky"
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
      "flags": "i",
      "severity": "critical"
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

Disable all command and sensitive-path permission prompts for the current
session branch:

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

In TUI mode, approval uses the same built-in bottom selector as `ask_user`. The
selector title stays deliberately short; it does not duplicate a long shell
command. The pending Bash tool call remains directly above in the transcript.

Use the mouse wheel to inspect earlier code and the full command, return to the
bottom, then use Up/Down and Enter to choose **Allow once**, **Allow this exact
command for this session**, or **Deny**. Escape and Ctrl+C deny.

Keeping the full command out of the selector is important: a large multi-line
title forces Pi to repeatedly lay out a tall active component, which caused the
old snap-to-bottom behavior. The compact selector behaves like `ask_user` while
preserving the complete command in the normal tool-call display.

## Exact-command approvals

“Allow this exact command for this session” approves only the trimmed command
string. A changed argument, path, flag, or shell expression is evaluated again.
Critical operations and direct file/search tool access never offer persistent
approval. Exact-command approvals are cleared for each fresh Pi session and
when the extension reloads.

```text
/permission-gate status   Show gate, rule, and approval status
/permission-gate clear    Forget exact-command approvals
```

## Sensitive-path protection

The gate also checks explicit paths used by Pi's `read`, `write`, and `edit`
tools and this setup's `simply_find` and `simply_grep` tools. Bash commands get a
conservative explicit-path scan as a secondary guard.

Deny-first protection covers SSH private keys, keystores, cloud/service
credentials, and `.netrc`. Warnings cover PEM files, real `.env` files (but not
`.env.example`, `.env.sample`, or `.env.template`), package registry credentials,
secret files, and `.ssh` directories. Writes into `.git` and `node_modules`
produce informational notices. A broad `simply_grep` search with `hidden: true`
is classified as risky because it can include credential files; ordinary
`simply_find` only lists names and is not prompted unless its explicit search
path is itself sensitive.

Path matching is intentionally conservative and still is not a data-loss
prevention sandbox. Search tools, aliases, extension-owned subprocesses, and
indirect paths can evade regex inspection.

## Read-only mode integration

The local `simply-plan-mode`, pikit's plan mode, and `simply-review` enforce their
own stricter bash policies. While one of those read-only gates is active, this
extension does not ask for redundant approval; the active mode remains
responsible for blocking the command.

## Herdr integration

While an approval dialog is open, the extension emits `herdr:blocked` so Herdr
can show that the agent is waiting for user input. The root setup's
`herdr-blocked-state` extension forwards that event to Herdr's socket; install it
alongside an independent permission-gate installation when this integration is
wanted. Concurrent approval requests are serialized to avoid overlapping
dialogs.

## Limits

This is a guardrail, not a shell parser, data-loss prevention system, or security
sandbox. Regex rules can have false negatives and false positives,
aliases/functions can hide behavior, and apparently safe programs can have side
effects. Review operations before approval and use an OS/container sandbox for
untrusted work.

The extension gates the agent's `bash`, `read`, `write`, `edit`, `simply_find`,
and `simply_grep` tool calls. User-entered `!` commands, other custom tools, and
shell execution performed internally by extensions are not prompted.

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
