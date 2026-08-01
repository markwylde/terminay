import assert from "node:assert/strict";
import test from "node:test";
import { ActivityClient, AgentStatusClient } from "../dist/index.js";

const session = (attention = false) => ({
  sessionId: "session-a",
  projectId: "project-a",
  status: "idle",
  attention,
  acknowledged: !attention,
  claimed: false,
  authority: "structured",
  source: "test",
  updatedAt: 1,
});

test("activity client converges on the authoritative snapshot after a live replay gap", async () => {
  const requests = [];
  let listener;
  let canonicalSnapshot = { revision: 3, cursor: "3", sessions: { "session-a": session(true) } };
  const client = new ActivityClient({
    query: async (operation, payload) => {
      requests.push({ operation, payload });
      if (operation === "activity.snapshot") return canonicalSnapshot;
      return { kind: "events", events: [] };
    },
    command: async () => null,
    subscribe: async (_event, next) => { listener = next; return () => { listener = undefined; }; },
  });
  await client.refresh();
  assert.equal(client.store.snapshot.sessions["session-a"].attention, true);
  await client.subscribe();
  // The server has advanced through revision 4 while this client was
  // detached. Its next event therefore cannot be applied incrementally; the
  // only safe client behaviour is to replace the local projection from the
  // newer canonical server snapshot.
  canonicalSnapshot = { revision: 5, cursor: "5", sessions: { "session-a": session(false) } };
  listener({ payload: { revision: 5, cursor: "5", type: "activity.changed", sessionId: "session-a", snapshot: session(false) } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.filter(({ operation }) => operation === "activity.snapshot").length, 3);
  assert.equal(client.store.revision, 5);
  assert.equal(client.store.snapshot.sessions["session-a"].attention, false);
  client.close();
});

test("activity client sends acknowledgement only with immutable project/session identity", async () => {
  const commands = [];
  const client = new ActivityClient({
    query: async () => ({ revision: 0, cursor: "0", sessions: {} }),
    command: async (operation, payload) => { commands.push({ operation, payload }); return null; },
    subscribe: async () => () => {},
  });
  await client.acknowledge({ projectId: "project-a", sessionId: "session-a" });
  assert.deepEqual(commands, [{ operation: "activity.acknowledge", payload: { projectId: "project-a", sessionId: "session-a" } }]);
});

test("activity client fences a viewed acknowledgement to its observed session update", async () => {
  const commands = [];
  const client = new ActivityClient({
    query: async () => ({ revision: 3, cursor: "3", sessions: { "session-a": session(true) } }),
    command: async (operation, payload) => { commands.push({ operation, payload }); return null; },
    subscribe: async () => () => {},
  });
  await client.refresh();
  await client.acknowledge({ projectId: "project-a", sessionId: "session-a" });
  assert.deepEqual(commands[0], {
    operation: "activity.acknowledge",
    payload: { projectId: "project-a", sessionId: "session-a", expectedUpdatedAt: 1 },
  });
});

test("activity client reload replaces a restarted-server snapshot without inferring activity", async () => {
  let snapshot = { revision: 7, cursor: "7", sessions: { "session-a": session(true) } };
  const client = new ActivityClient({
    query: async () => snapshot,
    command: async () => null,
    subscribe: async () => () => {},
  });
  const updates = [];
  client.store.subscribe((_value, result) => updates.push(result));

  await client.reload();
  snapshot = { revision: 1, cursor: "1", sessions: { "session-a": session(false) } };
  assert.deepEqual(await client.reload(), { kind: "applied", revision: 1, changed: true });
  assert.equal(client.store.snapshot.sessions["session-a"].attention, false);
  assert.equal(updates.length, 2);

  assert.deepEqual(await client.reload(), { kind: "ignored", revision: 1, changed: false });
  assert.equal(updates.length, 2);
});

test("activity replay resync replaces a restarted canonical snapshot exactly", async () => {
  const initial = { revision: 9, cursor: "9", sessions: { "session-a": session(true) } };
  const restarted = {
    revision: 1,
    cursor: "1",
    sessions: {
      "session-b": {
        ...session(false),
        sessionId: "session-b",
        projectId: "project-b",
        source: "server-restarted",
        updatedAt: 42,
      },
    },
  };
  const client = new ActivityClient({
    query: async (operation) => operation === "activity.snapshot"
      ? initial
      : { kind: "resync", events: [], snapshot: restarted },
    command: async () => null,
    subscribe: async () => () => {},
  });
  const updates = [];
  client.store.subscribe((snapshot) => updates.push(snapshot));

  await client.refresh();
  assert.deepEqual(await client.replay(), { kind: "applied", revision: 1, changed: true });
  assert.deepEqual(client.store.snapshot, restarted);
  assert.equal(updates.length, 2);

  assert.deepEqual(await client.replay(), { kind: "ignored", revision: 1, changed: false });
  assert.equal(updates.length, 2);
});

test("activity stream gap reloads an exact restarted-server snapshot", async () => {
  let listener;
  let snapshot = { revision: 8, cursor: "8", sessions: { "session-a": session(true) } };
  const client = new ActivityClient({
    query: async () => snapshot,
    command: async () => null,
    subscribe: async (_event, next) => { listener = next; return () => { listener = undefined; }; },
  });
  await client.subscribe();
  snapshot = { revision: 1, cursor: "1", sessions: { "session-a": session(false) } };
  listener({ payload: { revision: 10, cursor: "10", type: "activity.changed", sessionId: "session-a", snapshot: session(true) } });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(client.store.snapshot, snapshot);
  client.close();
});

test("a reconnect after server restart replaces canonical activity and agent projections exactly once", async () => {
  let restarted = false;
  const transport = {
    query: async (operation) => {
      if (operation === "activity.snapshot") {
        return restarted
          ? { revision: 1, cursor: "1", sessions: { "session-a": session(false) } }
          : { revision: 7, cursor: "7", sessions: { "session-a": session(true) } };
      }
      if (operation === "agent.snapshot") {
        return restarted
          ? {
              revision: 1,
              cursor: "1",
              entries: {
                "session-a:root": {
                  entryId: "session-a:root",
                  kind: "root",
                  provider: "codex",
                  agentId: "agent-a",
                  sessionId: "session-a",
                  activationTerminalSessionId: "session-a",
                  state: "working",
                  active: true,
                  unread: false,
                },
              },
            }
          : {
              revision: 7,
              cursor: "7",
              entries: {
                "session-a:root": {
                  entryId: "session-a:root",
                  kind: "root",
                  provider: "codex",
                  agentId: "agent-a",
                  sessionId: "session-a",
                  activationTerminalSessionId: "session-a",
                  state: "waiting",
                  active: true,
                  unread: true,
                },
              },
            };
      }
      throw new Error(`unexpected operation: ${operation}`);
    },
    command: async () => null,
    subscribe: async () => () => {},
  };
  const activity = new ActivityClient(transport);
  const agents = new AgentStatusClient(["session-a"], transport);
  const activityTransitions = [];
  const agentTransitions = [];
  activity.store.subscribe((_snapshot, result) => activityTransitions.push(result));
  agents.onChange((snapshot) => agentTransitions.push(snapshot));

  await Promise.all([activity.reload(), agents.reload()]);
  restarted = true;

  assert.deepEqual(await Promise.all([activity.reload(), agents.reload()]), [
    { kind: "applied", revision: 1, changed: true },
    { kind: "applied", revision: 1, changed: true },
  ]);
  assert.equal(activity.store.snapshot.sessions["session-a"].attention, false);
  assert.equal(agents.snapshot.entries["session-a:root"].state, "working");

  assert.deepEqual(await Promise.all([activity.reload(), agents.reload()]), [
    { kind: "ignored", revision: 1, changed: false },
    { kind: "ignored", revision: 1, changed: false },
  ]);
  assert.equal(activityTransitions.length, 2);
  assert.equal(agentTransitions.length, 2);
});

test("activity client rejects a query-command-only compatibility transport before it can retain a snapshot", () => {
  assert.throws(
    () => new ActivityClient({
      query: async () => ({ revision: 0, cursor: "0", sessions: {} }),
      command: async () => null,
    }),
    /activity subscriptions are required/u,
  );
});
