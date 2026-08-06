# Skills Guide

Custom Pi agent skills for specialized tasks.

## Available Skills (bundled)

- **[`github`](../skills/github/SKILL.md)** — Interact with GitHub using `gh` CLI for issues, PRs, Actions, and API queries
- **[`native-web-search`](../skills/native-web-search/SKILL.md)** — Fast, source-linked internet research through OpenAI Codex or Anthropic native web search
- **[`summarize`](../skills/summarize/SKILL.md)** — Convert URLs and documents (PDF, DOCX, PPTX, etc.) to Markdown with optional summarization

## Recommended Skills (install globally)

- **[`find-skills`](almost-required-stuff/find-skills.md)** — Discover and install agent skills from the open ecosystem via `npx skills`
- **[`herdr`](almost-required-stuff/herdr-skill.md)** — Control herdr from inside it: manage workspaces, tabs, panes, spawn agents, read output. Installed via Herder integration.

## Managing Skill Conflicts

Pi loads skills from multiple locations in priority order. When the same skill exists in multiple places, conflicts can occur.

### Skill Load Priority

1. **Local project** — `./skills/` in current directory (highest priority)
2. **Installed packages** — `~/.pi/agent/git/github.com/*/skills/`
3. **Global skills** — `~/.pi/agent/skills/` (lowest priority)

### Conflict Resolution Strategies

#### 1. Using `.piignore` (Local Development)

Create a `.piignore` file in your project root to exclude skills during development:

```bash
# .piignore
# Ignore all skills in this directory
skills/

# Or ignore specific skills
skills/github/
skills/summarize/
```

**Use case:** You have this package installed globally but want to work on skills locally without conflicts.

#### 2. Removing Global Skills

If skills are provided by an installed package, remove conflicting global skills:

```bash
# List global skills
ls -la ~/.pi/agent/skills/

# Remove specific global skill
rm ~/.pi/agent/skills/github  # or unlink if it's a symlink

# Or remove all global skills
rm -rf ~/.pi/agent/skills/*
```

**Use case:** Skills from `find-skills` and `herdr` were installed globally but are now available in this package.

#### 3. Package-Level Ignore

If you install this package globally but want to ignore specific skills in certain projects, create a local `.piignore`:

```bash
# In your project directory
echo "# Ignore github skill from global package" > .piignore
echo "skills/github/" >> .piignore
```

This prevents the globally installed package's `github` skill from loading in that specific project.

#### 4. Checking Active Skills

Verify which skills are loaded:

```bash
# Start Pi and check available skills
pi

# In Pi, check the skill list from the system prompt
# Or look at startup messages
```

### Best Practices

1. **Development workflow:**
   - Use `.piignore` when developing skills locally
   - Test without `.piignore` before committing
   - Remove conflicting global skills if they're in your package

2. **Package installation:**
   - Clean up `~/.pi/agent/skills/` before installing skill packages
   - Let packages provide skills instead of global symlinks
   - Use `.piignore` for project-specific overrides

3. **Version control:**
   - Commit `.piignore` if you always want certain skills excluded
   - Or add `.piignore` to `.gitignore` for developer-specific configurations

### Troubleshooting

**Skill not loading:**
```bash
# Check if it's being ignored
cat .piignore

# Check skill directory exists
ls -la skills/

# Verify SKILL.md exists
cat skills/github/SKILL.md
```

**Duplicate skill warnings:**
```bash
# Find all instances
find ~/.pi/agent -name "SKILL.md" -path "*/github/*"

# Remove duplicates (keep package version)
rm -rf ~/.pi/agent/skills/github
```

**Clear skill cache:**
```bash
# Restart Pi to reload skills
# Or use /reload in Pi session
```

## Adding New Skills

1. Create a directory: `skills/my-skill/`
2. Add `SKILL.md` with description and instructions
3. Test with and without `.piignore`
4. Verify no conflicts with globally installed packages

## References

- [Pi Skills Documentation](https://pi.dev/docs/skills)
- [Package Management](https://pi.dev/docs/packages)
- [.piignore Patterns](https://pi.dev/docs/piignore)
