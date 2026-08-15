import assert from 'node:assert/strict';
import test from 'node:test';
import {
	PwaConnectionManager,
	parsePwaPairingUrl,
	WEB_PROFILE_STORAGE_KEY,
} from '../dist/index.js';

function memoryStorage(seed = new Map()) {
	return {
		getItem(key) { return seed.has(key) ? seed.get(key) : null; },
		setItem(key, value) { seed.set(key, value); },
		removeItem(key) { seed.delete(key); },
	};
}

test('a pairing URL saves only a stable-origin bookmark before navigation', () => {
	const storage = memoryStorage();
	const manager = new PwaConnectionManager({ storage, now: () => 100 });
	const result = manager.addPairingUrl('https://server-one.terminay.com/v1/#one-time-pairing-secret', 'Work server');
	assert.equal(result.pairingUrl, 'https://server-one.terminay.com/v1/#one-time-pairing-secret');
	assert.deepEqual(result.profile, {
		label: 'Work server', origin: 'https://server-one.terminay.com', createdAt: 100, lastOpenedAt: 100,
	});
	const saved = JSON.parse(storage.getItem(WEB_PROFILE_STORAGE_KEY));
	assert.deepEqual(saved, {
		version: 1,
		profiles: [{ label: 'Work server', origin: 'https://server-one.terminay.com', createdAt: 100, lastOpenedAt: 100 }],
	});
	assert.equal(storage.getItem(WEB_PROFILE_STORAGE_KEY).includes('one-time-pairing-secret'), false);
});

test('saved bookmarks open only the stable origin and update their local timestamp', () => {
	const opened = [];
	let now = 100;
	const manager = new PwaConnectionManager({ storage: memoryStorage(), now: () => now, navigate: (url, target) => opened.push({ url, target }) });
	manager.addPairingUrl('https://server-one.terminay.com/v1/#secret');
	now = 200;
	const openedProfile = manager.open('https://server-one.terminay.com', true);
	assert.deepEqual(openedProfile, {
		profile: { label: 'server-one.terminay.com', origin: 'https://server-one.terminay.com', createdAt: 100, lastOpenedAt: 200 },
		url: 'https://server-one.terminay.com', target: '_blank',
	});
	assert.deepEqual(opened, [{ url: 'https://server-one.terminay.com', target: '_blank' }]);
});

test('one stable origin has one bookmark and rename and forget affect only that bookmark', () => {
	const manager = new PwaConnectionManager({ storage: memoryStorage(), now: () => 100 });
	manager.addPairingUrl('https://server-one.terminay.com/v1/#first', 'First');
	manager.addPairingUrl('https://server-one.terminay.com/v1/#second', 'Second');
	assert.equal(manager.snapshot().profiles.length, 1);
	assert.equal(manager.snapshot().profiles[0].label, 'Second');
	assert.equal(manager.rename('https://server-one.terminay.com', 'Production').label, 'Production');
	assert.equal(manager.forget('https://server-one.terminay.com'), true);
	assert.deepEqual(manager.snapshot().profiles, []);
});

test('manager rejects non-pairing URLs and restores only the exact current bookmark schema', () => {
	for (const invalid of [
		'https://server-one.terminay.com/v1/',
		'https://server-one.terminay.com/v1/?x=1#secret',
		'https://user:pass@server-one.terminay.com/v1/#secret',
		'http://server-one.terminay.com/v1/#secret',
		'https://server-one.terminay.com/other/#secret',
	]) assert.throws(() => parsePwaPairingUrl(invalid));
	const oldRecord = JSON.stringify({ version: 1, currentProfileId: 'previous', profiles: [{ id: 'previous', origin: 'https://server-one.terminay.com', label: 'Previous', serverId: 'server-one' }] });
	const storage = memoryStorage(new Map([[WEB_PROFILE_STORAGE_KEY, oldRecord]]));
	assert.deepEqual(new PwaConnectionManager({ storage }).snapshot().profiles, []);
});

test('an interrupted bookmark write leaves the manager projection unchanged', () => {
	const manager = new PwaConnectionManager({ storage: { getItem() { return null; }, setItem() { throw new Error('storage unavailable'); }, removeItem() {} } });
	assert.throws(() => manager.addPairingUrl('https://server-one.terminay.com/v1/#secret'), /storage unavailable/);
	assert.deepEqual(manager.snapshot().profiles, []);
});
