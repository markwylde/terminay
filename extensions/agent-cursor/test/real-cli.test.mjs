import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

test("opt-in Cursor Agent CLI smoke", { skip: process.env.TERMINAY_CURSOR_AGENT_REAL !== "1" }, async () => {
  const marker = "terminay-cursor-extension-smoke-ok";
  const { stdout } = await execute("agent", ["--print", "--mode", "ask", "--trust", `Reply with exactly ${marker}`], {
    timeout: 120_000,
    maxBuffer: 128 * 1024,
  });
  assert.equal(stdout.trim(), marker);
});
