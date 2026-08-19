import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('hosted reconnect registration is owned by the shared pairing host', async () => {
	const [host, secrets, desktop] = await Promise.all([
		readFile('apps/terminay-server/src/remote/hostedPairingHost.ts', 'utf8'),
		readFile('apps/terminay-server/src/remote/hostedPairingSecrets.ts', 'utf8'),
		readFile('electron/remote/serverOwnedExposure.ts', 'utf8'),
	]);
	assert.match(secrets, /terminay remote v1 pairing room/u);
	assert.match(host, /type: 'host-ready'/u);
	assert.match(host, /createDeviceHostReadyMessage/u);
	assert.match(desktop, /startHostedPairingHost/u);
	assert.match(desktop, /createPairingLink/u);
	assert.doesNotMatch(desktop, /createHostedSignalingRoomRegistrar/u);
});
