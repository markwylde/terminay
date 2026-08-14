import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const globals = await readFile(
	new URL('../src/vite-env.d.ts', import.meta.url),
	'utf8',
);

const APPROVED_NATIVE_HOST_METHODS = Object.freeze({});

test('native presentation hosts expose only their reviewed version-one operations', () => {
	for (const [host, approvedMethods] of Object.entries(
		APPROVED_NATIVE_HOST_METHODS,
	)) {
		const body = interfaceBody(globals, host);
		assert.match(body, /readonly version: 1;/u, host);
		const methods = [
			...body.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)(?:\([^;]*|\s*:)\s*/gmu),
		]
			.map((match) => match[1])
			.filter((name) => name !== 'readonly' && name !== 'version')
			.sort();
		assert.deepEqual([...new Set(methods)], [...approvedMethods].sort(), host);
	}
});

test('window close uses the canonical route action without an ambient lifecycle host', async () => {
	const actions = await readFile(
		new URL('../src/host/nativeActions.ts', import.meta.url),
		'utf8',
	);
	assert.doesNotMatch(globals, /terminayWindowLifecycleHost/u);
	assert.match(actions, /request\(\{ type: 'route\.close' \}\)/u);
});

test('migrated ambient native globals stay absent', () => {
	for (const name of [
		'terminayClipboardHost',
		'terminayExternalHost',
		'terminayTerminalPresentationHost',
		'terminayRevealHost',
		'terminayWindowLifecycleHost',
	]) {
		assert.doesNotMatch(globals, new RegExp(name, 'u'));
	}
});

function interfaceBody(source, host) {
	const marker = `${host}?: {`;
	const start = source.indexOf(marker);
	assert.notEqual(start, -1, `${host} declaration`);
	let depth = 0;
	for (
		let index = start + marker.length - 1;
		index < source.length;
		index += 1
	) {
		if (source[index] === '{') depth += 1;
		if (source[index] !== '}') continue;
		depth -= 1;
		if (depth === 0) return source.slice(start, index + 1);
	}
	throw new Error(`${host} declaration is unterminated`);
}

