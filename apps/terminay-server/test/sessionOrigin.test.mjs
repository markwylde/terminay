import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	parseHostedEndpoints,
	PRODUCTION_HOSTED_ENDPOINTS,
} from '@terminay/protocol';
import {
	loadOrCreateSessionOrigin,
	SESSION_ORIGIN_FILE,
} from '../dist/remote/sessionOrigin.js';

const PRODUCTION = PRODUCTION_HOSTED_ENDPOINTS;
const PREVIEW = parseHostedEndpoints({
	appServer: 'https://app-pr123.dev.terminay.com',
	sessionServer: 'https://<session>-pr123.dev.terminay.com',
});
const LOOPBACK = parseHostedEndpoints({
	appServer: 'http://localhost:8443',
	sessionServer: 'http://<session>.localhost:8443',
});

async function withDataRoot(body) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-session-origin-'));
	try {
		return await body(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('a fresh data root mints one session origin from the Session Server template', () =>
	withDataRoot(async (root) => {
		const origin = loadOrCreateSessionOrigin(root, PRODUCTION);
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
		const first = loadOrCreateSessionOrigin(root, PRODUCTION);
		const second = loadOrCreateSessionOrigin(root, PRODUCTION);
		assert.equal(second, first);
		// Equal endpoints parsed separately still match the persisted origin.
		assert.equal(
			loadOrCreateSessionOrigin(
				root,
				parseHostedEndpoints({
					appServer: 'app.terminay.com',
					sessionServer: '<session>.terminay.com',
				}),
			),
			first,
		);
	}));

test('changing the Session Server mints a new origin from the new template', () =>
	withDataRoot(async (root) => {
		const first = loadOrCreateSessionOrigin(root, PRODUCTION);
		const second = loadOrCreateSessionOrigin(root, PREVIEW);
		assert.notEqual(second, first);
		assert.match(new URL(second).hostname, /^[a-f0-9]{32}-pr123\.dev\.terminay\.com$/u);
		// The new origin replaces the old one, so a later start is stable again.
		assert.equal(loadOrCreateSessionOrigin(root, PREVIEW), second);
	}));

test('a loopback Session Server keeps http so a development relay needs no certificate', () =>
	withDataRoot(async (root) => {
		const origin = loadOrCreateSessionOrigin(root, LOOPBACK);
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
		const origin = loadOrCreateSessionOrigin(root, PRODUCTION);
		assert.match(new URL(origin).hostname, /\.terminay\.com$/u);

		await writeFile(file, JSON.stringify({ origin: 'https://a.terminay.com' }));
		assert.match(
			new URL(loadOrCreateSessionOrigin(root, PRODUCTION)).hostname,
			/\.terminay\.com$/u,
		);
	}));
