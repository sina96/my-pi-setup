# rpiv-web-tools — third-party referral

> This is **not my extension** and no upstream code is vendored here.

- Package: [`@juicesharp/rpiv-web-tools`](https://www.npmjs.com/package/@juicesharp/rpiv-web-tools)
- Repository: <https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-web-tools>
- Author/maintainer: juicesharp
- License: MIT

## What it provides

A Pi extension that gives the main agent two first-class tools:

- `web_search` — returns titled web results with URLs and snippets.
- `web_fetch` — retrieves an HTTP(S) page as text for direct source inspection.

Its provider layer supports Brave, Tavily, Serper, Exa, You.com, Jina,
Firecrawl, Perplexity, SearXNG, and Ollama. The configured provider is the
default, while an individual `web_search` call can select another configured
provider without changing global state.

The extension also provides `/web-tools` for selecting providers and managing
credentials. SearXNG and Ollama offer self-hosted options.

## Install it when

Use this extension when the **main agent** should conduct iterative research:

1. Search with one or more queries.
2. Compare candidate sources.
3. Fetch the most relevant pages.
4. Inspect primary text and cite the final answer.

Good examples include dependency selection, migration research, standards and
compatibility checks, or any task where source selection affects the result.
It is also a better home than a skill for dedicated Brave, Exa, or other search
API integrations because configuration, retries, result rendering, truncation,
and page fetching remain centralized in first-class tools.

## Do not install it just for

- A quick one-shot current-information summary. Use the local
  [`native-web-search`](../../skills/native-web-search/SKILL.md) skill, which
  delegates to a fast OpenAI Codex or Anthropic model with native search.
- Deep inspection of a URL you already know. Use the local
  [`summarize`](../../skills/summarize/SKILL.md) skill or direct retrieval.
- Sessions that do not need web access. Active tools add schemas and guidance to
  the model request, so keeping this as an on-demand referral avoids permanent
  prompt and capability overhead.

The native-search skill and this extension can coexist: they solve different
problems. Avoid asking both to perform the same research unless you explicitly
want independent source discovery or provider comparison.

## Try temporarily

Review the upstream source first, then load it for one Pi process:

```bash
pi -e npm:@juicesharp/rpiv-web-tools
```

Run `/web-tools`, choose a provider, and configure its API key. `web_fetch` does
not require a search-provider key.

For environment-based Brave configuration:

```bash
export BRAVE_SEARCH_API_KEY="..."
pi -e npm:@juicesharp/rpiv-web-tools
```

## Install

Global Pi package installation:

```bash
pi install npm:@juicesharp/rpiv-web-tools
```

Project-local installation:

```bash
pi install -l npm:@juicesharp/rpiv-web-tools
```

Restart Pi after installation. Remove it with:

```bash
pi remove npm:@juicesharp/rpiv-web-tools
```

## Configuration

Use:

```text
/web-tools
/web-tools --show
```

Upstream stores provider configuration under
`~/.config/rpiv-web-tools/config.json` (or `XDG_CONFIG_HOME`) with file mode
`0600`. Environment variables override stored keys. See the current upstream
[provider guide](https://github.com/juicesharp/rpiv-mono/blob/main/packages/rpiv-web-tools/docs/providers.md)
for provider-specific variables and setup.

## Security and operational notes

- Pi packages execute with the user's permissions; review upstream before
  installing.
- Search queries, fetched URLs, and page contents may be sent to the selected
  provider and consume paid quota.
- `web_fetch` rejects non-HTTP(S), private, loopback, and cloud-metadata targets
  to reduce SSRF risk.
- Long fetched pages are truncated before entering model context; upstream saves
  full text to a temporary file for explicit follow-up reads.
- The optional GitHub interceptor can invoke `gh` or `git` and create a cached
  shallow clone. It is disabled by default.
- Requirements currently state Node.js 22 or newer, which matches this setup.
- Provider behavior and supported APIs can change; consult the current
  [upstream README](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-web-tools)
  before installation.
