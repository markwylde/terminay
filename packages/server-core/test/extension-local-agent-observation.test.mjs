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
    async readDirectory(path) {
      calls.push(["readDirectory", path]);
      const prefix = `${path.replace(/\/$/, "")}/`;
      const names = [...files.keys()].filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length).split("/")[0]).filter(Boolean);
      return [...new Set(names)].map((name) => ({ name, kind: name.includes(".") ? "file" : "directory" }));
    },
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

test("This-server observation treats an empty host-issued descendant snapshot as no journal yet", async () => {
  const system = fixtureSystem();
  system.descendants = async () => [];
  const adapter = new ThisServerAgentObservationAdapter({
    homeDirectory: "/home/mark", system,
    resolveTerminal: () => ({ environment: "this-server", shellPid: 10 }),
  });
  const current = terminal("empty-descendants");
  const descendants = await adapter.observe(current, "process.descendants", {}, signal);
  assert.deepEqual(descendants, []);
  assert.deepEqual(await adapter.observe(current, "process.open-files", {
    processes: descendants, options: { access: "writable" },
  }, signal), []);
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

test("home-relative resolution derives HOME from the admitted terminal process, not the host", async () => {
  const system = fixtureSystem();
  system.files.set("/terminal-home/.claude/projects/session.jsonl", new Uint8Array([1]));
  const originalStat = system.stat;
  system.stat = async (path) => path === "/terminal-home" ? { kind: "directory", size: 0 } : originalStat(path);
  system.environment = async (pid, names) => {
    assert.equal(pid, 10); assert.deepEqual(names, ["HOME"]);
    return { HOME: "/terminal-home" };
  };
  const adapter = new ThisServerAgentObservationAdapter({ system, resolveTerminal: () => ({ environment: "this-server", shellPid: 10 }) });
  const handle = await adapter.observe(terminal("terminal-home"), "filesystem.resolve-home-relative", {
    relativePath: ".claude/projects/session.jsonl", beneath: { homeRelative: ".claude/projects" }, extension: ".jsonl",
  }, signal);
  assert.deepEqual(handle, { id: "file-1" });
  assert(system.calls.some(([kind, path]) => kind === "realpath" && path === "/terminal-home/.claude/projects/session.jsonl"));
});

test("opaque directory discovery is terminal-scoped, bounded, canonical and suffix constrained", async () => {
  const system = fixtureSystem();
  system.files.set("/home/mark/.codex/sessions/root.jsonl", new Uint8Array([1, 2]));
  system.files.set("/home/mark/.codex/sessions/nested/child.jsonl", new Uint8Array([3]));
  system.files.set("/home/mark/.codex/sessions/ignored.txt", new Uint8Array([4]));
  const originalStat = system.stat;
  system.stat = async (path) => path === "/home/mark/.codex/sessions" || path === "/home/mark/.codex/sessions/nested"
    ? { kind: "directory", size: 0 }
    : originalStat(path);
  const adapter = new ThisServerAgentObservationAdapter({ homeDirectory: "/home/mark", system, resolveTerminal: () => ({ environment: "this-server", shellPid: 10 }) });
  const current = terminal("directory");
  const root = await adapter.observe(current, "filesystem.resolve-home-directory", { relativePath: ".codex/sessions", beneath: { homeRelative: ".codex" } }, signal);
  assert.deepEqual(root, { id: "directory-1" });
  const listed = await adapter.observe(current, "filesystem.list-directory", { root, options: { extensions: [".jsonl"], maxDepth: 1, maxEntries: 10, maxBytes: 16 } }, signal);
  assert.deepEqual(listed.entries.map((entry) => entry.relativePath), ["nested/child.jsonl", "root.jsonl"]);
  assert.equal(listed.truncated, false);
  const bounded = await adapter.observe(current, "filesystem.list-directory", { root, options: { extensions: [".jsonl"], maxDepth: 1, maxEntries: 1, maxBytes: 16 } }, signal);
  assert.equal(bounded.entries.length, 1); assert.equal(bounded.truncated, true);
  const directoryWatcher = await adapter.observe(current, "filesystem.watch-directory", { root, options: { extensions: [".jsonl"], maxDepth: 1, maxEntries: 10, maxBytes: 16 } }, signal);
  assert.match(directoryWatcher.watcherId, /^directory-watch-/);
  assert.deepEqual(directoryWatcher.snapshot.entries.map((entry) => entry.relativePath), ["nested/child.jsonl", "root.jsonl"]);
  system.files.set("/home/mark/.codex/sessions/late.jsonl", new Uint8Array([5]));
  const changed = await adapter.observe(current, "filesystem.watch-directory", { watcherId: directoryWatcher.watcherId }, signal);
  assert.deepEqual(changed.snapshot.entries.map((entry) => entry.relativePath), ["late.jsonl", "nested/child.jsonl", "root.jsonl"]);
  assert.deepEqual(await adapter.observe(current, "filesystem.watch-directory", { watcherId: directoryWatcher.watcherId }, signal), { closed: false });
  assert.deepEqual(await adapter.observe(current, "filesystem.unwatch-directory", { watcherId: directoryWatcher.watcherId }, signal), { stopped: true });
  await assert.rejects(adapter.observe(current, "filesystem.watch-directory", { watcherId: directoryWatcher.watcherId }, signal), /directory watcher is unavailable/);
  await assert.rejects(adapter.observe(terminal("directory-other"), "filesystem.list-directory", { root, options: { extensions: [".jsonl"], maxDepth: 0, maxEntries: 1, maxBytes: 1 } }, signal), /directory handle is unavailable/);
  await assert.rejects(adapter.observe(current, "filesystem.list-directory", { root: { id: "directory-forged" }, options: { extensions: [".jsonl"], maxDepth: 0, maxEntries: 1, maxBytes: 1 } }, signal), /directory handle is unavailable/);
});

test("file follow replays an equal-size metadata rewrite exactly once as replace", async () => {
  const system = fixtureSystem(); let modifiedAt = "2026-08-24T12:00:00.000Z";
  const originalStat = system.stat;
  system.stat = async (path) => {
    const details = await originalStat(path);
    return details?.kind === "file" ? { ...details, modifiedAt } : details;
  };
  const adapter = new ThisServerAgentObservationAdapter({ homeDirectory: "/home/mark", system, resolveTerminal: () => ({ environment: "this-server", shellPid: 10 }) });
  const current = terminal("same-size");
  const descendants = await adapter.observe(current, "process.descendants", {}, signal);
  const files = await adapter.observe(current, "process.open-files", { processes: descendants, options: { access: "writable" } }, signal);
  const watcher = await adapter.observe(current, "filesystem.follow", { handle: files[0].handle, options: { maxChunkBytes: 128 } }, signal);
  await adapter.observe(current, "filesystem.follow", { watcherId: watcher.watcherId }, signal);
  system.files.set("/home/mark/.example-agent/sessions/one.jsonl", new TextEncoder().encode('{"two":true}\n'));
  modifiedAt = "2026-08-24T12:00:01.000Z";
  assert.deepEqual(await adapter.observe(current, "filesystem.follow", { watcherId: watcher.watcherId }, signal), {
    events: [{ type: "replace", bytes: [...new TextEncoder().encode('{"two":true}\n')] }], closed: false,
  });
  assert.deepEqual(await adapter.observe(current, "filesystem.follow", { watcherId: watcher.watcherId }, signal), { events: [], closed: false });
});

test("This-server open-file snapshots prefer journal paths and stay inside the IPC budget", async () => {
  const system = fixtureSystem();
  const clutter = Array.from({ length: 400 }, (_, index) => ({
    path: `/Users/mark/.nvm/versions/node/v24.14.0/lib/node_modules/pad-${index}.js`,
    access: "read-write",
  }));
  system.openFiles = async () => [
    ...clutter,
    { path: "/home/mark/.codex/sessions/rollout.jsonl", access: "writable" },
  ];
  const adapter = new ThisServerAgentObservationAdapter({
    homeDirectory: "/home/mark", system,
    resolveTerminal: () => ({ environment: "this-server", shellPid: 10 }),
  });
  const current = terminal("journal-preference");
  const descendants = await adapter.observe(current, "process.descendants", {}, signal);
  const files = await adapter.observe(current, "process.open-files", {
    processes: descendants, options: { access: "writable" },
  }, signal);
  assert.deepEqual(files.map((entry) => entry.path), ["/home/mark/.codex/sessions/rollout.jsonl"]);
});

test("This-server open-file snapshots cap a journal-less lsof dump instead of throwing", async () => {
  const system = fixtureSystem();
  system.openFiles = async () => Array.from({ length: 9000 }, (_, index) => ({
    path: `/tmp/writable-${index}`,
    access: "writable",
  }));
  const adapter = new ThisServerAgentObservationAdapter({
    homeDirectory: "/home/mark", system,
    resolveTerminal: () => ({ environment: "this-server", shellPid: 10 }),
  });
  const current = terminal("capped-open-files");
  const descendants = await adapter.observe(current, "process.descendants", {}, signal);
  const files = await adapter.observe(current, "process.open-files", {
    processes: descendants, options: { access: "writable" },
  }, signal);
  assert.equal(files.length, 128);
  assert.equal(files[0].path, "/tmp/writable-0");
  assert.equal(files.at(-1).path, "/tmp/writable-127");
});

test("file follow detects atomic same-path replacement from a host-private identity fact", async () => {
  const system = fixtureSystem(); let identity = "device:inode-one";
  const originalStat = system.stat;
  system.stat = async (path) => {
    const details = await originalStat(path);
    return details?.kind === "file" ? { ...details, identity } : details;
  };
  const adapter = new ThisServerAgentObservationAdapter({ homeDirectory: "/home/mark", system, resolveTerminal: () => ({ environment: "this-server", shellPid: 10 }) });
  const current = terminal("atomic-replacement");
  const descendants = await adapter.observe(current, "process.descendants", {}, signal);
  const files = await adapter.observe(current, "process.open-files", { processes: descendants, options: { access: "writable" } }, signal);
  const watcher = await adapter.observe(current, "filesystem.follow", { handle: files[0].handle, options: { maxChunkBytes: 128 } }, signal);
  await adapter.observe(current, "filesystem.follow", { watcherId: watcher.watcherId }, signal);
  identity = "device:inode-two";
  assert.equal((await adapter.observe(current, "filesystem.follow", { watcherId: watcher.watcherId }, signal)).events[0].type, "replace");
});

test("environment-relative path facts are relative to the optional contained subdirectory", async () => {
  const journal = "/data/grok/sessions/e2e-workspace/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1/events.jsonl";
  const summary = "/data/grok/sessions/e2e-workspace/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1/summary.json";
  const system = fixtureSystem();
  system.files.set(journal, new TextEncoder().encode("{}\n"));
  system.files.set(summary, new TextEncoder().encode("{}\n"));
  const originalStat = system.stat;
  system.stat = async (path) => {
    if (path === "/data/grok" || path === "/data/grok/sessions") return { kind: "directory", size: 0 };
    return originalStat(path);
  };
  system.environment = async (_pid, names) => {
    assert.deepEqual(names, ["GROK_HOME"]);
    return { GROK_HOME: "/data/grok" };
  };
  system.openFiles = async () => [{ path: journal, access: "writable" }];
  const adapter = new ThisServerAgentObservationAdapter({
    homeDirectory: "/home/mark",
    system,
    resolveTerminal: () => ({ environment: "this-server", shellPid: 10 }),
  });
  const current = terminal("grok-home");
  const descendants = await adapter.observe(current, "process.descendants", {}, signal);
  const files = await adapter.observe(current, "process.open-files", {
    processes: descendants, options: { access: "writable" },
  }, signal);
  const handle = files[0].handle;
  assert.equal(
    await adapter.observe(current, "filesystem.environment-relative-path", {
      handle, environmentVariable: "GROK_HOME", beneathRelative: "sessions",
    }, signal),
    "e2e-workspace/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1/events.jsonl",
  );
  const resolved = await adapter.observe(current, "filesystem.resolve-relative-to-environment", {
    relativePath: "sessions/e2e-workspace/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1/summary.json",
    environmentVariable: "GROK_HOME",
    extension: ".json",
  }, signal);
  assert.equal(typeof resolved?.id, "string");
});
