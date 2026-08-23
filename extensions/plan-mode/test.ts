import assert from "node:assert/strict";
import test from "node:test";
import { isSafeBash } from "./src/index.ts";

test("allows read-only Git inspection and rejects write-capable output options", () => {
  assert.equal(isSafeBash("git status --short"), true);
  assert.equal(isSafeBash("git diff --stat"), true);
  assert.equal(isSafeBash("git show HEAD"), true);
  assert.equal(isSafeBash("git log --oneline | head"), true);

  assert.equal(isSafeBash("git diff --output plan.diff"), false);
  assert.equal(isSafeBash("git show --output=commit.txt HEAD"), false);
  assert.equal(isSafeBash("git log -o log.txt"), false);
  assert.equal(isSafeBash("git diff --ext-diff"), false);
  assert.equal(isSafeBash("git show --textconv HEAD:file"), false);
});
