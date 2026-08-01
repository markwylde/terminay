import assert from "node:assert/strict";
import test from "node:test";
import {
	RemoteConnectionManager,
	RemoteExposureController,
	RemotePairingStore,
	ServerRuntime,
} from "../dist/index.js";

test("server runtime owns remote exposure diagnostics and shutdown without exposing secrets", async () => {
	const now = 100;
	const manager = new RemoteConnectionManager({
		serverId: "server-a",
		sessionOrigin: "https://session.example.test",
		now: () => now,
	});
	const pairing = new RemotePairingStore({
		serverId: "server-a",
		sessionOrigin: "https://session.example.test",
		now: () => now,
	});
	const exposure = new RemoteExposureController({ manager, pairing, now: () => now });
	const runtime = new ServerRuntime({
		serverId: "server-a",
		serverVersion: "1.0.0",
		dataRoot: "/tmp/terminay-runtime-remote",
		runtimeMode: "standalone",
		services: { remoteExposure: exposure },
	});

	await runtime.start();
	const handoff = exposure.start(500);
	const status = runtime.diagnostics();
	assert.equal(status.remoteExposure.state, "exposed");
	assert.equal(status.remoteExposure.roomId, manager.exposure.roomId);
	assert.equal(status.remoteExposure.connectedPeers, 0);
	assert.equal(JSON.stringify(status).includes(handoff.secret), false);
	await runtime.stop();
	assert.deepEqual(manager.exposure, { state: "disabled" });
	assert.equal(exposure.status.peers.length, 0);
	void now;
});
