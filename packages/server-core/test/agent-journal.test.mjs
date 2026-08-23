import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rename, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findProcessBoundClaudeSession, findProcessBoundCodexRollout, findProcessBoundOmpSession, NodeAgentJournalSource } from "../dist/activity/agentJournal.js";

function ompTitleSlot(title = "Untitled") {
  const text = JSON.stringify({ type: "title", title });
  return `${text}${" ".repeat(Math.max(0, 255 - Buffer.byteLength(text)))}\n`;
}

function ompJournal(id) {
  return `${ompTitleSlot()}${JSON.stringify({ type: "session", id, version: "0.1.0" })}\n`;
}

async function waitFor(predicate, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

/**
 * Attach the exit listener before signalling a fixture process. Calling
 * `kill()` first can race the `exit` event and leave a test promise pending
 * after Node's event loop has otherwise drained.
 */
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const complete = () => resolve();
    child.once("exit", complete);
    if (child.exitCode !== null || child.signalCode !== null) {
      child.off("exit", complete);
      resolve();
      return;
    }
    if (!child.kill()) {
      child.off("exit", complete);
      resolve();
    }
  });
}

function breadcrumb(cwd, sessionFile, fresh = false) {
  return `${cwd}\n${sessionFile}\n${fresh ? "fresh\n" : ""}`;
}

test("omp binds each terminal to its own valid breadcrumb without an open writer", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-omp-breadcrumb-"));
  const sessions = join(root, "agent", "sessions", "-same-cwd");
  const breadcrumbs = join(root, "agent", "terminal-sessions");
  const firstPath = join(sessions, "2026-08-23_first.jsonl");
  const secondPath = join(sessions, "2026-08-23_second.jsonl");
  const firstIdentity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
  const secondIdentity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-2" });
  const observations = [];
  await mkdir(sessions, { recursive: true }); await mkdir(breadcrumbs, { recursive: true });
  await Promise.all([
    writeFile(firstPath, ompJournal("first-root")), writeFile(secondPath, ompJournal("second-root")),
    writeFile(join(breadcrumbs, "ttys001"), breadcrumb("/same/cwd", firstPath)),
    writeFile(join(breadcrumbs, "ttys002"), breadcrumb("/same/cwd", secondPath)),
  ]);
  const source = new NodeAgentJournalSource({
    ompHome: root, platform: "darwin", pollMs: 25,
    resolveOmpTerminalId: async (pid) => pid === 101 ? "ttys001" : pid === 102 ? "ttys002" : undefined,
  });
  try {
    await source.start((observation) => observations.push(observation));
    source.registerTerminal(firstIdentity); source.registerTerminal(secondIdentity);
    source.terminalStarted(firstIdentity, 101); source.terminalStarted(secondIdentity, 102);
    source.foregroundProcessChanged(firstIdentity, "omp", false); source.foregroundProcessChanged(secondIdentity, "omp", false);
    assert.equal(await waitFor(() => observations.some((item) => item.identity.sessionId === "terminal-1" && item.record.id === "first-root")
      && observations.some((item) => item.identity.sessionId === "terminal-2" && item.record.id === "second-root")), true);
    assert.equal(observations.some((item) => item.identity.sessionId === "terminal-1" && item.record.id === "second-root"), false);
  } finally {
    await source.stop(); await rm(root, { recursive: true, force: true });
  }
});

test("a recognised Bun OMP wrapper uses its exact terminal breadcrumb", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-omp-bun-breadcrumb-"));
  const sessions = join(root, "agent", "sessions", "-workspace");
  const breadcrumbs = join(root, "agent", "terminal-sessions");
  const path = join(sessions, "2026-08-23_bun.jsonl");
  const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
  const observations = [];
  await mkdir(sessions, { recursive: true }); await mkdir(breadcrumbs, { recursive: true });
  await Promise.all([writeFile(path, ompJournal("bun-root")), writeFile(join(breadcrumbs, "ttys005"), breadcrumb("/workspace", path))]);
  const source = new NodeAgentJournalSource({
    ompHome: root, platform: "darwin", pollMs: 25, resolveOmpTerminalId: async () => "ttys005", hasOmpProcess: async () => true,
  });
  try {
    await source.start((observation) => observations.push(observation));
    source.registerTerminal(identity); source.terminalStarted(identity, 105);
    // The process observer supplies only "bun" and so no named provider.
    source.foregroundProcessChanged(identity, null, false);
    assert.equal(await waitFor(() => observations.some((item) => item.record.id === "bun-root")), true);
  } finally {
    await source.stop(); await rm(root, { recursive: true, force: true });
  }
});

test("omp rebinds a terminal when its breadcrumb changes and tails atomic replacement", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-omp-rebind-"));
  const sessions = join(root, "agent", "sessions", "-workspace");
  const breadcrumbs = join(root, "agent", "terminal-sessions");
  const firstPath = join(sessions, "2026-08-23_first.jsonl");
  const secondPath = join(sessions, "2026-08-23_second.jsonl");
  const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
  const observations = [];
  await mkdir(sessions, { recursive: true }); await mkdir(breadcrumbs, { recursive: true });
  await writeFile(firstPath, ompJournal("first-root"));
  await writeFile(secondPath, ompJournal("second-root"));
  await writeFile(join(breadcrumbs, "ttys003"), breadcrumb("/workspace", firstPath));
  const source = new NodeAgentJournalSource({ ompHome: root, platform: "darwin", pollMs: 25, resolveOmpTerminalId: async () => "ttys003" });
  try {
    await source.start((observation) => observations.push(observation));
    source.registerTerminal(identity); source.terminalStarted(identity, 103); source.foregroundProcessChanged(identity, "omp", false);
    assert.equal(await waitFor(() => observations.some((item) => item.record.id === "first-root")), true);
    await writeFile(join(breadcrumbs, "ttys003"), breadcrumb("/workspace", secondPath));
    assert.equal(await waitFor(() => observations.some((item) => item.record.id === "second-root")), true);
    const replacement = `${ompJournal("second-root")}${JSON.stringify({ type: "message", id: "replacement" })}\n`;
    await writeFile(`${secondPath}.next`, replacement); await rename(`${secondPath}.next`, secondPath);
    assert.equal(await waitFor(() => observations.some((item) => item.record.id === "replacement")), true);
  } finally {
    await source.stop(); await rm(root, { recursive: true, force: true });
  }
});

test("omp ignores malformed, outside-root, and fresh pre-file breadcrumbs", async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-omp-breadcrumb-invalid-"));
  const breadcrumbs = join(root, "agent", "terminal-sessions");
  const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
  const observations = [];
  await mkdir(breadcrumbs, { recursive: true });
  await writeFile(join(breadcrumbs, "ttys004"), "not-a-breadcrumb");
  const source = new NodeAgentJournalSource({ ompHome: root, platform: "darwin", pollMs: 25, discoveryAttemptLimit: 2, resolveOmpTerminalId: async () => "ttys004" });
  try {
    await source.start((observation) => observations.push(observation));
    source.registerTerminal(identity); source.terminalStarted(identity, 104); source.foregroundProcessChanged(identity, "omp", false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(join(breadcrumbs, "ttys004"), breadcrumb("/workspace", "/outside/session.jsonl"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(join(breadcrumbs, "ttys004"), breadcrumb("/workspace", join(root, "agent", "sessions", "-workspace", "missing.jsonl"), true));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(observations, []);
  } finally {
    await source.stop(); await rm(root, { recursive: true, force: true });
  }
});

test("omp discovery requires the exact PTY tree writer and skips its title slot", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-omp-journal-"));
  const sessions = join(root, "agent", "sessions", "-workspace");
  const path = join(sessions, "2026-08-23_fixture.jsonl");
  await mkdir(sessions, { recursive: true });
  const child = spawn(process.execPath, ["-e", "const fs=require('fs');const fd=fs.openSync(process.argv[1],'a');fs.writeSync(fd,process.argv[2]);setInterval(()=>{},1000)", path, ompJournal("omp-root")], { stdio: "ignore" });
  try {
    let found;
    for (let attempt = 0; attempt < 40 && !found; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      found = await findProcessBoundOmpSession(process.pid, join(root, "agent", "sessions"));
    }
    assert.equal(found, await realpath(path));
    assert.equal(await findProcessBoundOmpSession(999_999_999, join(root, "agent", "sessions")), undefined);
  } finally {
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("omp root discovery rejects child journals and title-slot-only files", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-omp-root-"));
  const sessions = join(root, "agent", "sessions", "-workspace");
  const path = join(sessions, "2026-08-23_root.jsonl");
  const childPath = join(sessions, "2026-08-23_root", "child-a.jsonl");
  const titleOnly = join(sessions, "2026-08-23_title-only.jsonl");
  await mkdir(join(sessions, "2026-08-23_root"), { recursive: true });
  const child = spawn(process.execPath, [
    "-e", "const fs=require('fs');const [root,content,kid,kidContent,title,titleContent]=process.argv.slice(1);for(const [file,text] of [[root,content],[kid,kidContent],[title,titleContent]]){const fd=fs.openSync(file,'a');fs.writeSync(fd,text)}setInterval(()=>{},1000)",
    path, ompJournal("omp-root"), childPath, ompJournal("child-session"), titleOnly, ompTitleSlot(),
  ], { stdio: "ignore" });
  try {
    let found;
    for (let attempt = 0; attempt < 40 && !found; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      found = await findProcessBoundOmpSession(process.pid, join(root, "agent", "sessions"));
    }
    assert.equal(found, await realpath(path));
  } finally {
    await stopChild(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("two omp PTY trees in the same cwd never share a root journal", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-omp-isolation-"));
  const sessions = join(root, "agent", "sessions", "-same-cwd");
  const firstPath = join(sessions, "2026-08-23_first.jsonl");
  const secondPath = join(sessions, "2026-08-23_second.jsonl");
  await mkdir(sessions, { recursive: true });
  const wrapper = (path, journal) => spawn(process.execPath, [
    "-e", "const {spawn}=require('child_process');const child=spawn(process.execPath,['-e',\"const fs=require('fs');const fd=fs.openSync(process.argv[1],'a');fs.writeSync(fd,process.argv[2]);setInterval(()=>{},1000)\",process.argv[1],process.argv[2]],{stdio:'ignore'});const stop=()=>{child.once('exit',()=>process.exit(0));child.kill()};process.once('SIGTERM',stop);process.once('SIGINT',stop);setInterval(()=>{},1000)", path, journal,
  ], { stdio: "ignore" });
  const first = wrapper(firstPath, ompJournal("first")); const second = wrapper(secondPath, ompJournal("second"));
  try {
    let firstFound; let secondFound;
    for (let attempt = 0; attempt < 80 && (!firstFound || !secondFound); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      firstFound = await findProcessBoundOmpSession(first.pid, join(root, "agent", "sessions"));
      secondFound = await findProcessBoundOmpSession(second.pid, join(root, "agent", "sessions"));
    }
    assert.equal(firstFound, await realpath(firstPath));
    assert.equal(secondFound, await realpath(secondPath));
  } finally {
    await Promise.all([stopChild(first), stopChild(second)]);
    await rm(root, { recursive: true, force: true });
  }
});

test("pre-file omp stays on terminal fallback and does not bind another journal", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-omp-pre-file-"));
  const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
  const source = new NodeAgentJournalSource({ ompHome: root, codexHome: join(root, "missing-codex"), claudeHome: join(root, "missing-claude"), discoveryAttemptLimit: 2, pollMs: 50 });
  const observations = [];
  try {
    await source.start((observation) => observations.push(observation));
    source.registerTerminal(identity); source.terminalStarted(identity, process.pid);
    source.foregroundProcessChanged(identity, "omp", false);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.deepEqual(observations, []);
  } finally {
    await source.stop(); await rm(root, { recursive: true, force: true });
  }
});

test("persistent omp discovery binds a lazy writer after the bounded startup scan", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-omp-lazy-"));
  const sessions = join(root, "agent", "sessions", "-workspace");
  const path = join(sessions, "2026-08-23_lazy.jsonl");
  const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
  await mkdir(sessions, { recursive: true });
  const source = new NodeAgentJournalSource({ ompHome: root, codexHome: join(root, "missing-codex"), claudeHome: join(root, "missing-claude"), discoveryAttemptLimit: 2, pollMs: 50 });
  const observations = [];
  let child;
  try {
    await source.start((observation) => observations.push(observation));
    source.registerTerminal(identity); source.terminalStarted(identity, process.pid); source.foregroundProcessChanged(identity, "omp", false);
    await new Promise((resolve) => setTimeout(resolve, 250));
    child = spawn(process.execPath, ["-e", "const fs=require('fs');const fd=fs.openSync(process.argv[1],'a');fs.writeSync(fd,process.argv[2]);setInterval(()=>{},1000)", path, ompJournal("omp-lazy")], { stdio: "ignore" });
    for (let attempt = 0; attempt < 80 && !observations.some((item) => item.record.id === "omp-lazy"); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(observations.some((item) => item.record.id === "omp-lazy" && item.journalRole === "root"), true);
  } finally {
    await source.stop(); await stopChild(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("omp child journals tail beneath their process-bound root only", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-omp-child-"));
  const sessions = join(root, "agent", "sessions", "-workspace");
  const path = join(sessions, "2026-08-23_root.jsonl");
  const childPath = join(sessions, "2026-08-23_root", "child-a.jsonl");
  const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
  await mkdir(join(sessions, "2026-08-23_root"), { recursive: true });
  const source = new NodeAgentJournalSource({ ompHome: root, codexHome: join(root, "missing-codex"), claudeHome: join(root, "missing-claude"), pollMs: 50 });
  const observations = [];
  const child = spawn(process.execPath, [
    "-e", "const fs=require('fs');for(let i=1;i<process.argv.length;i+=2){const fd=fs.openSync(process.argv[i],'a');fs.writeSync(fd,process.argv[i+1])}setInterval(()=>{},1000)",
    path, ompJournal("omp-root"), childPath, ompJournal("child-session"),
  ], { stdio: "ignore" });
  try {
    await source.start((observation) => observations.push(observation));
    source.registerTerminal(identity); source.terminalStarted(identity, process.pid); source.foregroundProcessChanged(identity, "omp", false);
    for (let attempt = 0; attempt < 80 && !observations.some((item) => item.journalRole === "child" && item.record.id === "child-session"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(observations.some((item) => item.record.id === "omp-root" && item.journalRole === "root"), true);
    assert.equal(observations.some((item) => item.record.id === "child-session" && item.journalRole === "child" && item.childAgentId === "child-a"), true);
  } finally {
    await source.stop(); await stopChild(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("rollout discovery requires an open writer below the exact process tree", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-agent-journal-"));
  const sessions = join(root, "sessions", "2026", "08", "05");
  const path = join(sessions, "rollout-fixture.jsonl");
  await mkdir(sessions, { recursive: true });
  const record = JSON.stringify({ type: "session_meta", payload: { id: "fixture-session", originator: "codex-tui", source: "cli" } });
  const child = spawn(process.execPath, ["-e", "const fs=require('fs');const fd=fs.openSync(process.argv[1],'a');fs.writeSync(fd,process.argv[2]+'\\n');setInterval(()=>{},1000)", path, record], { stdio: "ignore" });
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

test("rollout discovery keeps the root session when the same Codex process opens a newer subagent journal", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-agent-multi-rollout-"));
  const sessions = join(root, "sessions", "2026", "08", "06");
  const rootPath = join(sessions, "rollout-root.jsonl");
  const subagentPath = join(sessions, "rollout-subagent.jsonl");
  await mkdir(sessions, { recursive: true });
  const rootRecord = JSON.stringify({
    type: "session_meta",
    payload: { id: "root-session", originator: "codex-tui", source: "cli", cli_version: "0.146.1" },
  });
  const subagentRecord = JSON.stringify({
    type: "session_meta",
    payload: {
      id: "subagent-session",
      originator: "codex-tui",
      source: { subagent: { thread_spawn: { parent_thread_id: "root-session", depth: 1, agent_path: "/root/research" } } },
      cli_version: "0.146.1",
    },
  });
  const child = spawn(process.execPath, [
    "-e",
    "const fs=require('fs');const [rootPath,rootRecord,subagentPath,subagentRecord]=process.argv.slice(1);const rootFd=fs.openSync(rootPath,'a');fs.writeSync(rootFd,rootRecord+'\\n');setTimeout(()=>{const subagentFd=fs.openSync(subagentPath,'a');fs.writeSync(subagentFd,subagentRecord+'\\n');setInterval(()=>{},1000)},100)",
    rootPath,
    rootRecord,
    subagentPath,
    subagentRecord,
  ], { stdio: "ignore" });
  try {
    let subagentReady;
    for (let attempt = 0; attempt < 40 && !subagentReady; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      subagentReady = await realpath(subagentPath).catch(() => undefined);
    }
    assert.ok(subagentReady);
    assert.equal(await findProcessBoundCodexRollout(process.pid, join(root, "sessions")), await realpath(rootPath));
  } finally {
    child.kill();
    if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("rollout discovery selects the newest eligible root and rejects newer malformed metadata", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-agent-root-selection-"));
  const sessions = join(root, "sessions", "2026", "08", "06");
  const firstPath = join(sessions, "rollout-first-root.jsonl");
  const resumedPath = join(sessions, "rollout-resumed-root.jsonl");
  const malformedPath = join(sessions, "rollout-malformed.jsonl");
  await mkdir(sessions, { recursive: true });
  const firstRecord = JSON.stringify({ type: "session_meta", payload: { id: "first-root", originator: "codex-tui", source: "cli" } });
  const resumedRecord = JSON.stringify({ type: "session_meta", payload: { id: "resumed-root", originator: "codex-tui", source: "cli" } });
  const child = spawn(process.execPath, [
    "-e",
    "const fs=require('fs');const [firstPath,firstRecord,resumedPath,resumedRecord,malformedPath]=process.argv.slice(1);const fds=[];fds.push(fs.openSync(firstPath,'a'));fs.writeSync(fds[0],firstRecord+'\\n');setTimeout(()=>{fds.push(fs.openSync(resumedPath,'a'));fs.writeSync(fds[1],resumedRecord+'\\n')},100);setTimeout(()=>{fds.push(fs.openSync(malformedPath,'a'));fs.writeSync(fds[2],'{not-json}\\n');setInterval(()=>{},1000)},200)",
    firstPath,
    firstRecord,
    resumedPath,
    resumedRecord,
    malformedPath,
  ], { stdio: "ignore" });
  try {
    let malformedReady;
    for (let attempt = 0; attempt < 40 && !malformedReady; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      malformedReady = await realpath(malformedPath).catch(() => undefined);
    }
    assert.ok(malformedReady);
    assert.equal(await findProcessBoundCodexRollout(process.pid, join(root, "sessions")), await realpath(resumedPath));
  } finally {
    child.kill();
    if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("a generic foreground wrapper restarts discovery for Codex resume after the startup scan expires", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-agent-resume-"));
  const sessions = join(root, "sessions", "2026", "08", "05");
  const path = join(sessions, "rollout-resumed.jsonl");
  await mkdir(sessions, { recursive: true });
  const record = JSON.stringify({ type: "session_meta", payload: { id: "resumed-session", originator: "codex-tui", source: "cli", cli_version: "0.146.1" } });
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

test("persistent Codex discovery switches to a newly opened root rollout", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-agent-switch-"));
  const sessions = join(root, "sessions", "2026", "08", "22");
  const firstPath = join(sessions, "rollout-first.jsonl");
  const secondPath = join(sessions, "rollout-second.jsonl");
  await mkdir(sessions, { recursive: true });
  const meta = (id) => JSON.stringify({ type: "session_meta", payload: { id, originator: "codex-tui", source: "cli" } });
  const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
  const source = new NodeAgentJournalSource({ codexHome: root, pollMs: 50 });
  const observations = [];
  const child = spawn(process.execPath, ["-e", "const fs=require('fs');const [a,am,b,bm]=process.argv.slice(1);const fds=[];fds.push(fs.openSync(a,'a'));fs.writeSync(fds[0],am+'\\n');setTimeout(()=>{fds.push(fs.openSync(b,'a'));fs.writeSync(fds[1],bm+'\\n')},250);setInterval(()=>{},1000)", firstPath, meta("first-root"), secondPath, meta("second-root")], { stdio: "ignore" });
  try {
    await source.start((observation) => observations.push(observation));
    source.registerTerminal(identity);
    source.terminalStarted(identity, process.pid);
    source.foregroundProcessChanged(identity, "codex", false);
    for (let attempt = 0; attempt < 80 && !observations.some(({ record }) => record.payload?.id === "second-root"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.deepEqual(observations.filter(({ record }) => record.type === "session_meta").map(({ record }) => record.payload.id), ["first-root", "second-root"]);
  } finally {
    await source.stop(); child.kill();
    if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude discovery binds only a root project session held by the exact process tree", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-claude-journal-"));
  const project = join(root, "projects", "-workspace");
  const sessionId = "5f2aff08-eab3-4852-96eb-48235fc7f471";
  const path = join(project, `${sessionId}.jsonl`);
  await mkdir(project, { recursive: true });
  const record = JSON.stringify({ type: "permission-mode", mode: "default", sessionId, version: "2.1.201" });
  const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
  const source = new NodeAgentJournalSource({ claudeHome: root, codexHome: join(root, "missing-codex"), pollMs: 50 });
  const observations = [];
  const child = spawn(process.execPath, ["-e", "const fs=require('fs');const fd=fs.openSync(process.argv[1],'a');fs.writeSync(fd,process.argv[2]+'\\n');setInterval(()=>{},1000)", path, record], { stdio: "ignore" });
  try {
    await source.start((observation) => observations.push(observation));
    source.registerTerminal(identity); source.terminalStarted(identity, process.pid);
    source.foregroundProcessChanged(identity, "claude-code", false);
    for (let attempt = 0; attempt < 40 && observations.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(observations[0]?.provider, "claude-code");
    assert.equal(observations[0]?.record?.sessionId, sessionId);
  } finally {
    await source.stop(); child.kill();
    if (child.exitCode === null) await new Promise((resolve) => child.once("exit", resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("Claude resume binds its UUID journal without requiring an open file descriptor", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-claude-resume-"));
  const workspacePath = join(root, "workspace.github.io"); const sessionId = "5f2aff08-eab3-4852-96eb-48235fc7f471";
  await mkdir(workspacePath, { recursive: true }); const workspace = await realpath(workspacePath);
  const project = join(root, "projects", workspace.replace(/[/.]/gu, "-"));
  const path = join(project, `${sessionId}.jsonl`); const executable = join(root, "claude");
  await mkdir(project, { recursive: true });
  await writeFile(path, `${JSON.stringify({ type: "permission-mode", mode: "default", sessionId })}\n`);
  await writeFile(executable, "#!/bin/sh\nwhile true; do sleep 1; done\n"); await chmod(executable, 0o755);
  const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
  const source = new NodeAgentJournalSource({ claudeHome: root, codexHome: join(root, "missing-codex"), pollMs: 50 });
  const observations = []; const child = spawn(executable, ["--resume", sessionId], { cwd: workspace, stdio: "ignore" });
  try {
    let found;
    for (let attempt = 0; attempt < 40 && !found; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      found = await findProcessBoundClaudeSession(process.pid, join(root, "projects"));
    }
    assert.equal(found, await realpath(path));
    await source.start((observation) => observations.push(observation)); source.registerTerminal(identity);
    source.terminalStarted(identity, process.pid); source.foregroundProcessChanged(identity, "claude-code", false);
    for (let attempt = 0; attempt < 60 && observations.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(observations[0]?.provider, "claude-code"); assert.equal(observations[0]?.record?.sessionId, sessionId);
  } finally {
    await source.stop(); await stopChild(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("persistent Claude discovery follows an in-process resume to the newly active journal", { skip: !["darwin", "linux"].includes(process.platform) }, async () => {
  const root = await mkdtemp(join(tmpdir(), "terminay-claude-switch-"));
  const workspacePath = join(root, "workspace.github.io"); const firstId = "5f2aff08-eab3-4852-96eb-48235fc7f471"; const secondId = "bf0b34e1-4afc-4b93-8389-80caa0b589a4";
  await mkdir(workspacePath, { recursive: true }); const workspace = await realpath(workspacePath);
  const project = join(root, "projects", workspace.replace(/[/.]/gu, "-")); const executable = join(root, "claude");
  const firstPath = join(project, `${firstId}.jsonl`); const secondPath = join(project, `${secondId}.jsonl`);
  const record = (sessionId) => JSON.stringify({ type: "permission-mode", mode: "default", sessionId, version: "2.1.201" });
  await mkdir(project, { recursive: true }); await writeFile(firstPath, `${record(firstId)}\n`); await writeFile(secondPath, `${record(secondId)}\n`);
  await utimes(firstPath, 1, 1); await utimes(secondPath, 1, 1);
  await writeFile(executable, "#!/bin/sh\nsleep 0.3\nprintf '%s\\n' \"$4\" >> \"$3\"\nwhile true; do sleep 1; done\n"); await chmod(executable, 0o755);
  const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
  const source = new NodeAgentJournalSource({ claudeHome: root, codexHome: join(root, "missing-codex"), pollMs: 50 });
  const observations = []; const child = spawn(executable, ["--resume", firstId, secondPath, record(secondId)], { cwd: workspace, stdio: "ignore" });
  try {
    await source.start((observation) => observations.push(observation)); source.registerTerminal(identity);
    source.terminalStarted(identity, process.pid); source.foregroundProcessChanged(identity, "claude-code", false);
    for (let attempt = 0; attempt < 80 && !observations.some(({ record: value }) => value.sessionId === secondId); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual([...new Set(observations.filter(({ record: value }) => value.type === "permission-mode").map(({ record: value }) => value.sessionId))], [firstId, secondId]);
  } finally {
    await source.stop(); await stopChild(child);
    await rm(root, { recursive: true, force: true });
  }
});
