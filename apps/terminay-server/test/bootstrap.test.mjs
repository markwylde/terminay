import assert from "node:assert/strict";
import test from "node:test";
import { createEmbeddedBootstrap } from "../dist/index.js";

test("embedded bootstrap claims one data root, chooses a private endpoint, and publishes a short-lived credential", async () => {
  const calls = [];
  let claimCount = 0;
  const bootstrap = createEmbeddedBootstrap({
    serverId: "local-server",
    serverVersion: "1.0.0",
    dataRoot: "/private/local",
    allocator: {
      choose: () => ({ origin: "http://127.0.0.1:4317", endpoint: "loopback:4317" }),
      claim: (candidate) => calls.push(["claim", candidate.endpoint]),
      release: (candidate) => calls.push(["release", candidate.endpoint]),
    },
    dataRootLease: {
      acquire: () => { claimCount += 1; },
      release: () => { claimCount -= 1; },
    },
    publishReady: (ready) => calls.push(["ready", ready.serverId, ready.endpoint]),
  });
  const ready = await bootstrap.start();
  assert.equal(bootstrap.phase, "ready");
  assert.equal(ready.serverId, "local-server");
  assert.match(ready.bootstrapCredential, /^[A-Za-z0-9_-]{32,}$/);
  assert.equal(ready.credentialDigest.length, 64);
  assert.equal(claimCount, 1);
  const again = await bootstrap.start();
  assert.equal(again.bootstrapCredential, ready.bootstrapCredential);
  assert.equal(calls.filter((entry) => entry[0] === "claim").length, 1);
  await bootstrap.stop();
  assert.equal(claimCount, 0);
  assert.deepEqual(calls.map((entry) => entry[0]), ["claim", "ready", "release"]);
  const recovered = await bootstrap.start();
  assert.equal(bootstrap.phase, "ready");
  assert.notEqual(recovered.bootstrapCredential, ready.bootstrapCredential);
  assert.equal(claimCount, 1);
  await bootstrap.stop();
});

test("embedded bootstrap releases the lease when startup fails", async () => {
  let acquired = 0;
  let released = 0;
  const bootstrap = createEmbeddedBootstrap({
    serverId: "local-server",
    serverVersion: "1.0.0",
    dataRoot: "/private/local",
    allocator: {
      choose: () => ({ origin: "http://127.0.0.1:4318", endpoint: "loopback:4318" }),
      claim: () => { throw new Error("endpoint busy"); },
      release: () => undefined,
    },
    dataRootLease: { acquire: () => { acquired += 1; }, release: () => { released += 1; } },
  });
  await assert.rejects(bootstrap.start(), /endpoint busy/);
  assert.equal(bootstrap.phase, "failed");
  assert.equal(acquired, 1);
  assert.equal(released, 1);
});
