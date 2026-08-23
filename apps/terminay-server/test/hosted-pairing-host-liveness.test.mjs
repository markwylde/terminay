import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the production hosted pairing host owns ICE servers, grace, and one handshake', async () => {
	const [host, lifecycle, exposure, main, cli] = await Promise.all([
		readFile(new URL('../src/remote/hostedPairingHost.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/remote/hostedPeerLifecycle.ts', import.meta.url), 'utf8'),
		readFile(
			new URL('../../../electron/remote/serverOwnedExposure.ts', import.meta.url),
			'utf8',
		),
		readFile(new URL('../../../electron/main.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/cli.ts', import.meta.url), 'utf8'),
	]);
	assert.match(lifecycle, /iceConnectionState/u);
	assert.match(lifecycle, /needsDisconnectGrace/u);
	assert.match(lifecycle, /DEFAULT_HOSTED_ICE_SERVERS/u);
	assert.match(lifecycle, /iceServers: \[\.\.\.resolveHostedIceServers/u);
	assert.doesNotMatch(host, /iceServers: \[\]/u);
	assert.match(host, /createHandshakeJoinQueue/u);
	assert.match(host, /new HostedPeerLifecycle/u);
	assert.match(host, /iceconnectionstatechange/u);
	assert.match(host, /handshakeGeneration/u);
	assert.match(host, /applyHandshakeSignal/u);
	assert.match(exposure, /resolveIceServers/u);
	assert.match(
		main,
		/parseHostedIceServers\(\s*readEmbeddedRemoteAccessSettings\(\)\.webRtcIceServers,?\s*\)/u,
	);
	assert.match(cli, /TERMINAY_WEBRTC_ICE_SERVERS/u);
	assert.match(cli, /parseHostedIceServers/u);
});
