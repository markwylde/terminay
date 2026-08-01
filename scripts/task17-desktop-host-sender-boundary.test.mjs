import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Desktop exposes no hidden WebRTC host sender or IPC capability', async () => {
	const [main, preload] = await Promise.all([
		readFile('electron/main.ts', 'utf8'),
		readFile('electron/preload.ts', 'utf8'),
	]);
	for (const source of [main, preload]) {
		assert.doesNotMatch(
			source,
			/remote-webrtc-host|assertTrustedWebRtcHostSender|desktopHostSenders|terminayWebRtcHost/u,
		);
	}
});
