import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

if (process.env.TERMINAY_RUN_REAL_CODEX_CLI !== "1") {
  console.log("Skipped real Codex smoke. Set TERMINAY_RUN_REAL_CODEX_CLI=1 to opt in.");
  process.exit(0);
}

const version = spawnSync("codex", ["--version"], { encoding: "utf8", timeout: 20_000 });
assert.equal(version.status, 0, version.stderr || version.error?.message);
assert.match(`${version.stdout}${version.stderr}`, /codex/i);

// This verifies that the installed CLI can create a normal rollout. It is
// deliberately opt-in because it may consume an authenticated Codex account.
const run = spawnSync("codex", ["exec", "--skip-git-repo-check", "Reply with exactly terminay-codex-extension-smoke-ok"], {
  encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"],
});
assert.equal(run.status, 0, run.stderr || run.error?.message);
assert.match(run.stdout, /terminay-codex-extension-smoke-ok/u);
