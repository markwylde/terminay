import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findProcessBoundCodexRollout, NodeAgentJournalSource } from "../dist/activity/agentJournal.js";

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

test("a generic foreground wrapper restarts discovery for Codex resume after the startup scan expires", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-agent-resume-"));
  const sessions = join(root, "sessions", "2026", "08", "05");
  const path = join(sessions, "rollout-resumed.jsonl");
  await mkdir(sessions, { recursive: true });
  const record = JSON.stringify({ type: "session_meta", payload: { id: "resumed-session", cli_version: "0.146.1" } });
  const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
  const source = new NodeAgentJournalSource({ codexHome: root, discoveryAttemptLimit: 2, pollMs: 50 });
  const observations = [];
  let child;
  try {
    await source.start((observation) => observations.push(observation));
    source.registerTerminal(identity);
    source.terminalStarted(identity, process.pid);
    await new Promise((resolve) => setTimeout(resolve, 500));
    child = spawn(process.execPath, ["-e", "const fs=require('fs');const fd=fs.openSync(process.argv[1],'a');fs.writeSync(fd,process.argv[2]+'\\n');setInterval(()=>{},1000)", path, record], { stdio: "ignore" });
    let boundPath;
    for (let attempt = 0; attempt < 40 && !boundPath; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      boundPath = await findProcessBoundCodexRollout(process.pid, join(root, "sessions"));
    }
    assert.equal(boundPath, await realpath(path));
    assert.equal(observations.length, 0);
    source.foregroundProcessChanged(identity, null, false);
    for (let attempt = 0; attempt < 30 && observations.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(observations[0]?.record?.payload?.id, "resumed-session");
    assert.deepEqual(observations[0]?.identity, identity);
  } finally {
    await source.stop();
    child?.kill();
    if (child?.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
    await rm(root, { recursive: true, force: true });
  }
});
