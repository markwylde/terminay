import test from "node:test";
import assert from "node:assert/strict";
import { FileWatchRegistry } from "../dist/fileService/index.js";

test("file watch subscriptions are scoped by server, project, resource, and client", async () => {
  const registry = new FileWatchRegistry({ serverId: "server-a", maxQueueEvents: 4, maxBatchEvents: 2 });
  const first = registry.subscribe({ clientId: "client-a", projectId: "project-a", resource: "src" });
  const duplicate = registry.subscribe({ clientId: "client-a", projectId: "project-a", resource: "src" });
  assert.equal(duplicate.subscriptionId, first.subscriptionId);
  const otherClient = registry.subscribe({ clientId: "client-b", projectId: "project-a", resource: "src" });
  const otherProject = registry.subscribe({ clientId: "client-a", projectId: "project-b", resource: "src" });
  const published = registry.publish({ projectId: "project-a", resource: "src/main.ts", kind: "changed", revision: 3, metadata: { size: 12, mode: 0o644 } });
  assert.equal(published.accepted, true);
  assert.equal(published.subscribers, 2);
  const firstBatch = await registry.read(first.subscriptionId);
  assert.deepEqual(firstBatch.events.map((event) => [event.projectId, event.resource]), [["project-a", "src/main.ts"]]);
  assert.equal(firstBatch.events[0].metadata?.mode, 0o644);
  assert.equal((await registry.read(otherClient.subscriptionId)).events.length, 1);
  assert.equal((await registry.read(otherProject.subscriptionId)).events.length, 0);
  assert.equal(registry.pending(first.subscriptionId), 0);
});

test("a project-root watch receives descendant changes without widening project scope", async () => {
  const registry = new FileWatchRegistry({ serverId: "server-a" });
  const root = registry.subscribe({ clientId: "client-a", projectId: "project-a", resource: "." });
  const outside = registry.subscribe({ clientId: "client-b", projectId: "project-b", resource: "." });
  registry.publish({ projectId: "project-a", resource: "src/main.ts", kind: "created" });
  assert.equal((await registry.read(root.subscriptionId)).events.length, 1);
  assert.equal((await registry.read(outside.subscriptionId)).events.length, 0);
});

test("watch events deduplicate and deliver bounded batches", async () => {
  const registry = new FileWatchRegistry({ serverId: "server-a", maxQueueEvents: 4, maxBatchEvents: 2 });
  const subscription = registry.subscribe({ clientId: "client-a", projectId: "project-a", resource: "src" });
  const input = { projectId: "project-a", resource: "src/a.ts", kind: "changed", revision: 1 };
  const first = registry.publish(input);
  const duplicate = registry.publish(input);
  assert.equal(first.sequence, 1);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.deduplicated, true);
  registry.publish({ ...input, resource: "src/b.ts", revision: 2 });
  registry.publish({ ...input, resource: "src/c.ts", revision: 3 });
  const bounded = await registry.read(subscription.subscriptionId, { limit: 2 });
  assert.equal(bounded.events.length, 2);
  assert.equal(bounded.cursor, 2);
  assert.equal(registry.pending(subscription.subscriptionId), 1);
});

test("reconnect can replay bounded history and requests resync when history is gone", async () => {
  const registry = new FileWatchRegistry({ serverId: "server-a", maxQueueEvents: 2, maxBatchEvents: 2 });
  registry.publish({ projectId: "project-a", resource: "src/a.ts", kind: "changed", revision: 1 });
  registry.publish({ projectId: "project-a", resource: "src/b.ts", kind: "changed", revision: 2 });
  const replay = registry.subscribe({ clientId: "client-a", projectId: "project-a", resource: "src", afterSequence: 1 });
  assert.deepEqual((await registry.read(replay.subscriptionId)).events.map((event) => event.resource), ["src/b.ts"]);
  registry.publish({ projectId: "project-a", resource: "src/c.ts", kind: "changed", revision: 3 });
  const stale = registry.subscribe({ clientId: "client-b", projectId: "project-a", resource: "src", afterSequence: 0 });
  const resync = await registry.read(stale.subscriptionId);
  assert.equal(resync.events[0].kind, "resync");
  assert.equal(resync.resyncRequired, true);
});

test("queue overflow collapses to a resync event and abort cancels reads/subscriptions", async () => {
  const registry = new FileWatchRegistry({ serverId: "server-a", maxQueueEvents: 2, maxBatchEvents: 2 });
  const controller = new AbortController();
  const subscription = registry.subscribe({ clientId: "client-a", projectId: "project-a", resource: "src", signal: controller.signal });
  for (let index = 0; index < 4; index += 1) registry.publish({ projectId: "project-a", resource: `src/${index}.ts`, kind: "changed", revision: index + 1 });
  const batch = await registry.read(subscription.subscriptionId);
  assert.equal(batch.events.length, 1);
  assert.equal(batch.events[0].kind, "resync");
  assert.equal(batch.resyncRequired, true);
  assert.equal((await registry.read(subscription.subscriptionId)).resyncRequired, false);
  controller.abort();
  assert.equal(registry.size, 0);
  await assert.rejects(() => registry.read(subscription.subscriptionId, { signal: controller.signal }), /aborted/i);
});

test("invalid project-relative resources and oversized metadata are rejected", () => {
  const registry = new FileWatchRegistry({ serverId: "server-a" });
  assert.throws(() => registry.subscribe({ clientId: "client-a", projectId: "project-a", resource: "../secret" }), /canonical/);
  assert.throws(() => registry.publish({ projectId: "project-a", resource: "src/a", kind: "changed", metadata: { size: -1 } }), /metadata size/);
  assert.throws(() => registry.publish({ projectId: "project-a", resource: "src/a", kind: "changed", metadata: { size: 1, mode: -1 } }), /metadata mode/);
  assert.throws(() => registry.publish({ projectId: "project-a", resource: "src/a", kind: "changed", revision: -1 }), /revision/);
});
