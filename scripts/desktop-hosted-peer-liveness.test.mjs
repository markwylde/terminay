import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
	new URL('../electron/remote/desktopHostedConnection.ts', import.meta.url),
	'utf8',
);
const main = await readFile(
	new URL('../electron/main.ts', import.meta.url),
	'utf8',
);

test('Desktop keeps the hosted peer lifecycle active after setup resolves', () => {
	assert.match(source, /new HostedPeerLifecycle\(/u);
	assert.match(source, /lifecycle\?\.observe\('peer'\)/u);
	assert.match(source, /lifecycle\?\.observe\('ice'\)/u);
	assert.match(source, /lifecycle\?\.fail\(`WebRTC \$\{label\} lane/u);
	assert.match(source, /onConnectionFailure\?\.\(reason\)/u);
	assert.match(source, /selectedIceCandidatePair\(peer\)/u);
	assert.match(source, /onConnectionStatus\?\.\(status\)/u);
});

test('intentional close stops the lifecycle before closing the peer', () => {
	assert.match(
		source,
		/closed = true;\s*lifecycle\?\.stop\(\);[\s\S]*?peer\.close\(\)/u,
	);
});

test('Desktop records route-only candidate diagnostics and surfaces late connection loss', () => {
	assert.match(
		main,
		/onCandidatePair: \(pair\) =>\s*recordDesktopHostedPeerDiagnostic\('candidate-pair', pair\)/u,
	);
	assert.match(
		main,
		/onConnectionFailure: \(reason\) =>[\s\S]{0,160}recordDesktopHostedPeerDiagnostic\('connection-failed'/u,
	);
	assert.match(
		main,
		/type: 'connection\.pairing-progress'[\s\S]{0,600}pairingProgress\('connection-lost'\)/u,
	);
	assert.match(main, /remote\.hosted-peer\.\$\{type\}/u);
});
