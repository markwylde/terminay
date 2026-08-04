import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('browser PIN enrollment uses the authoritative pairing transaction', async () => {
	const source = (
		await Promise.all(
			[
				'../src/web/main.tsx',
				'../src/web/deviceEnrollment.ts',
				'../src/remote/main.tsx',
			].map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
		)
	).join('\n');
	assert.match(source, /establishDevicePairing/u);
	assert.match(source, /createRemoteTransportRuntime/u);
	assert.match(source, /parsePairingBootstrap/u);
	assert.match(source, /generateDeviceKeyPair/u);
	assert.match(source, /saveEstablishedPairing/u);
	assert.doesNotMatch(
		source,
		/localStorage\.(?:setItem|getItem)\([^)]*(?:pairingPin|pairingToken)/u,
	);
	for (const path of [
		'../src/web/main.tsx',
		'../src/web/deviceEnrollment.ts',
	]) {
		const webSource = await readFile(new URL(path, import.meta.url), 'utf8');
		assert.doesNotMatch(webSource, /from ['"]\.\.\/remote\/services\//u);
	}
});
