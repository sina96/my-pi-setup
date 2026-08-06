---
name: native-web-search
description: Trigger fast, source-linked internet research through OpenAI Codex or Anthropic native web search. Use for quick current-information research, source discovery, comparisons, release research, and facts that may have changed.
license: Apache-2.0
compatibility: Requires Node.js, Pi credentials for OpenAI Codex or Anthropic, and network access.
---

# Native Web Search

Run a fast secondary model with its provider-native web-search capability and return a concise research summary with explicit full source URLs.

Vendored from [`mitsuhiko/agent-stuff`](https://github.com/mitsuhiko/agent-stuff/tree/d265b8ef32f896d3ef3bc6a45bd7b8e0d02150e0/skills/native-web-search) at commit `d265b8ef32f896d3ef3bc6a45bd7b8e0d02150e0`, under Apache-2.0. The helper remains intentionally limited to OpenAI Codex and Anthropic native search; use a dedicated web-tools extension when the main agent needs iterative provider-backed search and page fetching.

## When to use it

Use this skill for:

- a quick standalone research brief
- current releases, compatibility, pricing, policies, or availability
- discovering primary documentation and authoritative sources
- comparisons where a concise summary is more useful than raw results
- keeping exploratory web research out of the main model's context

Prefer direct source retrieval for a known small GitHub file. Use the `summarize` skill when a specific page or document needs deep inspection. When the main agent should search repeatedly, choose sources, and fetch pages itself, use the separately documented [`@juicesharp/rpiv-web-tools`](../../docs/third-party-extensions/rpiv-web-tools.md) extension.

## Run the script

Resolve `search.mjs` relative to this `SKILL.md`; do not assume the current working directory is the skill directory.

```bash
node search.mjs "<what to search>" --purpose "<why you need it>"
```

Examples:

```bash
node search.mjs "latest Python release" --purpose "update dependency notes"
node search.mjs "Vite 7 breaking changes" --purpose "prepare a migration checklist"
```

Optional flags:

- `--provider openai-codex|anthropic`
- `--model <model-id>`
- `--timeout <ms>`
- `--json`

## Output contract

The research model is instructed to provide:

1. Three to seven concise findings.
2. A full canonical `https://...` URL for every finding.
3. Why each finding matters for the stated purpose.
4. Disagreements between sources and a recommendation about which sources to trust first.

Treat the result as a research lead, not proof. Verify consequential claims against primary sources before relying on them.

## Privacy, credentials, and cost

- The query and purpose are sent to the selected model provider and its native search service.
- The script reads Pi credentials from the configured agent `auth.json`; OAuth refresh may update that file.
- Native search and the secondary model may consume provider quota.
- No extra npm installation is required.

If module resolution fails, set `PI_AI_MODULE_PATH` to `@earendil-works/pi-ai`'s `dist/index.js`. For OAuth helper resolution, set `PI_AI_OAUTH_MODULE_PATH` to its `dist/oauth.js`.
