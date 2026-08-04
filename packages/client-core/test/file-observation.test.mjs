import test from "node:test";
import assert from "node:assert/strict";
import { FileObservationClient } from "../dist/index.js";

test("file observation facade validates identities and filters subscription handles", async () => {
  const listeners = new Map();
  const transport = {
    async command(operation, payload) {
      if (operation === "files.watch.start") return { subscriptionId: "watch-1", projectId: payload.projectId, resource: payload.resource, cursor: 0 };
      if (operation === "files.folder-size.start") return { jobId: "size-1", projectId: payload.projectId, resource: payload.resource };
      return null;
    },
    async query() {
      return { subscriptionId: "watch-1", cursor: 1, resyncRequired: false, events: [
        { serverId: "server-a", projectId: "project-a", resource: "docs/a.txt", kind: "changed", sequence: 1 },
      ] };
    },
    async subscribeEvents(event, listener) { listeners.set(event, listener); return () => listeners.delete(event); },
  };
  const client = new FileObservationClient(transport);
  const watch = await client.startWatch("project-a", "docs");
  assert.equal((await client.readWatch(watch)).events[0].resource, "docs/a.txt");
  const received = [];
  await client.subscribeWatch(watch, (event) => received.push(event));
  listeners.get("files.watch")({ subscriptionId: "watch-other", projectId: "project-a", resource: "docs/x", kind: "changed", sequence: 2 });
  listeners.get("files.watch")({ subscriptionId: "watch-1", projectId: "project-a", resource: "docs/b.txt", kind: "created", sequence: 3 });
  assert.deepEqual(received.map((event) => event.resource), ["docs/b.txt"]);

  const size = await client.startFolderSize("project-a", "");
  await client.subscribeFolderSize(size, (event) => received.push(event));
  listeners.get("files.folder-size")({ jobId: "size-1", projectId: "project-a", resource: "", phase: "completed", bytes: 10, files: 2, directories: 1 });
  assert.equal(received.at(-1).bytes, 10);
});

test("file observation facade rejects retargeted and unbounded server DTOs", async () => {
  const client = new FileObservationClient({
    async command() { return { subscriptionId: "watch-1", projectId: "project-b", resource: "", cursor: 0 }; },
    async query() { return null; },
    async subscribeEvents() { return () => {}; },
  });
  await assert.rejects(() => client.startWatch("project-a", ""), /identity mismatch/u);
});
