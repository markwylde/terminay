import test from "node:test";
import assert from "node:assert/strict";
import {
  CanonicalProjectPathResolver,
  FileContentStreamService,
  FileWatchRegistry,
} from "../dist/fileService/index.js";

function resumableContent() {
  let bytes = new TextEncoder().encode("0123456789");
  let blockNextOffsetFour = true;
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  const storage = {
    realpath(path) { if (path === "/project" || path === "/project/large.txt") return path; throw missing(path); },
    stat(path) { if (path === "/project") return { isDirectory: true, size: 0 }; if (path === "/project/large.txt") return { isFile: true, size: bytes.byteLength }; throw missing(path); },
    readRange(path, offset, length, signal) {
      if (path !== "/project/large.txt") throw missing(path);
      const snapshot = bytes.slice();
      if (offset === 4 && blockNextOffsetFour) {
        blockNextOffsetFour = false;
        return new Promise((resolve, reject) => {
          let timer;
          const onAbort = () => {
            if (timer !== undefined) clearTimeout(timer);
            reject(signal?.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError"));
          };
          signal?.addEventListener("abort", onAbort, { once: true });
          timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve(snapshot.slice(offset, offset + length));
          }, 1000);
        });
      }
      if (signal?.aborted === true) throw signal.reason;
      return snapshot.slice(offset, offset + length);
    },
  };
  return {
    storage,
    setBytes(value) { bytes = new TextEncoder().encode(value); },
    service: new FileContentStreamService(new CanonicalProjectPathResolver("/project", storage), storage, { maxRangeBytes: 4, maxConcurrentReads: 1, largeFileBytes: 8 }),
  };
}

function decode(range) { return new TextDecoder().decode(range.bytes); }

test("bounded file content resumes from the last acknowledged offset after cancellation", async () => {
  const fixture = resumableContent();
  const first = await fixture.service.readRange("large.txt", 0, 4);
  assert.equal(decode(first), "0123");
  assert.equal(first.offset, 0);
  assert.equal(first.truncated, false);

  const controller = new AbortController();
  const interrupted = fixture.service.readRange("large.txt", 4, 4, controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(interrupted, /aborted/i);

  const resumed = await fixture.service.readRange("large.txt", 4, 4);
  const tail = await fixture.service.readRange("large.txt", 8, 4);
  assert.equal(decode(resumed), "4567");
  assert.equal(resumed.offset, 4);
  assert.equal(resumed.totalSize, 10);
  assert.equal(decode(tail), "89");
  assert.equal(tail.offset, 8);
  assert.equal(tail.truncated, true);
  assert.equal(`${decode(first)}${decode(resumed)}${decode(tail)}`, "0123456789");
});

test("stale watch reconnect requests resync before restarting content at offset zero", async () => {
  const fixture = resumableContent();
  const initial = await fixture.service.readRange("large.txt", 0, 4);
  assert.equal(decode(initial), "0123");
  const watches = new FileWatchRegistry({ serverId: "server-a", maxQueueEvents: 2, maxBatchEvents: 2 });
  const live = watches.subscribe({ clientId: "client-a", projectId: "project-a", resource: "large.txt" });

  fixture.setBytes("abcdefghij");
  for (let revision = 1; revision <= 5; revision += 1) watches.publish({ projectId: "project-a", resource: "large.txt", kind: "changed", revision, metadata: { size: 10 } });
  watches.unsubscribe(live.subscriptionId);
  const reconnect = watches.subscribe({ clientId: "client-a", projectId: "project-a", resource: "large.txt", afterSequence: 0 });
  const resync = await watches.read(reconnect.subscriptionId);
  assert.equal(resync.events[0].kind, "resync");
  assert.equal(resync.resyncRequired, true);

  const fresh = await fixture.service.readRange("large.txt", 0, 4);
  assert.equal(decode(fresh), "abcd");
  assert.equal(fresh.offset, 0);
  assert.equal(fresh.totalSize, 10);
});
