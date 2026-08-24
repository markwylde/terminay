import test from "node:test";
import assert from "node:assert/strict";
import { ThisServerAgentObservationAdapter } from "../dist/extensions/index.js";

const signal = new AbortController().signal;

function terminal(contextId, environmentId = "local") {
  return {
    contextId,
    serverId: "server-1",
    projectId: "project-1",
    projectEnvironmentId: environmentId,
    terminalSessionId: `terminal-${contextId}`,
    terminalIncarnationId: `incarnation-${contextId}`,
    providerId: "example.agent/cli",
  };
}

function fixtureSystem() {
  const files = new Map([["/home/mark/.example-agent/sessions/one.jsonl", new TextEncoder().encode('{"one":true}\n')]]);
  const calls = [];
  return {
    files,
    calls,
    async descendants(pid) { calls.push(["descendants", pid]); return [{ pid: 42, executableName: "example-agent", cwd: "/work" }]; },
    async openFiles(pids, access) { calls.push(["openFiles", pids, access]); return [{ path: "/home/mark/.example-agent/sessions/one.jsonl", access: "writable" }]; },
    async tty(pid) { calls.push(["tty", pid]); return "/dev/ttys012"; },
    async foreground(pid) { calls.push(["foreground", pid]); return { executableName: "zsh", arguments: ["-l"] }; },
    async realpath(path) { calls.push(["realpath", path]); return path; },
    async stat(path) { calls.push(["stat", path]); const bytes = files.get(path); return bytes === undefined ? undefined : { kind: "file", size: bytes.byteLength, modifiedAt: "2026-08-24T12:00:00.000Z" }; },
    async read(path, position, maximum) { calls.push(["read", path, position, maximum]); return files.get(path)?.slice(position, position + maximum); },
  };
}

test("This-server observation adapter issues opaque terminal-scoped process and file facts", async () => {
  const system = fixtureSystem();
  const adapter = new ThisServerAgentObservationAdapter({
    homeDirectory: "/home/mark",
    system,
    resolveTerminal: (value) => value.projectEnvironmentId === "local"
      ? { environment: "this-server", shellPid: 10 }
      : { environment: "remote", shellPid: 999 },
  });
  const current = terminal("one");

  assert.deepEqual(await adapter.observe(current, "process.foreground", {}, signal), { executableName: "zsh", arguments: ["-l"] });
  assert.deepEqual(await adapter.observe(current, "terminal.tty", {}, signal), { path: "/dev/ttys012", terminalId: "ttys012" });
  const descendants = await adapter.observe(current, "process.descendants", {}, signal);
  assert.equal(descendants[0].executableName, "example-agent");
  assert.match(descendants[0].handle.id, /^process-/);

  const files = await adapter.observe(current, "process.open-files", {
    processes: descendants, options: { access: "writable" },
  }, signal);
  assert.deepEqual(files.map((entry) => ({ path: entry.path, access: entry.access })), [{ path: "/home/mark/.example-agent/sessions/one.jsonl", access: "writable" }]);
  const handle = files[0].handle;
  assert.match(handle.id, /^file-/);
  assert.deepEqual(await adapter.observe(current, "filesystem.realpath", { handle, options: { beneath: { homeRelative: ".example-agent/sessions" }, extension: ".jsonl" } }, signal), handle);
  assert.deepEqual(await adapter.observe(current, "filesystem.stat", { handle }, signal), {
    handle, kind: "file", size: 13, modifiedAt: "2026-08-24T12:00:00.000Z",
  });
  assert.deepEqual(await adapter.observe(current, "filesystem.read", { handle, options: { maxBytes: 128 } }, signal), [...new TextEncoder().encode('{"one":true}\n')]);

  const watcher = await adapter.observe(current, "filesystem.follow", { handle, options: { maxChunkBytes: 128 } }, signal);
  assert.match(watcher.watcherId, /^watch-/);
  assert.deepEqual(await adapter.observe(current, "filesystem.follow", { watcherId: watcher.watcherId }, signal), {
    events: [{ type: "append", bytes: [...new TextEncoder().encode('{"one":true}\n')] }], closed: false,
  });
  system.files.set("/home/mark/.example-agent/sessions/one.jsonl", new TextEncoder().encode('{"one":true}\n{"two":true}\n'));
  assert.deepEqual(await adapter.observe(current, "filesystem.follow", { watcherId: watcher.watcherId }, signal), {
    events: [{ type: "append", bytes: [...new TextEncoder().encode('{"two":true}\n')] }], closed: false,
  });
  assert.deepEqual(await adapter.observe(current, "filesystem.unfollow", { watcherId: watcher.watcherId }, signal), { stopped: true });
  await assert.rejects(adapter.observe(current, "filesystem.follow", { watcherId: watcher.watcherId }, signal), /watcher is unavailable/);
});

test("This-server adapter rejects remote contexts before consulting local processes or files", async () => {
  const system = fixtureSystem();
  const adapter = new ThisServerAgentObservationAdapter({
    system,
    resolveTerminal: () => ({ environment: "remote", shellPid: 999 }),
  });
  await assert.rejects(adapter.observe(terminal("remote", "ssh"), "process.descendants", {}, signal), /unavailable for remote environment/);
  await assert.rejects(adapter.observe(terminal("remote", "ssh"), "filesystem.read", { handle: { id: "file-1" }, options: { maxBytes: 1 } }, signal), /unavailable for remote environment/);
  assert.deepEqual(system.calls, []);
});

test("This-server adapter rejects manufactured and cross-terminal handles and clears them on teardown", async () => {
  const system = fixtureSystem();
  const adapter = new ThisServerAgentObservationAdapter({
    homeDirectory: "/home/mark", system,
    resolveTerminal: () => ({ environment: "this-server", shellPid: 10 }),
  });
  const first = terminal("first"); const second = terminal("second");
  const descendants = await adapter.observe(first, "process.descendants", {}, signal);
  await assert.rejects(adapter.observe(second, "process.open-files", { processes: descendants.map((entry) => entry.handle), options: { access: "writable" } }, signal), /process handle is unavailable/);
  await assert.rejects(adapter.observe(first, "filesystem.read", { handle: { id: "file-invented" }, options: { maxBytes: 1 } }, signal), /file handle is unavailable/);
  adapter.disposeTerminal("first");
  await assert.rejects(adapter.observe(first, "process.open-files", { processes: descendants.map((entry) => entry.handle), options: { access: "writable" } }, signal), /process handle is unavailable/);
});

test("This-server adapter applies canonical home and extension constraints without widening a file handle", async () => {
  const system = fixtureSystem();
  const adapter = new ThisServerAgentObservationAdapter({ homeDirectory: "/home/mark", system, resolveTerminal: () => ({ environment: "this-server", shellPid: 10 }) });
  const current = terminal("constraint");
  const descendants = await adapter.observe(current, "process.descendants", {}, signal);
  const files = await adapter.observe(current, "process.open-files", { processes: descendants.map((entry) => entry.handle), options: { access: "writable" } }, signal);
  const handle = files[0].handle;
  assert.equal(await adapter.observe(current, "filesystem.realpath", { handle, options: { beneath: { homeRelative: ".other-agent" } } }, signal), null);
  assert.equal(await adapter.observe(current, "filesystem.realpath", { handle, options: { extension: ".sqlite" } }, signal), null);
  assert.equal(await adapter.observe(current, "filesystem.realpath", { handle, options: { beneath: { homeRelative: "../etc" } } }, signal), null);
});
