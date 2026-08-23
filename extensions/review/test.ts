import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadReviewGuidelines } from "./src/index.ts";

function context(trusted: boolean, confirmed: boolean) {
  let confirmations = 0;
  const notifications: unknown[][] = [];
  return {
    ctx: {
      hasUI: true,
      isProjectTrusted: () => trusted,
      ui: {
        notify: (...args: unknown[]) => notifications.push(args),
        confirm: async () => {
          confirmations += 1;
          return confirmed;
        },
      },
    },
    notifications,
    confirmations: () => confirmations,
  };
}

test("loads review guidelines only from a trusted confirmed regular file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-guidelines-"));
  try {
    const path = join(directory, "REVIEW_GUIDELINES.md");
    await writeFile(path, "Review auth boundaries.\n");

    const accepted = context(true, true);
    assert.equal(await loadReviewGuidelines(path, accepted.ctx as never), "Review auth boundaries.");
    assert.equal(accepted.confirmations(), 1);

    const untrusted = context(false, true);
    assert.equal(await loadReviewGuidelines(path, untrusted.ctx as never), "");
    assert.equal(untrusted.confirmations(), 0);

    const declined = context(true, false);
    assert.equal(await loadReviewGuidelines(path, declined.ctx as never), "");
    assert.equal(declined.confirmations(), 1);

    const symlinkPath = join(directory, "guidelines-link.md");
    await symlink(path, symlinkPath);
    const linked = context(true, true);
    assert.equal(await loadReviewGuidelines(symlinkPath, linked.ctx as never), "");
    assert.equal(linked.confirmations(), 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
