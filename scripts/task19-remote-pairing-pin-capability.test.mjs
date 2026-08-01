import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

test('Task 19 pairing-PIN helper requires an explicitly injected client', async () => {
	const directory = await mkdtemp(
		path.join(os.tmpdir(), 'terminay-task19-pairing-pin-'),
	);
	try {
		const outfile = path.join(directory, 'helper.cjs');
		await build({
			bundle: true,
			entryPoints: ['src/remotePairingPin.ts'],
			format: 'cjs',
			logLevel: 'silent',
			outfile,
			platform: 'node',
		});
		const helper = require(outfile);
		const calls = [];
		const client = {
			getTerminalSettings: async () => ({
				remoteAccess: { pairingPinHash: ' hash ' },
			}),
			setRemoteAccessPairingPin: async (pin) => {
				calls.push(pin);
				return {};
			},
		};
		assert.equal(
			await helper.isRemoteAccessPairingPinConfigured(client, 'webrtc'),
			true,
		);
		await helper.saveRemoteAccessPairingPin(client, '123456');
		assert.deepEqual(calls, ['123456']);
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});

test('Task 19 removes the pairing-PIN renderer-global compatibility hand-off', async () => {
	const [helper, entry, app, controller, settings, preload, declarations] =
		await Promise.all([
			readFile('src/remotePairingPin.ts', 'utf8'),
			readFile('src/rendererApp.tsx', 'utf8'),
			readFile('src/App.tsx', 'utf8'),
			readFile('src/workspace/useRemoteAccessController.ts', 'utf8'),
			readFile('src/components/SettingsWindow.tsx', 'utf8'),
			readFile('electron/preload.ts', 'utf8'),
			readFile('src/vite-env.d.ts', 'utf8'),
		]);
	assert.doesNotMatch(helper, /window\.terminay/u);
	assert.doesNotMatch(entry, /RemotePairingPin/u);
	assert.match(
		controller,
		/useRemoteAccessController\(\s*pairingPinClient:\s*RemotePairingPinClient \| undefined,\s*statusClient:\s*RemoteAccessStatusClient \| undefined,\s*settingsClient:\s*TerminalSettingsClient/u,
	);
	assert.match(app, /useRemoteAccessController\(\s*window\.terminayRemotePairingPinHost,\s*window\.terminayRemoteAccessStatusHost,\s*legacySettingsClient,?\s*\)/u);
	assert.match(settings, /window\.terminayRemotePairingPinHost/u);
	assert.match(preload, /exposeInMainWorld\(\s*'terminayRemotePairingPinHost'/u);
	assert.match(declarations, /terminayRemotePairingPinHost:/u);
	for (const source of [preload, declarations]) {
		assert.doesNotMatch(source, /terminayRemotePairingPinCompatibilityHost/u);
	}
	await assert.rejects(
		access('src/services/remote/legacyRemotePairingPinCapability.ts'),
		(error) => error?.code === 'ENOENT',
	);
});
