import assert from "node:assert/strict";
import test from "node:test";
import { AgentStatusClient } from "../dist/index.js";

const entry = (sessionId, entryId = `${sessionId}:root`, state = "working") => ({
  entryId,
  kind: "root",
  provider: "example.agent/test",
  agentId: entryId,
  sessionId,
  activationTerminalSessionId: sessionId,
  state,
  active: true,
  unread: true,
});

test("agent client applies scoped snapshots and never leaks another project's session", () => {
  const client = new AgentStatusClient(["session-a"]);
  const result = client.applySnapshot({ revision: 2, cursor: "2", entries: { "session-a:root": entry("session-a"), "session-b:root": entry("session-b") } });
  assert.equal(result.kind, "applied");
  assert.deepEqual(Object.keys(client.snapshot.entries), ["session-a:root"]);
  assert.equal(client.entriesForSession("session-b").length, 0);
  assert.equal(client.applyEvent({ revision: 3, cursor: "3", type: "agent.changed", entryId: "session-b:root", entry: entry("session-b") }).changed, false);
});

test("agent client fences replay gaps and accepts an explicit resnapshot", () => {
  const client = new AgentStatusClient(["session-a"]);
  client.applySnapshot({ revision: 1, cursor: "1", entries: { "session-a:root": entry("session-a") } });
  assert.equal(client.applyEvent({ revision: 3, cursor: "3", type: "agent.changed", entryId: "session-a:root", entry: entry("session-a", "session-a:root", "waiting") }).kind, "resync_required");
  assert.equal(client.applySnapshot({ revision: 3, cursor: "3", entries: { "session-a:root": entry("session-a", "session-a:root", "waiting") } }).kind, "applied");
  assert.equal(client.snapshot.entries["session-a:root"].state, "waiting");
});

test("agent client publishes a changed scoped projection when navigation changes session scope", () => {
  const client = new AgentStatusClient(["session-a"]);
  const updates = [];
  client.onChange((snapshot) => updates.push(Object.keys(snapshot.entries)));
  client.applySnapshot({
    revision: 2,
    cursor: "2",
    entries: {
      "session-a:root": entry("session-a"),
      "session-b:root": entry("session-b"),
    },
  });

  const waiting = entry("session-b", "session-b:root", "waiting");
  assert.deepEqual(
    client.applyEvent({
      revision: 3,
      cursor: "3",
      type: "agent.changed",
      entryId: "session-b:root",
      entry: waiting,
    }),
    { kind: "ignored", revision: 3, changed: false },
  );

  client.setSessionScope(["session-b"]);
  assert.deepEqual(updates, [["session-a:root"], ["session-b:root"]]);
  assert.equal(client.snapshot.entries["session-b:root"].state, "waiting");

  // Reapplying the same scope does not manufacture a transition.
  client.setSessionScope(["session-b"]);
  assert.equal(updates.length, 2);
});

test("agent client retains a rendered host-created session while a workspace delta adds other sessions", () => {
  const client = new AgentStatusClient(["session-host"]);
  client.applySnapshot({
    revision: 1,
    cursor: "1",
    entries: {
      "session-host:root": entry("session-host"),
      "session-workspace:root": entry("session-workspace"),
    },
  });
  client.mergeSessionScope(["session-workspace"]);
  assert.deepEqual(Object.keys(client.snapshot.entries).sort(), ["session-host:root", "session-workspace:root"]);
});

test("agent client refreshes, subscribes, and acknowledges through the canonical transport", async () => {
  let listener;
  const requests = [];
  const transport = {
    async query(operation) {
      requests.push(["query", operation]);
      return { revision: 1, cursor: "1", entries: { "session-a:root": entry("session-a") } };
    },
    async command(operation, payload) {
      requests.push(["command", operation, payload]);
      return { acknowledged: true, revision: 2, cursor: "2" };
    },
    subscribe(event, next) {
      requests.push(["subscribe", event]);
      listener = next;
      return () => requests.push(["unsubscribe", event]);
    },
  };
  const client = new AgentStatusClient(["session-a"], transport);

  const unsubscribe = await client.subscribe();
  listener({ revision: 2, cursor: "2", entries: { "session-a:root": entry("session-a", "session-a:root", "waiting") } });
  await client.acknowledge({ projectId: "project-a", sessionId: "session-a", entryId: "session-a:root" });

  assert.equal(client.snapshot.entries["session-a:root"].state, "waiting");
  assert.deepEqual(requests.map(([kind, operation]) => [kind, operation]), [
    ["subscribe", "agent"],
    ["query", "agent.snapshot"],
    ["command", "agent.acknowledge"],
  ]);
  unsubscribe();
  assert.deepEqual(requests.at(-1), ["unsubscribe", "agent"]);
});

test("agent client never regresses from a newer live snapshot to a delayed refresh", () => {
  const client = new AgentStatusClient(["session-a"]);
  client.applySnapshot({ revision: 4, cursor: "4", entries: { "session-a:root": entry("session-a", "session-a:root", "waiting") } });
  assert.deepEqual(
    client.applySnapshot({ revision: 3, cursor: "3", entries: { "session-a:root": entry("session-a", "session-a:root", "working") } }),
    { kind: "ignored", revision: 4, changed: false },
  );
  assert.equal(client.snapshot.entries["session-a:root"].state, "waiting");
});

test("agent client reloads its authoritative snapshot after subscription resync", async () => {
  let onResync;
  let queries = 0;
  const snapshots = [
    { revision: 1, cursor: "1", entries: { "session-a:root": entry("session-a", "session-a:root", "working") } },
    { revision: 9, cursor: "9", entries: { "session-a:root": entry("session-a", "session-a:root", "waiting") } },
  ];
  const client = new AgentStatusClient(["session-a"], {
    async query() { return snapshots[Math.min(queries++, snapshots.length - 1)]; },
    async command() { return null; },
    subscribe(_event, _listener, resync) {
      onResync = resync;
      return () => undefined;
    },
  });

  await client.subscribe();
  assert.equal(client.snapshot.revision, 1);
  onResync();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(client.snapshot.revision, 9);
  assert.equal(client.snapshot.entries["session-a:root"].state, "waiting");
});

test("a host transport forwards resync so stale done state is replaced after a server revision restart", async () => {
  let transportResync;
  let restarted = false;
  const staleDone = {
    revision: 9,
    cursor: "9",
    entries: { "session-a:root": entry("session-a", "session-a:root", "done") },
  };
  const restartedWorking = {
    revision: 2,
    cursor: "2",
    entries: {
      "session-a:root": entry("session-a", "session-a:root", "working"),
      "session-b:root": entry("session-b", "session-b:root", "working"),
    },
  };
  const featureTransport = {
    async query() { return restarted ? restartedWorking : staleDone; },
    async command() { return null; },
    subscribeEvents(_event, _listener, onResync) {
      transportResync = onResync;
      return () => undefined;
    },
  };
  const client = new AgentStatusClient(["session-a", "session-b"], {
    query: featureTransport.query,
    command: featureTransport.command,
    subscribe: (event, listener, onResync) => featureTransport.subscribeEvents(
      event,
      listener,
      onResync,
    ),
  });

  await client.subscribe();
  assert.equal(client.snapshot.entries["session-a:root"].state, "done");
  restarted = true;
  transportResync();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(client.snapshot.revision, 2);
  assert.equal(client.snapshot.entries["session-a:root"].state, "working");
  assert.equal(client.snapshot.entries["session-b:root"].state, "working");
});

test("agent client reload replaces a restarted-server snapshot without manufacturing an event", async () => {
  let snapshot = { revision: 8, cursor: "8", entries: { "session-a:root": entry("session-a", "session-a:root", "waiting") } };
  const client = new AgentStatusClient(["session-a"], {
    query: async () => snapshot,
    command: async () => null,
    subscribe: () => () => undefined,
  });
  const published = [];
  client.onChange((value) => published.push(value));

  await client.reload();
  snapshot = { revision: 1, cursor: "1", entries: { "session-a:root": entry("session-a", "session-a:root", "working") } };
  assert.deepEqual(await client.reload(), { kind: "applied", revision: 1, changed: true });
  assert.equal(client.snapshot.entries["session-a:root"].state, "working");
  assert.equal(published.length, 2);

  assert.deepEqual(await client.reload(), { kind: "ignored", revision: 1, changed: false });
  assert.equal(published.length, 2);
});

test("agent client resync preserves canonical restart identity and revision exactly", async () => {
  let snapshot = {
    revision: 8,
    cursor: "8",
    entries: { "session-a:root": entry("session-a", "session-a:root", "waiting") },
  };
  const client = new AgentStatusClient(["session-a"], {
    query: async () => snapshot,
    command: async () => null,
    subscribe: () => () => undefined,
  });
  let published = 0;
  client.onChange(() => { published += 1; });
  await client.refresh();

  const restartedEntry = {
    ...entry("session-a", "session-a:replacement", "working"),
    agentId: "server-owned-agent",
    provider: "example.agent/restarted",
    unread: false,
  };
  snapshot = { revision: 1, cursor: "1", entries: { "session-a:replacement": restartedEntry } };
  assert.deepEqual(await client.resync(), { kind: "applied", revision: 1, changed: true });
  assert.deepEqual(client.snapshot, snapshot);
  assert.equal(published, 2);

  assert.deepEqual(await client.resync(), { kind: "ignored", revision: 1, changed: false });
  assert.equal(published, 2);
});

test("agent client ignores an identical snapshot without publishing a duplicate transition", () => {
  const client = new AgentStatusClient(["session-a"]);
  let publishes = 0;
  client.onChange(() => { publishes += 1; });
  const snapshot = { revision: 4, cursor: "4", entries: { "session-a:root": entry("session-a", "session-a:root", "waiting") } };
  assert.deepEqual(client.applySnapshot(snapshot), { kind: "applied", revision: 4, changed: true });
  assert.deepEqual(client.applySnapshot(snapshot), { kind: "ignored", revision: 4, changed: false });
  assert.equal(publishes, 1);
});

test("agent client accepts a bounded long canonical entry id", () => {
  const client = new AgentStatusClient(["session-a"]);
  const entryId = `session-a:${"a".repeat(600)}`;
  const result = client.applySnapshot({
    revision: 1,
    cursor: "1",
    entries: { [entryId]: { ...entry("session-a", entryId), agentId: "a".repeat(600) } },
  });
  assert.equal(result.kind, "applied");
  assert.ok(client.snapshot.entries[entryId]);
});

test("agent subscription tears down when its post-subscribe snapshot cannot be read", async () => {
  const requests = [];
  const client = new AgentStatusClient(["session-a"], {
    query: async () => { throw new Error("snapshot unavailable"); },
    command: async () => null,
    subscribe: async () => {
      requests.push("subscribe");
      return () => requests.push("unsubscribe");
    },
  });
  await assert.rejects(() => client.subscribe(), /snapshot unavailable/u);
  assert.deepEqual(requests, ["subscribe", "unsubscribe"]);
});

test("agent client rejects a query-command compatibility bridge before it can retain a stale projection", () => {
  assert.throws(
    () => new AgentStatusClient(["session-a"], {
      query: async () => ({ revision: 0, cursor: "0", entries: {} }),
      command: async () => null,
    }),
    /agent status subscriptions are required on this transport/u,
  );
});
