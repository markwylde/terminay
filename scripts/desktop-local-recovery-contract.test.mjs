import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Desktop replaces a failed Local byte-transport generation', async () => {
	const source = await readFile('src/web/main.tsx', 'utf8');
	assert.match(
		source,
		/const \[desktopConnectionGeneration, setDesktopConnectionGeneration\][\s\S]*setDesktopConnectionGeneration\(\(generation\) => generation \+ 1\)[\s\S]*\[hasDesktopServerBootstrap, desktopConnectionGeneration\]/u,
		'Desktop transport failure must acquire a fresh byte-transport generation',
	);
});

test('a replacement renderer client publishes its already-connected state', async () => {
	const source = await readFile('src/shared/rendererServerClient.ts', 'utf8');
	assert.match(
		source,
		/publishClientState\(client\.snapshot\);\s*const removeStateListener = client\.onStateChange/u,
		'a replacement that connected before listener registration must clear stale diagnostics',
	);
});
