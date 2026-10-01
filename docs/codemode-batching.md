# Read-only batching with codemode

Pi's built-in codemode already provides JavaScript orchestration. This setup uses
it instead of adding a duplicate batch tool. Search and session-recall tools stay
available directly and now expose structured data to scripts.

## Enable deliberately

Merge these fields into personal or trusted-project settings, then `/reload`:

```json
{
  "defaultTools": ["+codemode"],
  "codemode": { "mode": "on" }
}
```

The statusline shows `codemode⚡` when the tool is active and `codemode:off` when
it is inactive. It measures the live active tool set, not whether a script is
currently running. This document does not change your settings automatically.

Start in normal mode; PLAN and review intentionally block codemode/MCP. The
examples below perform read-only work, but enabling codemode is **not** a
read-only sandbox: scripts can call any tool Pi makes callable. Permission hooks
still apply to every nested call. `ask_user`, `task_list`, `finish_goal`, and
`plan_complete` remain direct/model-only.

## Independent local searches

Ask Pi:

> Use codemode to search extensions for registerTool and tool_call independently.
> Return unique file paths and result-limit flags only. Do not modify files.

The script can look like this (raw source inside a codemode call):

```js
const queries = ["registerTool", "tool_call"];
const results = await Promise.allSettled(queries.map(pattern =>
  tools.simply_grep({ pattern, path: "extensions", glob: "*.ts", limit: 100 })
));
return results.map((result, i) => result.status === "fulfilled"
  ? {
      query: queries[i],
      files: [...new Set(result.value.matches
        .filter(match => match.kind === "match")
        .map(match => match.path))],
      truncated: result.value.truncated,
      limitReached: result.value.limitReached,
    }
  : { query: queries[i], error: String(result.reason) });
```

`simply_find` returns `files`; `simply_grep` returns `matches` with `kind`, `path`,
`line`, `column` (1-based byte offset for matches; 0 for context), and `text`.
Both return `engine`, `resultCount`, `truncated`, and `limitReached`.
`fullOutputPath` is present when the byte budget dropped records. That file holds
the output **within the requested result limit**, not every possible match.

Result caps are intentional. Narrow an incomplete search rather than claiming
complete coverage. JSON and direct text output are bounded separately.

## Discover first, then batch selected-session questions

First search the configured sessions directory with the usual literal, hidden,
case-insensitive discovery calls. Deduplicate the returned `match.path` values
and select relevant sessions. Do not batch every session found or send arbitrary
files to `session_query`.

```js
// Substitute up to three exact paths obtained from the discovery step.
const selected = ["/absolute/agent/sessions/project/session-a.jsonl"];
const results = await Promise.allSettled(selected.map(sessionPath =>
  tools.session_query({ sessionPath, question: "What did we decide, and why?" })
));
return results.map((result, i) => result.status === "fulfilled"
  ? {
      sessionPath: result.value.sessionPath,
      status: result.value.status,
      answer: result.value.answer,
      truncated: result.value.truncated,
    }
  : { sessionPath: selected[i], error: String(result.reason) });
```

Every query is a secondary model call with its own cost/quota. Its model usage is
included in the tool result and rolled up by Pi for nested calls. Errors and
cancellation have `status` values as well as `isError`; scripts must check status,
not mistake an error explanation for an answer. Session symlinks cannot escape
the configured root.

## Combine local evidence with native web search

Skills are instructions, not methods of `tools`: there is no
`tools.native_web_search()` simply because that skill is loaded. The existing
[skill helper](../skills/native-web-search/SKILL.md) can be called through
`tools.bash` with `--json`, alongside an independent local search.

Use the actual absolute helper path resolved from its SKILL.md. A script can use:

```js
const script = "/absolute/path/to/native-web-search/search.mjs";
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const command = ["node", quote(script), quote("Pi codemode tool output schemas"),
  "--purpose", quote("Compare upstream guidance with our implementation"),
  "--json"].join(" ");
const results = await Promise.allSettled([
  tools.simply_grep({ pattern: "outputSchema", path: "extensions", limit: 30 }),
  tools.bash({ command, timeout: 150 }),
]);
return results.map((result, i) => {
  if (result.status !== "fulfilled") return { source: i, error: String(result.reason) };
  if (i === 0) return { source: "local", matches: result.value.matches, truncated: result.value.truncated };
  const web = result.value;
  if (web.exit_code !== 0 || web.truncated) return { source: "web", error: web.output };
  const brief = JSON.parse(web.output);
  return { source: "web", provider: brief.provider, model: brief.model, findings: brief.result };
});
```

Keep **one native-web-search helper per batch**: it may refresh and rewrite shared
OAuth credentials, so concurrent helper processes risk racing that file. Batch
local reads around it; run multiple web queries sequentially. The helper sends
its query/purpose to an external provider and may consume quota. Do not include
private local content without approval. Preserve source URLs and verify important
claims; the brief is a research lead, not proof.

The helper's external model usage is not reported as Pi nested-model usage by
`bash`, so Pi's cost display will not include that external call. A future native
web-search tool could integrate authentication, cancellation, structured
citations, usage reporting, and concurrency control; that is a separate change,
not a reason to replace the working skill now.

## What was validated

- Live statusline state and fitting at widths 1–100.
- Search schema validation, byte/result limits, context/Unicode/colon paths.
- Actual fd/ripgrep execution and two search calls through Pi's QuickJS codemode
  sandbox (the nested tool dispatcher is a test harness, not a full live session).
- Independent recall queries with mocked model responses, usage/error statuses,
  and canonical-path checks.

No real provider requests, OAuth refreshes, or personal settings changes are
needed for these tests. Real search-binary tests skip explicitly when a binary is
not installed.
