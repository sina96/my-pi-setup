import assert from "node:assert/strict";
import test from "node:test";
import askUser from "./src/index.ts";

test("user-interaction tool stays model-only under codemode", () => {
  let registered: any;
  askUser({ registerTool(tool: any) { registered = tool; } } as never);
  assert.equal(registered.name, "ask_user");
  assert.equal(registered.exposure, "model-only");
});
