import test from "node:test";
import assert from "node:assert/strict";
import { createEmbeddedServer, createStandaloneServer } from "../dist/index.js";

test("the same runtime composition supports standalone and embedded modes", async () => {
  const standalone = createStandaloneServer({ serverId: "server-a", serverVersion: "1.0.0", dataRoot: "/tmp/a" });
  const embedded = createEmbeddedServer({ serverId: "server-b", serverVersion: "1.0.0", dataRoot: "/tmp/b" });
  assert.equal(standalone.config.runtimeMode, "standalone");
  assert.equal(embedded.config.runtimeMode, "embedded");
  assert.equal((await standalone.start()).ready, true);
  await standalone.stop();
});
