import assert from "node:assert/strict";
import test from "node:test";
import { AgentStatusService, TerminalActivityService } from "../dist/index.js";

const identity = Object.freeze({ serverId: "server-1", projectId: "project-1", sessionId: "terminal-1" });
const providerId = "example.agent/test";
const binding = Object.freeze({ providerSessionId: "provider-session-1", mappingVersion: "1", fingerprint: { kind: "test", process: { id: "process-1" }, metadata: { proof: "fixture" } } });

async function fixture(options = {}) {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({ activity, now: () => 1_000, ...options });
  await agents.start(); agents.register(identity);
  assert.equal(agents.claimExtensionProvider(identity, providerId), true);
  return { agents };
}

test("agent status service projects only claimed extension lifecycle DTOs", async () => {
  const { agents } = await fixture();
  const result = await agents.ingestExtensionLifecycle(identity, providerId, "1", binding, [
    { kind: "session.started", title: "Provider session", model: { id: "model-1", displayName: "Model One" } },
    { kind: "turn.started", turnId: "turn-1", promptText: "A bounded prompt" },
    { kind: "wait.started", waitId: "wait-1", state: "waiting", reason: "approval" },
  ]);
  assert.deepEqual(result, { acceptedEventCount: 3, rejectedEventCount: 0 });
  const [entry] = Object.values(agents.getSnapshot().entries);
  assert.equal(entry.provider, providerId);
  assert.equal(entry.displayName, "Provider session");
  assert.equal(entry.promptText, "A bounded prompt");
  assert.equal(entry.state, "waiting");
  assert.equal(entry.model.id, "model-1");
  await agents.stop();
});

test("agent status service rejects unclaimed, invalid, and native-record input", async () => {
  const { agents } = await fixture();
  assert.equal(await agents.ingestJournalRecord(identity, providerId, { arbitrary: true }), false);
  assert.deepEqual(
    await agents.ingestExtensionLifecycle(identity, "example.agent/other", "1", binding, [{ kind: "session.started" }]),
    { acceptedEventCount: 0, rejectedEventCount: 1, failure: "extension agent provider does not own this terminal session" },
  );
  assert.deepEqual(
    await agents.ingestExtensionLifecycle(identity, providerId, "1", binding, [{ kind: "not-an-event" }]),
    { acceptedEventCount: 0, rejectedEventCount: 1, failure: "extension lifecycle event is invalid" },
  );
  await agents.stop();
});

test("lifecycle entries stamp the extension contribution display name", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const agents = new AgentStatusService({
    activity,
    now: () => 1_000,
    providerDisplayName: (id) => id === providerId ? "Fixture Agent" : undefined,
  });
  await agents.start();
  agents.register(identity);
  assert.equal(agents.claimExtensionProvider(identity, providerId), true);
  assert.equal((await agents.ingestExtensionLifecycle(identity, providerId, "1", binding, [{ kind: "session.started" }])).acceptedEventCount, 1);
  const [entry] = Object.values(agents.getSnapshot().entries);
  assert.equal(entry.providerDisplayName, "Fixture Agent");
  await agents.stop();
});

test("provider release retires only its exact terminal lifecycle run", async () => {
  const { agents } = await fixture();
  await agents.ingestExtensionLifecycle(identity, providerId, "1", binding, [{ kind: "session.started" }]);
  assert.equal(agents.releaseExtensionProvider(identity, providerId), true);
  const [entry] = Object.values(agents.getSnapshot().entries);
  assert.equal(entry.active, false);
  assert.equal(entry.lastEventKind, "session.stopped");
  await agents.stop();
});

test("releasing then reclaiming the same provider session continues the lifecycle sequence", async () => {
  const { agents } = await fixture();
  assert.equal((await agents.ingestExtensionLifecycle(identity, providerId, "1", binding, [{ kind: "session.started", title: "Original" }])).acceptedEventCount, 1);
  assert.equal(agents.releaseExtensionProvider(identity, providerId), true);
  assert.equal(agents.claimExtensionProvider(identity, providerId), true);
  const resumed = await agents.ingestExtensionLifecycle(identity, providerId, "1", binding, [{ kind: "session.started", title: "Resumed" }]);
  assert.equal(resumed.acceptedEventCount, 1, resumed.failure);
  const [entry] = Object.values(agents.getSnapshot().entries);
  assert.equal(entry.active, true);
  assert.equal(entry.displayName, "Resumed");
  assert.ok(entry.lastEventSequence > 1);
  await agents.stop();
});

test("a resumed native child reuses its exact row and preserves root isolation", async () => {
  const { agents } = await fixture();
  assert.deepEqual(await agents.ingestExtensionLifecycle(identity, providerId, "1", binding, [
    { kind: "session.started", title: "Root" },
    { kind: "subagent.started", subagentId: "child-1", title: "First child", model: { id: "model-a" } },
    { kind: "subagent.done", subagentId: "child-1", outcome: "success" },
    { kind: "subagent.started", subagentId: "child-1", title: "Resumed child", model: { id: "model-b" } },
    { kind: "agent.metadata", agentId: "child-1", title: "Renamed child", model: { id: "model-c" } },
  ]), { acceptedEventCount: 5, rejectedEventCount: 0 });
  const entries = Object.values(agents.getSnapshot().entries);
  assert.equal(entries.length, 2);
  const child = entries.find((entry) => entry.kind === "subagent");
  assert.equal(child?.active, true);
  assert.equal(child?.displayName, "Renamed child");
  assert.equal(child?.model?.id, "model-c");
  assert.equal(child?.parentEntryId, entries.find((entry) => entry.kind === "root")?.entryId);
  await agents.stop();
});

test("an inadmissible event is dropped on its own and never withholds the rest of its batch", async () => {
  const rejections = [];
  const { agents } = await fixture({ onLifecycleRejected: (rejection) => rejections.push(rejection) });
  // The bug this guards: a stale tool.finished sharing a batch with the
  // completion used to reject the whole publication, leaving the row working.
  const mixed = await agents.ingestExtensionLifecycle(identity, providerId, "1", binding, [
    { kind: "session.started" },
    { kind: "turn.started", turnId: "turn-1" },
    { kind: "tool.finished", toolId: "never-started" },
    { kind: "agent.done", outcome: "success" },
  ]);
  assert.deepEqual(mixed, { acceptedEventCount: 3, rejectedEventCount: 1 });
  const [entry] = Object.values(agents.getSnapshot().entries);
  assert.equal(entry.state, "done");
  assert.equal(rejections.length, 1);
  assert.equal(rejections[0].kind, "agent-lifecycle-rejected");
  assert.equal(rejections[0].eventKind, "tool.finished");
  assert.equal(rejections[0].reason, "precondition");
  assert.equal(rejections[0].terminal.sessionId, identity.sessionId);
  // Sequence numbers are spent whether or not the event was admitted, so the
  // dropped event leaves a gap rather than a number a later event reuses.
  assert.equal(entry.lastEventSequence, 4);
  const revision = agents.getSnapshot().revision;
  for (const events of [
    [{ kind: "tool.started", toolId: "tool-1", name: "first" }, { kind: "tool.started", toolId: "tool-1", name: "duplicate" }],
    [{ kind: "tool.finished", toolId: "wrong" }],
    [{ kind: "subagent.done", subagentId: "unknown", outcome: "success" }],
  ]) {
    const result = await agents.ingestExtensionLifecycle(identity, providerId, "1", undefined, events);
    assert.equal(result.rejectedEventCount, 1);
  }
  assert.notEqual(agents.getSnapshot().revision, revision);
  await agents.stop();
});

test("a publication of nothing but inadmissible events changes no state", async () => {
  const { agents } = await fixture();
  await agents.ingestExtensionLifecycle(identity, providerId, "1", binding, [{ kind: "session.started" }]);
  const before = agents.getSnapshot();
  const rejected = await agents.ingestExtensionLifecycle(identity, providerId, "1", undefined, [
    { kind: "tool.finished", toolId: "missing" },
    { kind: "tool.finished", toolId: "also-missing" },
  ]);
  assert.deepEqual(rejected, { acceptedEventCount: 0, rejectedEventCount: 2 });
  assert.strictEqual(agents.getSnapshot(), before);
  await agents.stop();
});

test("publication bounds and retirement reject late events without touching unrelated providers",async()=>{
  const activity=new TerminalActivityService({serverId:identity.serverId});const other={...identity,sessionId:"terminal-2"};activity.register(identity);activity.register(other);
  const agents=new AgentStatusService({activity,now:()=>1000});await agents.start();agents.register(identity);agents.register(other);
  const otherProvider="example.other/test";agents.claimExtensionProvider(identity,providerId);agents.claimExtensionProvider(other,otherProvider);
  const otherBinding={...binding,providerSessionId:"other-session"};
  await agents.ingestExtensionLifecycle(identity,providerId,"1",binding,[{kind:"session.started"}]);
  await agents.ingestExtensionLifecycle(other,otherProvider,"1",otherBinding,[{kind:"session.started",title:"Healthy"}]);
  const before=agents.getSnapshot();const oversized=await agents.ingestExtensionLifecycle(identity,providerId,"1",undefined,Array.from({length:65},(_,index)=>({kind:"turn.started",turnId:`turn-${index}`})));
  assert.match(oversized.failure,/publication is invalid/);assert.strictEqual(agents.getSnapshot(),before);
  assert.equal(agents.releaseExtensionProvider(identity,providerId),true);const retired=agents.getSnapshot();
  const late=await agents.ingestExtensionLifecycle(identity,providerId,"1",undefined,[{kind:"turn.started",turnId:"late"}]);assert.match(late.failure,/does not own/);assert.strictEqual(agents.getSnapshot(),retired);
  const healthy=Object.values(agents.getSnapshot().entries).find((entry)=>entry.provider===otherProvider);assert.equal(healthy.active,true);assert.equal(healthy.displayName,"Healthy");await agents.stop();
});

test("agent snapshots are stamped with the constructing process instance id", async () => {
  const activity = new TerminalActivityService({ serverId: identity.serverId });
  activity.register(identity);
  const first = new AgentStatusService({ activity, now: () => 1_000, processInstanceId: "process-a" });
  const second = new AgentStatusService({ activity, now: () => 1_000, processInstanceId: "process-b" });
  await first.start(); await second.start();
  first.register(identity); second.register(identity);
  assert.equal(first.getSnapshot().processInstanceId, "process-a");
  assert.equal(second.getSnapshot().processInstanceId, "process-b");
  assert.notEqual(new AgentStatusService({ activity }).processId, first.processId);
  await first.stop(); await second.stop();
});
