import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

if (process.env.TERMINAY_TEST_REAL_CLAUDE_CODE !== "1") {
  console.log("Skipped. Set TERMINAY_TEST_REAL_CLAUDE_CODE=1 to run the authenticated Claude Code smoke check.");
  process.exit(0);
}

const result = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 15_000 });
assert.equal(result.status, 0, result.stderr || "Claude Code CLI did not return --version successfully");
assert.match(`${result.stdout}${result.stderr}`, /\S/u);
console.log("Claude Code CLI is available. Run its normal new-session and --resume flow in Terminay for the opt-in live sidebar smoke.");
