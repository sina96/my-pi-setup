# simply-review

A compact, read-only code review workflow based on Armin Ronacher's Apache-2.0
[`review.ts`](https://raw.githubusercontent.com/mitsuhiko/agent-stuff/refs/heads/main/extensions/review.ts).

This version is tailored to this setup's safety and modularity preferences:

- It **never checks out a branch or PR**.
- It does not create session branches, run autonomous fix loops, or implement
  findings.
- Review mode temporarily exposes only inspection tools.
- `bash` receives a second conservative read-only allowlist.
- The exact previously active tool set is restored when the review ends.
- It refuses to overlap with local PLAN/EXECUTE mode.
- GitHub PR review uses `gh pr view` and `gh pr diff` without touching the worktree.

## Usage

```text
/review                         Smart interactive scope picker
/review changes                 Staged, unstaged, and untracked changes
/review staged                  Staged changes only
/review branch                  Changes against detected default branch
/review branch origin/main      Changes against a specified base
/review commit HEAD~1           One validated commit
/review last                    Latest commit
/review paths src test          Snapshot review of project paths
/review pr 123                  GitHub PR without checkout
/review status                  Show whether review mode is active
/review off                     Abort review mode and restore tools
```

Add one review-specific focus after ` -- `:

```text
/review changes -- focus on error handling and backwards compatibility
```

Quoted paths and refs are supported. Paths must exist inside the current Git
repository.

## Review lifecycle

1. The extension validates the repository and target using argument-safe
   `pi.exec` calls rather than shell interpolation.
2. It saves the currently active tools and switches to known inspection tools.
3. A themed `REVIEW · read-only` widget appears.
4. The agent receives a concise review rubric and target-specific instructions.
5. On `agent_end`, previous tools are restored automatically.

This is intentionally a single review turn in the current session. There is no
`/end-review`, hidden branch navigation, or automatic fix pass. If findings should
be implemented, review them first, then ask the agent separately or create a plan
with `/plan`.

## Review output

The rubric requires:

- Prioritized, evidenced findings with short file/line locations
- `correct` or `needs attention` verdict
- Concrete validation gaps
- Non-blocking human callouts for migrations, dependencies, auth, compatibility,
  and destructive operations

It excludes speculative issues, ordinary style feedback, and pre-existing bugs in
diff-based reviews.

If `REVIEW_GUIDELINES.md` exists at the current working directory, its contents
are appended to the system review instructions.

## Safety notes

The bash gate allows project inspection commands such as `git diff`, `git show`,
`git status`, `rg`, `fd`, and `sed -n`. Redirects, shell command substitution,
mutation-oriented Git commands, executable search hooks, and `sed -i` are blocked.
This remains a guardrail rather than an OS sandbox.

The local permission gate recognizes active review mode and leaves rejected
commands to this stricter review gate, avoiding redundant approval prompts.

## Try without installing

```bash
pi \
  -e ./extensions/review \
  -e ./extensions/permission-gate
```

## Install independently

```bash
pi install ./extensions/review
```

Remove it with:

```bash
pi remove ./extensions/review
```

Do not load this alongside another extension registering `/review`.
