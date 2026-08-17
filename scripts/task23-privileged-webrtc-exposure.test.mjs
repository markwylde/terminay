import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Desktop WebRTC exposure uses the server-owned hosted pairing host', async () => {
	const [host, exposure, main] = await Promise.all([
		readFile('apps/terminay-server/src/remote/hostedPairingHost.ts', 'utf8'),
		readFile('electron/remote/serverOwnedExposure.ts', 'utf8'),
		readFile('electron/main.ts', 'utf8'),
	]);
	assert.match(host, /createDeviceHostReadyMessage/u);
	assert.match(host, /device-host-registered/u);
	assert.match(host, /acceptApplication/u);
	assert.match(exposure, /startHostedPairingHost/u);
	assert.match(exposure, /loadOrCreateHostedHostKey|hostKey/u);
	assert.match(main, /new DesktopServerOwnedExposure/u);
	assert.match(main, /startHostedPairingHost|DesktopServerOwnedExposure/u);
	assert.match(main, /remote-host-key\.v1\.json/u);
	assert.doesNotMatch(
		exposure,
		/sessionOrigin === undefined \? 'Remote Access session origin is unavailable.'/u,
	);
	assert.doesNotMatch(main, /PrivilegedWebRtcExposure/u);
	assert.doesNotMatch(main, /createHostedSignalingRoomRegistrar/u);
	assert.doesNotMatch(exposure, /createHostedSignalingRoomRegistrar/u);
});
