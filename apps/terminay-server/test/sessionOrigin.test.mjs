import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	loadOrCreateSessionOrigin,
	SESSION_ORIGIN_FILE,
} from '../dist/remote/sessionOrigin.js';

async function withDataRoot(body) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-session-origin-'));
	try {
		return await body(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('a fresh data root mints one session origin under the hosted domain', () =>
	withDataRoot(async (root) => {
		const origin = loadOrCreateSessionOrigin(root, 'terminay.com');
		const url = new URL(origin);
		assert.equal(url.protocol, 'https:');
		assert.match(url.hostname, /^[a-f0-9]{32}\.terminay\.com$/u);
		assert.equal(origin, url.origin);

		const file = join(root, SESSION_ORIGIN_FILE);
		const persisted = JSON.parse(await readFile(file, 'utf8'));
		assert.deepEqual(persisted, { origin, schemaVersion: 1 });
		// The origin identifies the server to the hosted relay, so the file is
		// owner-only inside the data root.
		assert.equal((await stat(file)).mode & 0o777, 0o600);
	}));

test('a persisted session origin is reused across restarts', () =>
	withDataRoot(async (root) => {
		const first = loadOrCreateSessionOrigin(root, 'terminay.com');
		const second = loadOrCreateSessionOrigin(root, 'terminay.com');
		assert.equal(second, first);
		// The hosted domain may be written with or without a scheme.
		assert.equal(loadOrCreateSessionOrigin(root, 'https://terminay.com'), first);
	}));

test('changing the hosted domain mints a new origin under the new domain', () =>
	withDataRoot(async (root) => {
		const first = loadOrCreateSessionOrigin(root, 'terminay.com');
		const second = loadOrCreateSessionOrigin(root, 'example.test');
		assert.notEqual(second, first);
		assert.match(new URL(second).hostname, /\.example\.test$/u);
		// The new origin replaces the old one, so a later start is stable again.
		assert.equal(loadOrCreateSessionOrigin(root, 'example.test'), second);
	}));

test('a loopback hosted domain keeps http so a development relay needs no certificate', () =>
	withDataRoot(async (root) => {
		const origin = loadOrCreateSessionOrigin(root, 'localhost:8443');
		const url = new URL(origin);
		assert.equal(url.protocol, 'http:');
		assert.match(url.hostname, /\.localhost$/u);
		assert.equal(url.port, '8443');
	}));

test('an unreadable or foreign persisted origin is replaced rather than trusted', () =>
	withDataRoot(async (root) => {
		const file = join(root, SESSION_ORIGIN_FILE);
		await writeFile(
			file,
			JSON.stringify({ origin: 'https://attacker.example', schemaVersion: 1 }),
		);
		const origin = loadOrCreateSessionOrigin(root, 'terminay.com');
		assert.match(new URL(origin).hostname, /\.terminay\.com$/u);

		await writeFile(file, JSON.stringify({ origin: 'https://a.terminay.com' }));
		assert.match(
			new URL(loadOrCreateSessionOrigin(root, 'terminay.com')).hostname,
			/\.terminay\.com$/u,
		);
	}));
