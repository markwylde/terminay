import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

test('browser enrollment uses the canonical four-channel application transport', async () => {
	const [entry, manager, transport] = await Promise.all([
		readFile('src/remote/main.tsx', 'utf8'),
		readFile('src/web/main.tsx', 'utf8'),
		readFile('src/web/browserWebRtcTransport.ts', 'utf8'),
	]);
	assert.match(entry, /createBrowserWebRtcTransport/u);
	assert.match(entry, /authenticated\.ticket/u);
	assert.match(
		entry,
		/bridge\?\.getChannel === undefined[\s\S]*canonical WebRTC application transport is unavailable/u,
	);
	assert.doesNotMatch(entry, /apiChannel|terminalChannel|createDataChannel/u);
	assert.match(manager, /new TerminayClient/u);
	assert.match(manager, /createConnectedServerClientContext/u);
	assert.doesNotMatch(manager, /legacyRemote|session-list|session-opened|attach-session/u);
	for (const lane of ['control', 'application', 'terminal', 'assets']) {
		assert.match(transport, new RegExp(`['"]${lane}['"]`, 'u'));
	}
	assert.match(transport, /ByteTransport/u);
	assert.match(transport, /binaryType = 'arraybuffer'/u);
	assert.match(transport, /channel\.label !== name/u);
	assert.match(transport, /identities\.has\(channel\)/u);
});

test('secure-Werift proof contains no test-only canonical bridge installer', async () => {
	const [proof, legacyHarness] = await Promise.all([
		readFile('e2e/webrtc-headless-node-host.spec.ts', 'utf8'),
		readFile('scripts/support/webRtcHostRuntime.ts', 'utf8'),
	]);
	for (const source of [proof, legacyHarness]) {
		assert.doesNotMatch(source, /RTCPeerConnection\.prototype/u);
		assert.doesNotMatch(source, /canonicalChannels/u);
		assert.doesNotMatch(source, /onApplicationChannel/u);
		assert.doesNotMatch(source, /ServerConnection/u);
		assert.doesNotMatch(source, /HeadlessChannelTransport/u);
	}
	assert.doesNotMatch(proof, /__TERMINAY_REMOTE_WEBRTC__\s*=/u);
	assert.doesNotMatch(proof, /defineProperty\([^)]*__TERMINAY_REMOTE_WEBRTC__/u);
});

test('terminal-only browser protocol and socket sources are removed', async () => {
	await assert.rejects(access('src/remote/protocol.ts'));
	await assert.rejects(access('src/remote/services/socket.ts'));
});
