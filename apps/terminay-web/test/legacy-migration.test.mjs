import assert from 'node:assert/strict';
import test from 'node:test';
import {
	consumeLegacyManagerMigration,
	LEGACY_MANAGER_HANDOFF_PREFIX,
	LEGACY_MANAGER_PENDING_ACK_KEY,
	LEGACY_MANAGER_PROFILE_STORAGE_KEY,
	LEGACY_WEB_MANAGER_ORIGIN,
	runLegacyManagerMigration,
	WEB_MANAGER_ORIGIN,
	WEB_PROFILE_STORAGE_KEY,
	WebConnectionHost,
} from '../dist/index.js';

function memoryStorage(entries = []) {
	const values = new Map(entries);
	return {
		getItem(key) {
			return values.get(key) ?? null;
		},
		setItem(key, value) {
			values.set(key, value);
		},
		removeItem(key) {
			values.delete(key);
		},
		values,
	};
}

function browser(origin, name = '') {
	const navigations = [];
	return {
		name,
		navigations,
		location: {
			origin,
			replace(url) {
				navigations.push(url);
			},
		},
	};
}

function legacyRecord(profiles) {
	return JSON.stringify({ version: 1, currentProfileId: null, profiles });
}

test('legacy offer, canonical import, acknowledgement, and cleanup form one retry-safe transaction', () => {
	const secret = 'pairing-secret-must-not-cross';
	const legacyStorage = memoryStorage([
		[
			LEGACY_MANAGER_PROFILE_STORAGE_KEY,
			legacyRecord([
				{
					id: 'saved',
					serverId: 'server-saved',
					label: ' Saved server ',
					origin: 'https://session.terminay.com',
					status: 'connected',
					reconnectGrant: secret,
					pairingFragment: secret,
					deviceKey: secret,
					pin: secret,
					terminalOutput: secret,
					arbitrary: secret,
				},
			]),
		],
	]);
	const legacyWindow = browser(LEGACY_WEB_MANAGER_ORIGIN);
	const offered = runLegacyManagerMigration({
		window: legacyWindow,
		storage: legacyStorage,
		createId: () => 'migration-test',
	});
	assert.deepEqual(offered, { status: 'offered', count: 1 });
	assert.deepEqual(legacyWindow.navigations, [WEB_MANAGER_ORIGIN]);
	assert.equal(
		legacyStorage.getItem(LEGACY_MANAGER_PROFILE_STORAGE_KEY) !== null,
		true,
	);
	assert.equal(
		legacyStorage.getItem(LEGACY_MANAGER_PENDING_ACK_KEY),
		'migration-test',
	);
	assert.equal(
		legacyWindow.name.startsWith(LEGACY_MANAGER_HANDOFF_PREFIX),
		true,
	);
	assert.equal(legacyWindow.name.includes(secret), false);
	assert.deepEqual(
		Object.keys(
			JSON.parse(legacyWindow.name.slice(LEGACY_MANAGER_HANDOFF_PREFIX.length))
				.profiles[0],
		).sort(),
		['id', 'label', 'origin', 'serverId'],
	);

	const canonicalStorage = memoryStorage();
	const canonicalWindow = browser(WEB_MANAGER_ORIGIN, legacyWindow.name);
	const host = new WebConnectionHost({ storage: canonicalStorage });
	const imported = consumeLegacyManagerMigration({
		window: canonicalWindow,
		host,
	});
	assert.deepEqual(imported, { status: 'imported', count: 1 });
	assert.deepEqual(canonicalWindow.navigations, [LEGACY_WEB_MANAGER_ORIGIN]);
	assert.equal(host.profiles.get('saved').status, 'offline');
	assert.equal(
		canonicalStorage.getItem(WEB_PROFILE_STORAGE_KEY).includes(secret),
		false,
	);

	legacyWindow.name = canonicalWindow.name;
	legacyWindow.navigations.length = 0;
	const completed = runLegacyManagerMigration({
		window: legacyWindow,
		storage: legacyStorage,
	});
	assert.deepEqual(completed, { status: 'completed', count: 0 });
	assert.equal(legacyStorage.getItem(LEGACY_MANAGER_PROFILE_STORAGE_KEY), null);
	assert.equal(legacyStorage.getItem(LEGACY_MANAGER_PENDING_ACK_KEY), null);
	assert.equal(legacyWindow.name, '');
	assert.deepEqual(legacyWindow.navigations, [WEB_MANAGER_ORIGIN]);
});

test('failed canonical import retains offer and source record for retry', () => {
	const legacyStorage = memoryStorage([
		[
			LEGACY_MANAGER_PROFILE_STORAGE_KEY,
			legacyRecord([
				{
					id: 'saved',
					serverId: 'server-saved',
					label: 'Saved',
					origin: 'https://session.terminay.com',
				},
			]),
		],
	]);
	const legacyWindow = browser(LEGACY_WEB_MANAGER_ORIGIN);
	runLegacyManagerMigration({
		window: legacyWindow,
		storage: legacyStorage,
		createId: () => 'migration-retry',
	});
	const canonicalWindow = browser(WEB_MANAGER_ORIGIN, legacyWindow.name);
	const failingStorage = {
		getItem() {
			return null;
		},
		setItem() {
			throw new Error('quota');
		},
		removeItem() {},
	};
	const result = consumeLegacyManagerMigration({
		window: canonicalWindow,
		host: new WebConnectionHost({ storage: failingStorage }),
	});
	assert.equal(result.status, 'recovery');
	assert.equal(canonicalWindow.name, legacyWindow.name);
	assert.deepEqual(canonicalWindow.navigations, []);
	assert.equal(
		legacyStorage.getItem(LEGACY_MANAGER_PROFILE_STORAGE_KEY) !== null,
		true,
	);
});

test('legacy migration rejects malformed, oversized, duplicate, and manager-origin records without navigation', () => {
	for (const encoded of [
		'{bad',
		legacyRecord(
			Array.from({ length: 129 }, (_, index) => ({
				id: `p-${index}`,
				serverId: `s-${index}`,
				label: 'Saved',
				origin: `https://s-${index}.example.test`,
			})),
		),
		legacyRecord([
			{
				id: 'same',
				serverId: 'one',
				label: 'One',
				origin: 'https://one.example.test',
			},
			{
				id: 'same',
				serverId: 'two',
				label: 'Two',
				origin: 'https://two.example.test',
			},
		]),
		legacyRecord([
			{
				id: 'manager',
				serverId: 'manager',
				label: 'Manager',
				origin: WEB_MANAGER_ORIGIN,
			},
		]),
	]) {
		const storage = memoryStorage([
			[LEGACY_MANAGER_PROFILE_STORAGE_KEY, encoded],
		]);
		const target = browser(LEGACY_WEB_MANAGER_ORIGIN);
		const result = runLegacyManagerMigration({
			window: target,
			storage,
			createId: () => 'migration-invalid',
		});
		assert.equal(result.status, 'recovery');
		assert.deepEqual(target.navigations, []);
		assert.equal(storage.getItem(LEGACY_MANAGER_PROFILE_STORAGE_KEY), encoded);
	}
});

test('cleanup requires the exact acknowledgement and unavailable storage has a clear recovery path', () => {
	const storage = memoryStorage([
		[LEGACY_MANAGER_PROFILE_STORAGE_KEY, legacyRecord([])],
		[LEGACY_MANAGER_PENDING_ACK_KEY, 'migration-real'],
	]);
	const forgedAck = `${LEGACY_MANAGER_HANDOFF_PREFIX}${JSON.stringify({ type: 'ack', version: 1, id: 'migration-forged', sourceOrigin: LEGACY_WEB_MANAGER_ORIGIN, destinationOrigin: WEB_MANAGER_ORIGIN })}`;
	const target = browser(LEGACY_WEB_MANAGER_ORIGIN, forgedAck);
	assert.equal(
		runLegacyManagerMigration({ window: target, storage }).status,
		'recovery',
	);
	assert.equal(
		storage.getItem(LEGACY_MANAGER_PROFILE_STORAGE_KEY) !== null,
		true,
	);
	assert.deepEqual(target.navigations, []);

	const blocked = runLegacyManagerMigration({
		window: browser(LEGACY_WEB_MANAGER_ORIGIN),
		storage: undefined,
	});
	assert.equal(blocked.status, 'recovery');
	assert.match(blocked.message, /storage is unavailable/i);
});

test('no legacy profile record redirects without manufacturing a migration claim', () => {
	const target = browser(LEGACY_WEB_MANAGER_ORIGIN, 'unrelated-window-name');
	const result = runLegacyManagerMigration({
		window: target,
		storage: memoryStorage(),
	});
	assert.deepEqual(result, { status: 'redirected', count: 0 });
	assert.equal(target.name, '');
	assert.deepEqual(target.navigations, [WEB_MANAGER_ORIGIN]);
});
