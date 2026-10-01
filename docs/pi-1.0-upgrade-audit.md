# Pi 1.0 upgrade audit

Audited on 2026-10-01 against the installed Pi 1.0.0 documentation, changelog, declarations, and a separate npm installation of its 1.0.0 packages.

## Summary

The setup does not need a rewrite. Its extensions load on Pi 1.0 and its existing tests pass. The main work is improving validation and adapting policies, state persistence, and accounting before adopting MCP/codemode.

**Recommendation:** compatibility and safety first; opt-in codemode second; add MCP servers only for concrete needs. Reuse Pi's built-ins rather than writing an MCP adapter or JavaScript orchestration extension.

Implementation has started in this checkout. Development dependencies, extension safeguards, lifecycle handling, and validation are updated; personal settings, credentials, and MCP configuration were not changed.

## Current state and verification

- Global CLI: `@earendil-works/pi-coding-agent@1.0.0`.
- Repository development dependencies are pinned to coding-agent/pi-ai/pi-tui 1.0.0, TypeScript 7.0.2, typebox 1.3.10, and Node 24 types. Pi host packages remain wildcard peer dependencies.
- Repository requires Node >=24 and CI uses Node 24; this shell currently runs Node 22.20.0. Pi itself supports Node >=22.19.
- The running setup comes from the managed Git checkout at `~/.pi/agent/git/github.com/sina96/my-pi-setup`, not this development checkout. Editing this repository does not automatically update the running package.
- Personal display configuration already selects fullscreen, quiet startup, and synthwave-84. No need to overwrite these settings for 1.0.
- No `~/.pi/agent/mcp.json` or project `.pi/mcp.json` exists. No explicit codemode default is configured.

Checks performed:

| Check | Result |
|---|---|
| Initial dependency tree: `npm test` | 160/160 pass |
| Initial isolated 1.0.0 dependency tree | 160/160 pass |
| Current `npm run check` | 178/178 tests pass; strict TypeScript 7 typecheck passes |
| Current Pi 1.0 resource loader | 21/21 extension entry points and 10/10 themes load without diagnostics |

The isolated copy initially lacked README.md, which three file-action tests require. After copying that fixture, all tests passed. This was not a Pi regression.

The smoke test does not establish interactive correctness: it loads factories/themes without exercising dialogs, fullscreen rendering, real MCP servers, or Herdr-only functionality. Existing tests mostly use mocked extension APIs, so they do not establish nested-call integration correctness.

Temporary evidence: `/tmp/my-pi-setup-baseline-tests.log`, `/tmp/my-pi-setup-v1-tests.log`, `/tmp/my-pi-setup-v1-types.log`, `/tmp/my-pi-setup-baseline-types.log`, `/tmp/my-pi-setup-v1-smoke.log`. The isolated environment path is recorded in `/tmp/my-pi-setup-audit-dir`.

## How to update this package

There are three separate updates:

1. **CLI:** already updated. `pi update` updates Pi; `pi update --all` updates Pi and installed packages.
2. **Development/test dependencies:** align the host packages locally and regenerate package-lock.json. Keep host packages as wildcard peer dependencies for distribution, as Pi's package documentation recommends, and add explicit development versions for reproducible tests. Do not move them into runtime `dependencies`.
3. **Installed Git package:** after validated changes are committed and pushed, run `pi update https://github.com/sina96/my-pi-setup.git` or `pi update --extensions`, then `/reload` or restart.

The dependencies, root tsconfig, and `typecheck` script are now in place. CI invokes `npm run check`, which runs tests, strict typechecking, and whitespace checks. The strict config uses NodeNext resolution, ES2024, noEmit, skipLibCheck, Node types, and allowImportingTsExtensions. Retain tsx initially; Pi switching its own build to native type stripping does not require this package to do the same.

The isolated npm audit also reported one high-severity transitive `brace-expansion` dependency under coding-agent. Review the upstream dependency/shrinkwrap and advisory before choosing a fix; do not run `npm audit fix --force` indiscriminately. This finding is separate from extension compatibility.

## Implementation status (2026-10-01)

Implemented in this checkout:

- Pinned Pi 1.0 development dependencies; strict `tsc --noEmit` is part of `npm run check`, which CI already runs.
- Fixed type issues in `pi-clip`, `simply-session-recall`, and overlay sizing in `session-insights`/`theme-picker`.
- Permission gate now asks for approval on unknown/non-read-only MCP calls and blocks them headlessly; explicit read-only annotations avoid prompts.
- `task_list`, `finish_goal`, `plan_complete`, and `ask_user` are model-only, preventing stateful/user-interaction workflow calls from becoming unpersisted nested codemode operations. PLAN/review continue to fail closed on codemode/MCP.
- Goal continuation now uses `agent_before_settle` and respects queued user work and final outcomes.
- Startup counts current global/trusted project MCP config and extension registrations. Statusline/session insights include new usage entries; insights include nested calls and tool-result usage.
- Herdr blocked-state reports Pi 1.0 generic UI prompt boundaries.
- Statusline includes a Nerd Font folder icon and live `codemode⚡`/`codemode:off` visibility.
- Search tools now expose bounded structured output; recall exposes structured statuses/answers, canonical-path checks, and model usage. A QuickJS codemode test batches two actual ripgrep calls.
- [Read-only batching guidance](codemode-batching.md) covers local search, selected-session recall, and one native-web-search helper call alongside local evidence. Codemode remains opt-in; no personal settings or credentials were changed.

## Follow-up audit findings

### 1. Typechecking and reproducible dependencies

Files: `package.json`, `package-lock.json`, `.github/workflows/ci.yml`, a new root `tsconfig.json`.

Fix these existing source issues:

- `extensions/pi-clip/src/index.ts:32`: narrow `entry.message.role` to assistant directly before reading `stopReason`; checking the separate `role` argument does not narrow the union.
- `extensions/simply-session-recall/src/index.ts:31-35`: message content can be a string. Handle strings before filtering array blocks. Its current response is an assistant array, but the generic helper contract is unsafe.
- `extensions/session-insights/src/index.ts:56,177` and `extensions/theme-picker/src/index.ts:78`: `maxWidth` is not a supported overlay option. Use supported responsive dimensions; check narrow terminals instead of simply retaining the ignored property.

### 2. Protect MCP calls before connecting servers

Files: `extensions/permission-gate/src/index.ts`, `policy.ts`, `test.ts`.

The initial audit found that unknown MCP tools passed without approval. The gate now identifies `mcp__` tools through the same `tool_call` hook used for direct and codemode-nested calls. Non-read-only or missing annotations require per-call approval, and headless calls fail closed. An explicit `readOnlyHint` is allowed to proceed; MCP annotations are unverified hints, not a security guarantee. No trusted-server exceptions are configured.

Test direct and nested MCP mutations, missing/misleading annotations, denial/cancellation, headless mode, multiple concurrent permission dialogs, and server/resource distinctions. Do not blanket-confirm every local extension tool as if it were an unknown remote tool.

PowerShell is another optional gap: the current shell gate and package-manager policy inspect bash only. Either keep PowerShell unavailable under these policies or add equivalent enforcement before advertising Windows shell support.

### 3. Preserve task-list state under nested execution

Files: `extensions/task-list/src/index.ts`, `test.ts`.

Task state snapshots remain attached to direct `task_list` results. These workflow tools are now `model-only`, including `ask_user`, so codemode cannot invoke them and lose their snapshots or bury approvals in scripts. This intentionally rules out scripted task-list/user-interaction workflows; supporting those later requires independently persisted branch-local state and integration tests.

### 4. Revisit PLAN/review tool policies

Files: `extensions/plan-mode/src/index.ts`, `extensions/review/src/index.ts`, their tests.

Both use fixed tool-name allowlists and safely reject codemode, tool_search, and new MCP tools. This is safe but prevents read-only MCP research and codemode batching. The default active-tool set is not a full security boundary: tools with codemode/deferred exposure can be callable without being active.

Keep fail-closed behavior until explicitly updated. If enabling orchestration in these modes, allow the orchestrator but enforce read-only rules on every nested child call. Retain the existing shell checks. For remote tools, require explicit trusted read-only policies rather than trusting server annotations alone. Test nested mutations and tool discovery under both modes.

## Lifecycle, accounting, and UX improvements

| Extension | Finding and recommended work |
|---|---|
| `goal` | Continuation now occurs at actionable `agent_before_settle`; tests cover final errors and queued user work. The budget still counts `agent_end` turns and usage counters include assistant messages only, not nested model/tool usage. |
| `plan-mode`, `review`, `goal`, `package-manager-policy`, `token-optimizer` | Append text by returning the entire `systemPrompt`. This still works, but Pi now supports structured `systemPromptOptions` section changes and transcript-backed deltas. Prefer dedicated stable sections where appropriate to preserve caching and compose policies. |
| `session-insights` | Scanner counts assistant usage and top-level tool results only; misses tool-result model usage, usage entries/cache warming, compaction/branch-summary usage, and nested tool activity. Use canonical context projection for context breakdowns: raw entries ignore context edits and can double-count system/tool state. Codemode's active tools are not the same as provider-visible declarations. Label estimates honestly. |
| `minimal-statusline` | Already includes tool-result and compaction/branch-summary usage, but misses new `usage` entries. Optional virtual routing should show selected and dispatched models distinctly. |
| `simply-session-recall` | Keep SessionManager-based reconstruction, which already benefits from canonical context. Return nested model `usage` so Pi includes its cost, and use thrown errors or `isError` for failure results currently returned as successful text. Check session-directory overrides separately if supporting them. |
| `pi-startup` | Counts MCP servers from `~/.pi/agent/configs/mcp.json`, not the new `~/.pi/agent/mcp.json`/trusted project configuration or extension registrations. Merge trusted file configuration with `pi.getMcpServers()` (which covers extension registrations only), respecting overrides; distinguish configured/enabled/connected counts and use connection metadata only where a supported API supplies it. Avoid counting builtin:* labels as personal extensions. |
| `herdr-blocked-state` | Watches only the custom `herdr:blocked` bus. New `ui_prompt_start`/`ui_prompt_end` events can cover generic dialogs, including built-in MCP UI prompts. Use reference counting for overlapping prompts and avoid duplicate reporting from legacy bus events; these event types do not expose prompt IDs. |
| `herdr-subagents`, `pi-herdr-btw` | Already use `agent_settled` for final delivery, which is appropriate. Test new provider/model arguments and nested-tool cost/output conventions in spawned CLI sessions. If moving to SDK sessions later, explicitly load MCP/codemode/tool-search factories; the SDK does not auto-load them. |
| `simply-file-search` | Add read-only/idempotent annotations and outputSchema/structuredContent for machine-readable files/matches. Codemode currently gets formatted text; `details` alone is not its structured API. Preserve fd/rg/fzf semantics, truncation, cancellation, and permission hooks. |
| `token-optimizer` | Nested bash hooks should already see codemode calls. Verify rewriting and ordering against the permission/package gates. Native codemode reduces returned data and declaration overhead, but does not replace coding/output controls or RTK shell rewriting. Session summaries based only on top-level bash records need nested-call awareness. |
| `theme-picker` | Built-in system theme and automatic light/dark pairs are new options. Preserve live preview/rollback and consider paired-theme selection. Add TUI mode guarding; custom overlays are not supported in RPC/headless modes. |
| `pi-clip` | Keep structured block/table copying; fullscreen auto-copy does not replace it. Test string message content and add focused tests (currently no dedicated test.ts). |
| `compact-diff`, `file-manager` | No source typecheck/load blocker found. Validate fullscreen resize/focus, narrow widths, mouse vs keyboard, and regular mode. Mouse support is an optional enhancement, not a prerequisite. |
| `whimsical` | Working indicators now live in the editor border. Verify clipping/reset and theme changes; no mandatory API replacement identified. |
| `ask-user` | Dialog APIs remain appropriate for TUI/RPC. Use model-only exposure and test timeout/cancel plus Herdr prompt reporting. No dedicated tests currently. |
| `themes` | All 10 parse under 1.0. No forced color conversion needed: hex colors remain supported. Optional explicit appearance and fullscreen scrollbar/search colors can improve consistency. |

## New concepts: what to adopt

### Codemode: yes, opt-in after safety fixes

Pi's built-in codemode runs model-written JavaScript in QuickJS. No direct Node/filesystem/network/timer APIs are available, but scripts can call real tools and run classifier/image models with session credentials. Earlier side effects are not rolled back if a script later fails.

Best uses here: batch independent searches/reads, aggregate session research, and filter large external responses before returning them to the model. Use outputSchema + structuredContent for custom data tools. Namespace related tools only where grouping improves discovery.

First trial configuration (personal or trusted project settings; not applied by this audit):

```json
{
  "defaultTools": ["+codemode"],
  "codemode": { "mode": "on" }
}
```

Start with `on`, not `only`: keep familiar direct tool calls, direct workflow controls, and readable approvals. Evaluate reduced tokens and latency on repeatable tasks before considering `only` or deferred exposure for more local tools.

Codemode is not a replacement for Herdr subagents: scripts orchestrate tools and non-chat models, not independent tool-enabled chat agents.

### MCP: use native support, add servers selectively

Pi now handles stdio and streamable HTTP, OAuth, trusted project configuration, resource tools, background connections, tool discovery, and per-tool exposure. There is no reason to add a separate MCP adapter to this repository.

Keep credentials and personal servers global. Do not commit credentials or silently connect company systems. Prefer the default codemode exposure for large servers, direct exposure for a few frequent tools, and hidden exposure for explicitly excluded tools. Disabling a tool's declaration is not necessarily disabling its callable capability.

Possible future targets are browser tooling or a service not already covered well by existing CLIs. Existing `gh`, TWG, native-web-search, and local search workflows do not need replacement just because MCP exists. Compare capability, auth, permission control, and overhead before deciding.

### Other release features

- **Virtual models:** promising optional router extension after observability/accounting is corrected. Keep follow-ups and retries sticky; avoid a fresh classifier call on every tool turn. Do not make this the default yet.
- **Classifier models:** useful for routing/triage experiments. Do not let probabilistic classifications replace deterministic security enforcement or explicit user approval.
- **Image generation:** available natively through codemode/model runtime; no custom tool needed without a specific workflow.
- **Cache warming:** add usage/decision visibility, not another warmer; Pi already implements it.
- **Append-only context edits:** useful for deliberate cleanup while keeping raw history. Use SessionManager APIs rather than mutating agent.state.messages. Existing context handlers need not all be replaced.
- **System theme and fullscreen:** preserve the user's selected theme/mode; validate custom popups. Optional support for appearance-aware styles and fullscreen colors.
- **OpenAI login:** Pi labels OpenAI Codex legacy; ChatGPT subscription login is now offered under OpenAI. Treat provider migration as an explicit user choice, not part of extension compatibility.

## Suggested implementation sequence

1. **Compatibility baseline:** Node 24, aligned development dependencies/lockfile, root typecheck + CI, fix existing typing/overlay issues, expand missing test coverage. Validate all 21 extensions/10 themes load.
2. **Safety and persistence:** MCP-aware permission rules, model-only workflow tools, nested-call tests, and an explicit PLAN/review orchestration policy. Fix startup MCP discovery. Do not enable MCP/codemode globally yet.
3. **Lifecycle and observability:** goal boundary migration, structured prompt sections, usage entries/nested costs, canonical context insights, generic Herdr prompt events. Verify reload/resume/fork/compaction behavior.
4. **Controlled adoption:** opt-in codemode in `on` mode, structured search output, benchmark representative tasks. Add one concrete MCP server only after selecting the need and reviewing its trust/auth policy.
5. **Optional UX/experiments:** paired themes, mouse interactions, virtual routing, classifiers, or image workflows only if they solve a real need.

Each phase should be independently reviewable and deployable. Integration validation should cover direct/nested tools, cancellation, parallel calls, headless/RPC/TUI, regular/fullscreen, session reload/resume/tree/fork, and goal interactions with queued work.

## Primary upstream references

- [Changelog](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md): 0.84.x through 1.0.0; especially 0.86/0.87 lifecycle/context changes and 0.99 MCP/codemode APIs.
- [Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
- [MCP](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md)
- [Codemode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/codemode.md)
- [SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) and `examples/sdk/14-codemode-mcp.ts`
- [Settings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md), [packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md), [CLI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md)
- [Sessions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md), [message types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/message-types.md)
- [TUI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md), [themes](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/themes.md), [virtual models](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/virtual-models.md)

The installed 1.0.0 copies of these documents were the authority for this audit; main-branch links can change after the audit date.
