import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(join(tmpdir(), 'terminay-connection-intent-'));
const output = join(directory, 'desktopConnectionIntent.mjs');
await build({
	bundle: true,
	entryPoints: ['electron/remote/desktopConnectionIntent.ts'],
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
});
const { resolveDesktopConnectionIntent } = await import(
	pathToFileURL(output).href
);
test.after(async () => rm(directory, { force: true, recursive: true }));

test('Desktop selects direct application handoff only when no pairing PIN field is present', () => {
	assert.deepEqual(resolveDesktopConnectionIntent(undefined), {
		kind: 'application-handoff',
	});
	for (const value of ['', '   ', '12345', '1234567', '12 3456']) {
		assert.throws(
			() => resolveDesktopConnectionIntent(value),
			/six-digit Remote Access pairing PIN/u,
		);
	}
});

test('Desktop normalizes an explicit six-digit pairing intent without exposing another branch', () => {
	assert.deepEqual(resolveDesktopConnectionIntent(' 123456 '), {
		kind: 'device-pairing',
		pairingPin: '123456',
	});
});

test('Desktop enrolls application-token handoff before remembering it as switchable', async () => {
	const main = await readFile(
		new URL('../electron/main.ts', import.meta.url),
		'utf8',
	);
	const connectStart = main.indexOf('async function connectRemoteServer(');
	const connectEnd = main.indexOf(
		'async function connectRemoteByteTransport(',
		connectStart,
	);
	assert.ok(connectStart >= 0 && connectEnd > connectStart);
	const connect = main.slice(connectStart, connectEnd);
	const intentStart = connect.indexOf(
		'const intent = resolveDesktopConnectionIntent(pairingPin);',
	);
	const pairingStart = connect.indexOf(
		"if (intent.kind === 'device-pairing') {",
		intentStart,
	);
	const pairingReturn = connect.indexOf('\n\t\treturn;', pairingStart);
	const handoffStart = connect.indexOf(
		'const { bootstrap, transport: remoteTransport } =',
		pairingReturn,
	);
	const enrollStart = connect.indexOf(
		'await enrollDesktopReconnectCredential({',
		handoffStart,
	);
	const rememberStart = connect.indexOf(
		'const profile = rememberRemoteConnection(',
		enrollStart,
	);

	assert.ok(
		intentStart >= 0,
		'Desktop must resolve the explicit connection intent',
	);
	assert.ok(
		pairingStart > intentStart,
		'device persistence must be pairing-only',
	);
	assert.ok(
		pairingReturn > pairingStart,
		'device pairing must return before application handoff',
	);
	assert.ok(
		handoffStart > pairingReturn,
		'application-token handoff must be a separate branch',
	);
	assert.ok(
		enrollStart > handoffStart,
		'application-token handoff must enroll reconnect credentials',
	);
	assert.ok(
		rememberStart > enrollStart,
		'Desktop must remember the profile only after reconnect enrollment',
	);
	assert.match(
		connect.slice(pairingStart, pairingReturn),
		/createDesktopDeviceCredentialStore/u,
	);
	assert.match(
		connect.slice(pairingStart, pairingReturn),
		/createDesktopReconnectTransport/u,
	);
	assert.match(
		connect.slice(handoffStart),
		/enrollDesktopReconnectCredential/u,
	);
	assert.match(connect.slice(handoffStart), /bootstrap\.authToken/u);
	assert.match(connect.slice(handoffStart), /bootstrap\.origin/u);
	assert.match(connect.slice(handoffStart), /'device'/u);
});

test('Desktop safeStorage backend probing is compatible with Electron builds that omit the API', async () => {
	const main = await readFile(
		new URL('../electron/main.ts', import.meta.url),
		'utf8',
	);
	assert.match(main, /function selectedSafeStorageBackend\(\)/u);
	assert.match(
		main,
		/typeof backend === 'function' \? backend\.call\(safeStorage\) : undefined/u,
	);
	assert.match(main, /backend: selectedSafeStorageBackend/u);
});
