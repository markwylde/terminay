import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

test('the session-owned browser transport mounts the opaque workspace client', async () => {
	const [entry, manager, transport] = await Promise.all([
		readFile('src/remote/main.tsx', 'utf8'),
		readFile('src/web/main.tsx', 'utf8'),
		readFile('src/web/sessionTransportHost.ts', 'utf8'),
	]);
	assert.match(entry, /mountSessionWorkspace\(root\)/u);
	assert.doesNotMatch(entry, /authenticateDevice|loadBrowserDeviceIdentity|apiChannel|terminalChannel|createDataChannel|getChannel|RTCDataChannel/u);
	assert.match(manager, /new TerminayClient/u);
	assert.match(manager, /createConnectedServerClientContext/u);
	assert.doesNotMatch(manager, /legacyRemote|session-list|session-opened|attach-session/u);
	assert.match(transport, /ByteTransport/u);
	assert.match(transport, /connect\(options/u);
	assert.doesNotMatch(transport, /RTCDataChannel|getChannel/u);
});

test('secure-Werift proof contains no test-only canonical bridge installer', async () => {
	await assert.rejects(access('e2e/webrtc-headless-node-host.spec.ts'));
	const runtime = await readFile('scripts/support/webRtcHostRuntime.ts', 'utf8');
	for (const token of [
		/RTCPeerConnection\.prototype/u,
		/canonicalChannels/u,
		/onApplicationChannel/u,
		/HeadlessChannelTransport/u,
		/__TERMINAY_REMOTE_WEBRTC__\s*=/u,
	]) assert.doesNotMatch(runtime, token);
});

test('terminal-only browser protocol and socket sources are removed', async () => {
	await assert.rejects(access('src/remote/protocol.ts'));
	await assert.rejects(access('src/remote/services/socket.ts'));
});
