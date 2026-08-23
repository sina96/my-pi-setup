import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUsage, usageTokens } from "./src/index.ts";

test("normalizes supported usage field shapes", () => {
  const cases: Array<[Record<string, unknown>, { total: number; cacheRead: number; cacheWrite: number }]> = [
    [{ input: 2, output: 3, cacheRead: 5, cacheWrite: 7, totalTokens: 17 }, { total: 17, cacheRead: 5, cacheWrite: 7 }],
    [{ inputTokens: 2, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 7 }, { total: 17, cacheRead: 5, cacheWrite: 7 }],
    [{ input_tokens: 2, output_tokens: 3, cache_read: 5, cache_write: 7, total_tokens: 19 }, { total: 19, cacheRead: 5, cacheWrite: 7 }],
    [{ promptTokens: 2, completionTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 7, tokens: { total: 23 } }, { total: 23, cacheRead: 5, cacheWrite: 7 }],
    [{ prompt_tokens: 2, completion_tokens: 3, cache_read_tokens: 5, cache_write_tokens: 7, tokens: 29 }, { total: 29, cacheRead: 5, cacheWrite: 7 }],
  ];

  for (const [usage, expected] of cases) {
    assert.deepEqual(normalizeUsage(usage), expected);
  }
});

test("derives missing or invalid totals and accumulates assistant usage only", () => {
  assert.deepEqual(
    normalizeUsage({ input: 2, output: 3, cacheRead: 5, cacheWrite: 7, totalTokens: -1 }),
    { total: 17, cacheRead: 5, cacheWrite: 7 },
  );
  assert.deepEqual(
    usageTokens([
      { role: "user", usage: { totalTokens: 100 } },
      { role: "assistant", usage: { input_tokens: 2, output_tokens: 3, cache_read_tokens: 5 } },
      { role: "assistant", usage: { totalTokens: 11, cacheRead: -4, cacheWrite: 2 } },
    ]),
    { total: 21, cacheRead: 5, cacheWrite: 2 },
  );
});
