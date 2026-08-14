import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('native commands use the canonical bound host-event protocol only', async () => {
	const [app, legacyPreload, canonicalPreload, declarations, protocol] =
		await Promise.all([
			readFile(new URL('src/App.tsx', root), 'utf8'),
			readFile(new URL('electron/preload.ts', root), 'utf8'),
			readFile(new URL('electron/serverUiPreload.ts', root), 'utf8'),
			readFile(new URL('src/vite-env.d.ts', root), 'utf8'),
			readFile(new URL('packages/protocol/src/host.ts', root), 'utf8'),
		]);

	assert.match(app, /subscribeAppCommands\?\.\(/u);
	assert.doesNotMatch(app, /window\.terminayAppCommandHost/u);
	assert.doesNotMatch(legacyPreload, /terminayAppCommandHost/u);
	assert.doesNotMatch(declarations, /terminayAppCommandHost/u);
	assert.match(canonicalPreload, /subscribeEvent:/u);
	assert.match(canonicalPreload, /parseTerminayHostEvent/u);
	assert.match(protocol, /export type TerminayHostEvent/u);
	assert.match(protocol, /type: "menu\.command"/u);
});
