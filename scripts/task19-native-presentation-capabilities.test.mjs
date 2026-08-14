import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const globals = await readFile(
	new URL('../src/vite-env.d.ts', import.meta.url),
	'utf8',
);

const APPROVED_NATIVE_HOST_METHODS = Object.freeze({
	terminayAppCommandHost: ['subscribe'],
	terminayClipboardHost: ['readText', 'subscribeCopyRequest', 'writeText'],
	terminayExternalHost: ['open'],
	terminayProjectTabHost: [
		'endDrag',
		'publishBarRect',
		'startDrag',
		'subscribeDragHover',
		'subscribeTornOff',
	],
	terminayRevealHost: ['reveal'],
	terminayTerminalPresentationHost: [
		'getZoom',
		'subscribeRemoteSizeOverride',
		'subscribeZoom',
		'updateMetadata',
	],
	terminayWindowLifecycleHost: [
		'closeCurrent',
		'confirmClose',
		'publishRunningTerminalSessions',
	],
	terminayWorkspaceTransferHost: [
		'bindView',
		'getAdoptedProject',
		'mergeProject',
		'popoutProject',
		'subscribeAdoptedProject',
	],
});

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
