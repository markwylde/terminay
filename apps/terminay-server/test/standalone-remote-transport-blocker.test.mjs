import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServerRemoteExposure } from "../dist/index.js";

test("standalone pairing is not reported as a live transport endpoint", async () => {
  const exposure = createServerRemoteExposure({
    serverId: "docker-server",
    sessionOrigin: "https://docker-server.example.test",
    cleanupIntervalMs: 0,
  });

  try {
    const handoff = exposure.start(Date.now() + 60_000);
    const pairingUrl = new URL(handoff.pairingUrl);

    assert.equal(pairingUrl.origin, "https://docker-server.example.test");
    const bootstrap = new URLSearchParams(pairingUrl.hash.slice(1));
    assert.equal(bootstrap.get("pairingSessionId"), handoff.pairingSessionId);
    assert.equal(bootstrap.get("pairingToken"), handoff.pairingToken);
    assert.equal(bootstrap.get("pairingExpiresAt"), handoff.pairingExpiresAt);
    assert.equal(Object.hasOwn(handoff, "pairingSessionId"), true);
    assert.equal(Object.hasOwn(handoff, "pairingToken"), true);
    // Pairing material is not a transport. The exposure controller owns
    // admission only; establishing a peer is the hosted pairing host's job.
    assert.equal("nodeDataChannelHost" in exposure, false);
    assert.equal("connectHeadless" in exposure, false);
  } finally {
    await exposure.shutdown();
  }
});

test("standalone CLI delegates framed stream ownership to LocalUiServer without owning signaling", async () => {
	const cli = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8");
	const exposure = await readFile(new URL("../src/remote/serverExposure.ts", import.meta.url), "utf8");

	assert.match(cli, /createLocalUiServer/u);
	assert.match(cli, /protocolCore:\s*composition\.core/u);
	assert.doesNotMatch(cli, /WebSocketServer/u);
  // The selected WebRTC runtime is the verified Secure-Werift artifact. The
  // blocked node-datachannel host implementation is gone, not merely unused.
  assert.doesNotMatch(exposure, /NodeDataChannel|connectHeadless/u);
});
