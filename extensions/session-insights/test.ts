import assert from "node:assert/strict";
import test from "node:test";
import { usageParts } from "./src/scan.ts";

test("uses only finite non-negative reported totals", () => {
  const components = { input: 2, output: 3, cacheRead: 5, cacheWrite: 7 };
  assert.equal(usageParts({ ...components, totalTokens: 19 }).tokens, 19);
  assert.equal(usageParts({ ...components, totalTokens: 0 }).tokens, 0);
  assert.equal(usageParts({ ...components, totalTokens: -1 }).tokens, 17);
  assert.equal(usageParts({ ...components, totalTokens: Number.NaN }).tokens, 17);
  assert.equal(usageParts({ ...components, totalTokens: Number.POSITIVE_INFINITY }).tokens, 17);
});
