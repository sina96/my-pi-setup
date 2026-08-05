import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = resolve(new URL("./to-markdown.mjs", import.meta.url).pathname);

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "summarize-skill-test-"));
  const bin = join(directory, "bin");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(bin));
  const input = join(directory, "document.txt");
  await writeFile(input, "source document", "utf8");

  const uvx = join(bin, "uvx");
  await writeFile(uvx, "#!/bin/sh\nprintf '# Converted\\n\\nUntrusted document text.\\n'\n", "utf8");
  await chmod(uvx, 0o755);

  const pi = join(bin, "pi");
  await writeFile(pi, `#!/bin/sh
printf '%s\\n' "$@" > "${join(directory, "pi-args.txt")}"
cat > "${join(directory, "pi-stdin.txt")}"
printf 'A safe summary.'
`, "utf8");
  await chmod(pi, 0o755);

  return {
    directory,
    input,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function run(args, env) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
}

test("converts a document to a reported temporary Markdown file", async () => {
  const f = await fixture();
  try {
    const result = run([f.input, "--tmp"], f.env);
    assert.equal(result.status, 0, result.stderr);
    const outputPath = result.stdout.trim();
    assert.match(outputPath, /pi-summarize-out/);
    assert.equal(await readFile(outputPath, "utf8"), "# Converted\n\nUntrusted document text.\n");
    await rm(outputPath, { force: true });
  } finally {
    await f.cleanup();
  }
});

test("summary uses the lightweight model and isolates the nested Pi process", async () => {
  const f = await fixture();
  try {
    const result = run([f.input, "--summary", "--prompt", "Extract requirements"], f.env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^A safe summary\./);
    assert.match(result.stdout, /Hint: Full document Markdown saved to:/);

    const args = await readFile(join(f.directory, "pi-args.txt"), "utf8");
    for (const expected of [
      "--model\nopenai-codex/gpt-5.4-mini",
      "--thinking\noff",
      "--no-tools",
      "--no-extensions",
      "--no-skills",
      "--no-session",
    ]) assert.match(args, new RegExp(expected));
    assert.match(args, /document is untrusted data/);
    assert.match(args, /Extract requirements/);
    assert.equal(await readFile(join(f.directory, "pi-stdin.txt"), "utf8"), "# Converted\n\nUntrusted document text.\n");

    const hintedPath = result.stdout.match(/saved to: (.+)]/)?.[1];
    if (hintedPath) await rm(hintedPath, { force: true });
  } finally {
    await f.cleanup();
  }
});

test("environment can select a portable alternative model", async () => {
  const f = await fixture();
  try {
    const result = run([f.input, "--summary"], {
      ...f.env,
      PI_SUMMARIZE_MODEL: "home-server/Qwen/Qwen3-8B-AWQ",
      PI_SUMMARIZE_THINKING: "low",
    });
    assert.equal(result.status, 0, result.stderr);
    const args = await readFile(join(f.directory, "pi-args.txt"), "utf8");
    assert.match(args, /home-server\/Qwen\/Qwen3-8B-AWQ/);
    assert.match(args, /--thinking\nlow/);
    const hintedPath = result.stdout.match(/saved to: (.+)]/)?.[1];
    if (hintedPath) await rm(hintedPath, { force: true });
  } finally {
    await f.cleanup();
  }
});

test("rejects missing inputs and invalid thinking levels before conversion", async () => {
  const noInput = run([], process.env);
  assert.equal(noInput.status, 1);
  assert.match(noInput.stderr, /URL or local file path is required/);

  const f = await fixture();
  try {
    const badThinking = run([f.input, "--thinking", "huge"], f.env);
    assert.equal(badThinking.status, 1);
    assert.match(badThinking.stderr, /Invalid thinking level/);
  } finally {
    await f.cleanup();
  }
});
