# simply-session-recall

On-demand recall for prior Pi sessions, designed to compose with this setup's
[`simply-file-search`](../simply-file-search/README.md) tools rather than adding
another session-search implementation.

## How it works

Ask Pi a normal question about previous work. It should:

1. Use `simply_grep` against Pi's sessions directory with `hidden: true`,
   `fixed_strings: true`, and one distinctive term or exact phrase per call.
2. Optionally use `simply_find` to locate `.jsonl` session files by name or date.
3. Pass a matching session path to `session_query` with a focused question.

`session_query` loads only session JSONL files below the configured Pi agent
sessions directory and uses the active model to summarize the selected
conversation. It omits no message types itself, but bounds very large
transcripts by retaining their beginning and end and marking the omission.

There is no background index, vector database, or duplicate ripgrep fallback.
`simply-file-search` owns discovery and literal content search. Keep that
extension enabled for the intended workflow; Pi's built-in search tools remain
an acceptable fallback when it is unavailable.

## Example

```text
What did we decide about authentication?

# Pi uses:
simply_grep({
  pattern: "authentication",
  path: "/Users/me/.pi/agent/sessions",
  fixed_strings: true,
  ignore_case: true,
  hidden: true
})
session_query({
  sessionPath: "/Users/me/.pi/agent/sessions/.../2026-03-10T12-00-00.jsonl",
  question: "What authentication approach did we choose, and why?"
})
```

## Codemode batching

`session_query` declares read-only annotations and structured output:
`{ status, sessionPath, question, answer, messageCount, truncated, error? }`.
Status is `ok`, `empty`, `error`, or `cancelled`. Direct calls still show the
answer as text. Failure/cancellation results are marked as errors, and model
usage is returned on both successful and failed responses for Pi accounting.
Canonical path checks prevent symlink escapes from the sessions root.

Discover and select relevant sessions first; then batch at most three independent
questions with `Promise.allSettled`. Each query consumes secondary-model quota
and sends the selected transcript to the active model provider. Do not bulk-query
every discovery hit. Keep answer provenance (`sessionPath`) and inspect status
and truncation flags. See [batching examples](../../docs/codemode-batching.md).

## Requirements

- Pi with an active model (the current model answers `session_query`).
- `simply-file-search` enabled for `simply_find` / `simply_grep`.

## Try without installing

```bash
pi -e ./extensions/simply-file-search -e ./extensions/simply-session-recall
```

## Install independently

```bash
pi install ./extensions/simply-file-search
pi install ./extensions/simply-session-recall
```
