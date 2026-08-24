# minimal-statusline

A dependency-free native Pi footer. It replaces the former Starship-backed
statusline with Pi's own model, thinking, context, Git, and session-usage data.
It never invokes Starship or any other subprocess.

## Layouts

**Balanced** (default):

```text
my-pi-setup on  add-model-thinking-etc via  v22.20.0     openai-codex → GPT-5.6 Terra ◆ medium  0% ↑0/↓272k $0.000
```

**Minimal**:

```text
my-pi-setup  add-model-thinking-etc     GPT-5.6 Terra ◆ medium  0% $0.000
```

The footer reads model and thinking state directly from Pi. `/thinking` and
Shift+Tab update the displayed level immediately; it supports `off`,
`minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.

## Controls

```text
/statusline balanced
/statusline minimal
```

Run `/statusline` without an argument to choose interactively. The selection
is stored in `~/.pi/agent/minimal-statusline.json`.

## Data and performance

- Project name and Node runtime version are local process metadata. Balanced
  mode also recognizes Node projects using npm, pnpm, Yarn, or Bun lockfiles.
- It displays project-declared Go (`go.mod`), Java/Kotlin (`.java-version`,
  asdf, Maven, or Gradle), Rust (toolchain/Cargo), and Python/uv
  (`.python-version`, asdf, `pyproject.toml`, or `uv.lock`) versions when
  available. For Maven and Gradle projects without a declared JVM version, it
  runs `java -version` once at session start as a fallback.
- Pi provides the watched Git branch, active model, thinking level, and context
  usage through its public extension API.
- Costs and token totals cover assistant messages, nested model tool results,
  compactions, and branch summaries, matching Pi's native-footer accounting.
- The render path only formats in-memory data; it performs no filesystem,
  Git, or shell work.

At narrow terminal widths, the left project/Git side truncates before the
right-side model, thinking, context, and cost indicators.
