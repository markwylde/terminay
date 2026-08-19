import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = await mkdtemp(
	join(tmpdir(), 'terminay-remote-connection-url-'),
);
const output = join(directory, 'connectionUrl.mjs');
await build({
	alias: {
		'@terminay/protocol': fileURLToPath(
			new URL('../packages/protocol/src/index.ts', import.meta.url),
		),
	},
	bundle: true,
	entryPoints: ['electron/remote/connectionUrl.ts'],
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
});
const policy = await import(output);

test.after(async () => {
	await rm(directory, { force: true, recursive: true });
});

test('accepts a Docker-hosted HTTPS one-time fragment pairing URL', () => {
	const url = `https://terminay.example.test/#${'a'.repeat(43)}`;
	assert.equal(policy.normalizeRemoteConnectionUrl(`  ${url}  `), url);
});

test('accepts the explicit device-pairing fragment and rejects query credentials', () => {
	const expiresAt = new Date(Date.now() + 60_000).toISOString();
	const valid = `https://terminay.example.test/#pairingFlow=device&pairingSessionId=session-1&pairingToken=token-1&pairingExpiresAt=${encodeURIComponent(expiresAt)}`;
	assert.equal(policy.normalizeRemoteConnectionUrl(valid), valid);
	assert.equal(policy.isRemoteAccessPairingUrl(valid), true);
	assert.throws(
		() =>
			policy.normalizeRemoteConnectionUrl(
				'https://terminay.example.test/?pairingSessionId=session-1',
			),
		/fragment/u,
	);
	const query = `https://terminay.example.test/?pairingSessionId=session-1&pairingToken=token-1&pairingExpiresAt=${encodeURIComponent(expiresAt)}`;
	assert.throws(
		() => policy.normalizeRemoteConnectionUrl(query),
		/fragment/u,
	);
	const expired = `https://terminay.example.test/#pairingSessionId=session-1&pairingToken=token-1&pairingExpiresAt=${encodeURIComponent(new Date(Date.now() - 1).toISOString())}`;
	assert.throws(() => policy.normalizeRemoteConnectionUrl(expired), /expired/u);
});

test('distinguishes standalone protocol URLs from Remote Access device pairing URLs', () => {
	const standalone = `https://terminay.example.test/#${'a'.repeat(43)}`;
	assert.equal(policy.isRemoteAccessPairingUrl(policy.normalizeRemoteConnectionUrl(standalone)), false);
});

test('accepts hosted manager pairing URLs without treating app.terminay.com as the server', () => {
	const sessionId = 'abc12345def67890abc12345def67890';
	const secret = `${'A'.repeat(43)}`;
	const hosted = `https://app.terminay.com/?s=${sessionId}&hostName=Studio-Mac#${secret}`;
	const normalized = policy.normalizeRemoteConnectionUrl(hosted);
	assert.equal(policy.isRemoteAccessPairingUrl(normalized), true);
	assert.match(normalized, /^https:\/\/app\.terminay\.com\/\?/);
	assert.doesNotMatch(normalized, /pairingToken=/);
	assert.equal(new URL(normalized).searchParams.get('s'), sessionId);
});

test('rejects unsafe or ambiguous remote pairing URLs with clear messages', () => {
	assert.throws(
		() =>
			policy.normalizeRemoteConnectionUrl(
				`http://docker.example.test/#${'a'.repeat(43)}`,
			),
		/HTTPS/u,
	);
	assert.throws(
		() =>
			policy.normalizeRemoteConnectionUrl(
				`https://user:pass@docker.example.test/#${'a'.repeat(43)}`,
			),
		/credentials/u,
	);
	assert.throws(
		() =>
			policy.normalizeRemoteConnectionUrl(
				`https://docker.example.test/?token=leaked#${'a'.repeat(43)}`,
			),
		/fragment/u,
	);
	assert.throws(
		() =>
			policy.normalizeRemoteConnectionUrl('https://docker.example.test/#short'),
		/fragment/u,
	);
	assert.throws(
		() =>
			policy.normalizeRemoteConnectionUrl('https://docker.example.test/#%ZZ'),
		/fragment/u,
	);
});

test('maps Chromium reachability failures to actionable connection errors', () => {
	assert.match(
		policy.describeRemoteConnectionLoadError({
			errorCode: 'net::ERR_CERT_AUTHORITY_INVALID',
		}).message,
		/certificate could not be verified/u,
	);
	assert.match(
		policy.describeRemoteConnectionLoadError({
			errorCode: 'net::ERR_NAME_NOT_RESOLVED',
		}).message,
		/hostname could not be resolved/u,
	);
	assert.match(
		policy.describeRemoteConnectionLoadError({
			errorCode: 'net::ERR_CONNECTION_TIMED_OUT',
		}).message,
		/refused or timed out/u,
	);
	assert.match(
		policy.describeRemoteConnectionLoadError(new Error('ERR_CERT_DATE_INVALID'))
			.message,
		/certificate could not be verified/u,
	);
	assert.match(
		policy.describeRemoteConnectionLoadError(new Error('unknown')).message,
		/Check the URL/u,
	);
});
