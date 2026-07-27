import assert from "node:assert/strict";
import test from "node:test";
import { TerminalActivityService, TerminalActivityServiceError } from "../dist/activity/index.js";

const identity = (projectId = "project-a", sessionId = "session-a") => ({ serverId: "server-a", projectId, sessionId });

test("activity service parses PTY output before raw fallback and replays one ordered stream", () => {
  let now = 100;
  const service = new TerminalActivityService({ serverId: "server-a", now: () => now, reducer: { maxEvents: 16 } });
  service.register(identity());
  const first = service.ingestPtyOutput(identity(), "\u001b]133;C\u001b\\");
  assert.equal(first.length, 1);
  assert.equal(service.get(identity())?.status, "working");
  now = 101;
  const second = service.ingestPtyOutput(identity(), "\u001b]133;D;0\u001b\\");
  assert.ok(second.length >= 1);
  assert.equal(service.get(identity())?.status, "idle");
  assert.equal(service.replay(0).kind, "events");
  assert.ok(service.replay(0).events.every((event, index, events) => index === 0 || event.revision > events[index - 1].revision));
});

test("activity service rejects cross-server/project and stale session writes", () => {
  const service = new TerminalActivityService({ serverId: "server-a" });
  service.register(identity());
  assert.throws(() => service.ingestSignal({ ...identity(), serverId: "server-b" }, { kind: "bell" }), (error) => error instanceof TerminalActivityServiceError && error.code === "server_mismatch");
  assert.throws(() => service.ingestSignal(identity("project-b"), { kind: "bell" }), (error) => error instanceof TerminalActivityServiceError && error.code === "project_mismatch");
  service.markExited(identity());
  assert.throws(() => service.ingestPtyOutput(identity(), "late"), (error) => error instanceof TerminalActivityServiceError && error.code === "session_exited");
});

test("provider activity remains authoritative over later PTY fallback evidence", () => {
  const service = new TerminalActivityService({ serverId: "server-a" });
  service.register(identity());
  service.ingestProvider(identity(), { provider: "codex", state: "waiting", agentId: "agent-a", sequence: 1 });
  service.ingestPtyOutput(identity(), "spinner");
  assert.equal(service.get(identity())?.provider, "codex");
  assert.equal(service.get(identity())?.providerState, "waiting");
});

test("multiple subscribers receive one ordered canonical stream and scoped acknowledgement", () => {
  const service = new TerminalActivityService({ serverId: "server-a", now: () => 100 });
  service.register(identity());
  const first = [];
  const second = [];
  service.subscribe((event, snapshot) => first.push({ event, snapshot }));
  service.subscribe((event, snapshot) => second.push({ event, snapshot }));

  service.ingestSignal(identity(), { kind: "bell" });
  service.acknowledge(identity());

  assert.equal(first.length, 2);
  assert.deepEqual(second, first);
  assert.deepEqual(first.map(({ event }) => event.revision), [1, 2]);
  assert.equal(first[0].event.snapshot.sessionId, "session-a");
  assert.equal(first[1].snapshot.sessions["session-a"].acknowledged, true);
  assert.equal(first[1].snapshot.sessions["session-a"].attention, false);
});
