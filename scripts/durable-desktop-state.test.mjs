import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

// Desktop's state files after a power loss (ADR-0088): each loader is driven
// with the file zero-filled at its original length. A canonical store either
// restores `.previous` or throws StateUnreadableError naming the store, and
// never returns defaults on its own. A secret store fails closed. One bundle,
// so every module shares the helper's notice queue.

const directory = await mkdtemp(join(tmpdir(), 'terminay-durable-desktop-'));
const output = join(directory, 'durableDesktopState.mjs');
await build({
	bundle: true,
	stdin: {
		contents: `
			export * from './packages/server-core/src/durableFile.ts';
			export * from './electron/desktopStateFiles.ts';
			export * from './electron/desktopInstanceIdentity.ts';
			export * from './electron/desktopWindowComposition.ts';
			export * from './electron/diagnostics/preferences.ts';
			export * from './electron/stateFileRegistry.ts';
			export { FileSafeStorageVaultRepository, ElectronSafeStorageVaultAdapter } from './electron/vault/safeStorageVault.ts';
			export { DesktopDeviceCredentialStore } from './electron/remote/deviceCredentialStore.ts';
		`,
		loader: 'ts',
		resolveDir: resolve('.'),
		sourcefile: 'durable-desktop-state-entry.ts',
	},
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
});
const state = await import(pathToFileURL(output).href);
test.after(() => rm(directory, { force: true, recursive: true }));

let rootCounter = 0;
async function freshRoot() {
	rootCounter += 1;
	const root = join(directory, `root-${rootCounter}`);
	await mkdir(root, { recursive: true });
	state.takeStateRecoveryNotices();
	return root;
}

async function zeroFill(file, length = 64) {
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, Buffer.alloc(length));
}

async function corruptCopies(file) {
	const prefix = `${file.split('/').pop()}.corrupt-`;
	return (await readdir(dirname(file))).filter((name) =>
		name.startsWith(prefix),
	);
}

/** Each canonical Desktop store: its file, a loader, and a valid saved body. */
const canonicalStores = [
	{
		store: 'server-settings',
		file: 'server-settings.v1.json',
		saved: { schemaVersion: 1, revision: 4, settings: { fontSize: 15 } },
		load: (file, migrate) => state.loadDesktopServerSettings(file, migrate),
		write: (file, value) => state.commitDesktopServerSettings(file, value),
	},
	{
		store: 'macros',
		file: 'server-macros.v1.json',
		saved: { schemaVersion: 2, revision: 1, macros: [] },
		load: (file, migrate) => state.loadDesktopMacros(file, migrate),
		write: (file, value) => state.commitDesktopMacros(file, value),
	},
	{
		store: 'device-settings',
		file: 'terminal-settings.json',
		saved: { fontSize: 17 },
		load: async (file) => state.readDeviceSettingsFile(file),
		write: async (file, value) => state.writeDeviceSettingsFile(file, value),
	},
	{
		store: 'remote-access-settings',
		file: 'remote-access-settings.json',
		saved: { exposeOnStartup: true },
		load: async (file) => state.readRemoteAccessSettingsFile(file),
		write: async (file, value) =>
			state.writeRemoteAccessSettingsFile(file, value),
	},
	{
		store: 'connection-profiles',
		file: 'connection-profiles.json',
		saved: [
			{
				id: 'p1',
				kind: 'device',
				label: 'Server',
				origin: 'https://s.example',
			},
		],
		load: async (file) => state.readConnectionProfilesFile(file),
		write: async (file, value) =>
			state.writeConnectionProfilesFile(file, value),
	},
];

for (const store of canonicalStores) {
	test(`${store.store}: a zero-filled file restores its .previous copy with a notice`, async () => {
		const file = join(await freshRoot(), store.file);
		await store.write(file, store.saved);
		await store.write(file, store.saved);
		assert.deepEqual(
			JSON.parse(await readFile(`${file}.previous`, 'utf8')),
			store.saved,
			'a canonical save keeps the prior content as .previous',
		);
		await zeroFill(file);
		let migrated = false;
		const loaded = await store.load(file, () => {
			migrated = true;
			return 'defaults';
		});
		assert.deepEqual(loaded, store.saved);
		assert.equal(migrated, false, 'a corrupt file is never migrated over');
		assert.deepEqual(state.takeStateRecoveryNotices(), [
			{ kind: 'restored', store: store.store },
		]);
		assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), store.saved);
		assert.equal((await corruptCopies(file)).length, 1);
	});

	test(`${store.store}: a zero-filled file with no good copy throws state_unreadable and is left untouched`, async () => {
		const file = join(await freshRoot(), store.file);
		await zeroFill(file, 97);
		await zeroFill(`${file}.previous`, 31);
		let migrated = false;
		await assert.rejects(
			Promise.resolve().then(() =>
				store.load(file, () => {
					migrated = true;
					return 'defaults';
				}),
			),
			(error) => {
				assert.equal(state.isStateUnreadableError(error), true);
				assert.equal(error.code, 'state_unreadable');
				assert.equal(error.store, store.store);
				assert.doesNotMatch(error.message, /[\\/]/u, 'no path in the error');
				return true;
			},
		);
		assert.equal(migrated, false, 'defaults never stand in for saved state');
		assert.deepEqual(await readFile(file), Buffer.alloc(97));
		assert.deepEqual(await readFile(`${file}.previous`), Buffer.alloc(31));
		assert.deepEqual(await corruptCopies(file), []);
	});

	test(`${store.store}: a missing file is first run, not an error`, async () => {
		const file = join(await freshRoot(), store.file);
		const loaded = await store.load(file, () => 'first-run');
		assert.ok(loaded === 'first-run' || loaded === undefined);
		assert.deepEqual(state.takeStateRecoveryNotices(), []);
	});
}

test('server-settings and macros: invalid JSON shape is corrupt, not defaults', async () => {
	const root = await freshRoot();
	for (const [file, load] of [
		['server-settings.v1.json', state.loadDesktopServerSettings],
		['server-macros.v1.json', state.loadDesktopMacros],
	]) {
		await writeFile(join(root, file), '"just a string"');
		await assert.rejects(
			load(join(root, file), () => ({})),
			/could not read/u,
		);
		await writeFile(join(root, file), '{"truncat');
		await assert.rejects(
			load(join(root, file), () => ({})),
			/could not read/u,
		);
	}
});

test('window-layout: a zero-filled composition restores .previous, or throws', async () => {
	const root = await freshRoot();
	const file = join(root, 'window-composition.v1.json');
	await writeFile(
		`${file}.previous`,
		JSON.stringify({ schemaVersion: 1, windows: {} }),
	);
	await zeroFill(file);
	const restored = new state.DesktopWindowCompositionStore(file);
	restored.load();
	assert.equal(restored.read('local:primary'), undefined);
	assert.deepEqual(state.takeStateRecoveryNotices(), [
		{ kind: 'restored', store: 'window-layout' },
	]);

	const other = join(await freshRoot(), 'window-composition.v1.json');
	await zeroFill(other);
	const unreadable = new state.DesktopWindowCompositionStore(other);
	assert.throws(
		() => unreadable.read('local:primary'),
		(error) => error.store === 'window-layout',
	);
	assert.throws(
		() => unreadable.load(),
		(error) => error.store === 'window-layout',
		'a store that failed to load stays unloaded and never overwrites the file',
	);
	assert.deepEqual(await readFile(other), Buffer.alloc(64));
});

test('desktop-identity: first creation keeps a .previous copy and a zero-filled id restores it', async () => {
	const root = await freshRoot();
	const first = state.resolveDesktopInstanceIdentity(root);
	const file = join(root, state.DESKTOP_INSTANCE_ID_FILE);
	assert.deepEqual(
		await readFile(`${file}.previous`),
		await readFile(file),
		'the id is written once, so its copy is made with it',
	);
	await zeroFill(file, (await stat(file)).size);
	const again = state.resolveDesktopInstanceIdentity(root);
	assert.equal(again.id, first.id, 'a lost id must not orphan the data root');
	assert.deepEqual(state.takeStateRecoveryNotices(), [
		{ kind: 'restored', store: 'desktop-identity' },
	]);
});

test('desktop-identity: a zero-filled id with no good copy throws and is never replaced', async () => {
	const root = await freshRoot();
	const file = join(root, state.DESKTOP_INSTANCE_ID_FILE);
	await zeroFill(file, 70);
	assert.throws(
		() => state.resolveDesktopInstanceIdentity(root),
		(error) => error.store === 'desktop-identity',
	);
	assert.deepEqual(await readFile(file), Buffer.alloc(70));
	assert.equal(existsSync(`${file}.previous`), false);
});

test('remote-devices: a zero-filled or unacceptable list admits nobody and does not throw', async () => {
	const root = await freshRoot();
	const file = join(root, 'remote-devices.v1.json');
	await zeroFill(file);
	await writeFile(`${file}.previous`, JSON.stringify([{ deviceId: 'old' }]));
	assert.deepEqual(
		state.loadRemoteDeviceList(file, () => undefined),
		[],
	);
	assert.deepEqual(state.takeStateRecoveryNotices(), [
		{ kind: 'secret-reset', store: 'remote-devices' },
	]);
	assert.equal((await corruptCopies(file)).length, 1);

	await writeFile(file, JSON.stringify([{ deviceId: 'revoked?' }]));
	assert.deepEqual(
		state.loadRemoteDeviceList(file, () => {
			throw new TypeError('persisted remote device is invalid');
		}),
		[],
	);
	await rm(`${file}.previous`);
	state.saveRemoteDeviceList(file, []);
	state.saveRemoteDeviceList(file, []);
	assert.equal(existsSync(`${file}.previous`), false, 'never a rollback copy');
});

test('vault: a zero-filled envelope opens an empty vault and never reads an older one', async () => {
	const root = await freshRoot();
	const file = join(root, 'vault', 'safe-storage.v1.json');
	const codec = {
		backend: () => 'keychain',
		isAvailable: () => true,
		encrypt: (value) => Buffer.from(value, 'utf8'),
		decrypt: (value) => value.toString('utf8'),
	};
	const good = await state.ElectronSafeStorageVaultAdapter.open({
		repository: new state.FileSafeStorageVaultRepository(file),
		codec,
	});
	await good.unlock({ secret: new Uint8Array() });
	await good.put({ id: 'test.secret', value: new Uint8Array([1, 2, 3]) });
	await writeFile(`${file}.previous`, await readFile(file));
	await zeroFill(file, (await stat(file)).size);
	const reopened = await state.ElectronSafeStorageVaultAdapter.open({
		repository: new state.FileSafeStorageVaultRepository(file),
		codec,
	});
	assert.deepEqual(reopened.list(), []);
	assert.deepEqual(state.takeStateRecoveryNotices(), [
		{ kind: 'secret-reset', store: 'vault' },
	]);
	assert.equal((await corruptCopies(file)).length, 1);
});

test('device credential: a zero-filled record reads as unpaired', async () => {
	const root = await freshRoot();
	const credentials = join(root, 'remote-device-credentials');
	const store = new state.DesktopDeviceCredentialStore({
		directory: credentials,
		codec: {
			isAvailable: () => true,
			encrypt: (value) => Buffer.from(value, 'utf8'),
			decrypt: (value) => value.toString('utf8'),
		},
	});
	const key = store.createDeviceKey('https://server.example');
	await store.saveDeviceIdentity({
		origin: 'https://server.example',
		deviceId: 'device-a',
		deviceName: 'Desktop',
		privateKey: key.keyRef,
	});
	const [record] = await readdir(credentials);
	await zeroFill(join(credentials, record));
	assert.equal(await store.loadDevice('https://server.example'), null);
	assert.deepEqual(state.takeStateRecoveryNotices(), [
		{ kind: 'secret-reset', store: 'remote-device-credential' },
	]);
});

test('mcp-capabilities, window-server and diagnostics preferences never throw on zeros', async () => {
	const root = await freshRoot();
	const digests = join(root, 'mcp-capabilities.v1.json');
	await zeroFill(digests);
	assert.equal(state.loadMcpCapabilityDigests(digests), undefined);
	const windowServer = join(root, 'window-server.v1.json');
	await zeroFill(windowServer);
	assert.equal(state.readWindowServerMemory(windowServer), undefined);
	await zeroFill(join(root, 'diagnostics-preferences.v1.json'));
	assert.equal(
		state.readDiagnosticsPreferences(root).performanceLogging,
		false,
	);
	for (const file of [
		digests,
		windowServer,
		join(root, 'diagnostics-preferences.v1.json'),
	])
		assert.equal((await corruptCopies(file)).length, 1, file);
	state.writeWindowServerMemory(windowServer, 'local:abc');
	assert.equal(state.readWindowServerMemory(windowServer), 'local:abc');
});

test('the registry names every canonical store once per file, with a kind', () => {
	const files = state.DESKTOP_STATE_FILES;
	assert.equal(new Set(files.map((entry) => entry.file)).size, files.length);
	for (const entry of files) {
		assert.ok(['canonical', 'secret', 'rebuildable'].includes(entry.kind));
		assert.equal(
			entry.store !== undefined,
			entry.kind === 'canonical',
			`${entry.file}: a store name exactly when canonical`,
		);
		assert.doesNotMatch(entry.file, /^[\\/]|\.\./u);
	}
	const stores = new Set(files.map((entry) => entry.store).filter(Boolean));
	for (const store of [
		'workspace',
		'desktop-identity',
		'server-settings',
		'device-settings',
		'remote-access-settings',
		'macros',
		'automations',
		'connected-servers',
		'connection-profiles',
		'window-layout',
		'extensions',
	])
		assert.ok(stores.has(store), `registry lists ${store}`);
	for (const store of canonicalStores)
		assert.ok(
			files.some((entry) => entry.file === store.file),
			`registry lists ${store.file}`,
		);
});
