import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

if (process.env.TERMINAY_RUN_REAL_GROK_CLI !== "1") {
  console.log("Skipped real Grok smoke. Set TERMINAY_RUN_REAL_GROK_CLI=1 to opt in.");
  process.exit(0);
}

const version = spawnSync("grok", ["--version"], { encoding: "utf8", timeout: 20_000 });
assert.equal(version.status, 0, version.stderr || version.error?.message);
assert.match(`${version.stdout}${version.stderr}`, /grok/i);
