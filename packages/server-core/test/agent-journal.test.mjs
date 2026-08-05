import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findProcessBoundCodexRollout } from "../dist/activity/agentJournal.js";

test("rollout discovery requires an open writer below the exact process tree", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-agent-journal-"));
  const sessions = join(root, "sessions", "2026", "08", "05");
  const path = join(sessions, "rollout-fixture.jsonl");
  await mkdir(sessions, { recursive: true });
  const child = spawn(process.execPath, ["-e", "const fs=require('fs');const fd=fs.openSync(process.argv[1],'a');fs.writeSync(fd,'{}\\n');setInterval(()=>{},1000)", path], { stdio: "ignore" });
  try {
    let found;
    for (let attempt = 0; attempt < 20 && !found; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      found = await findProcessBoundCodexRollout(process.pid, join(root, "sessions"));
    }
    assert.equal(found, await realpath(path));
    assert.equal(await findProcessBoundCodexRollout(999_999_999, join(root, "sessions")), undefined);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    await rm(root, { recursive: true, force: true });
  }
});
