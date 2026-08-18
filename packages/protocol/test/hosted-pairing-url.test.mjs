import assert from 'node:assert/strict';
import test from 'node:test';
import {
	formatHostedPairingUrl,
	managerOriginFromSessionOrigin,
	parseHostedPairingUrl,
} from '../dist/index.js';

test('hosted pairing URLs are advertised on the manager origin', () => {
	const href = formatHostedPairingUrl({
		fragment: 'secret-token-that-must-not-be-stored-12',
		hostName: 'Studio-Mac.local',
		managerOrigin: 'https://app.terminay.com',
		sessionId: 'abc12345def67890abc12345def67890',
	});
	const url = new URL(href);
	assert.equal(url.origin, 'https://app.terminay.com');
	assert.equal(url.pathname, '/');
	assert.equal(url.searchParams.get('s'), 'abc12345def67890abc12345def67890');
	assert.equal(url.searchParams.get('hostName'), 'Studio-Mac');
	assert.equal(url.hash.slice(1), 'secret-token-that-must-not-be-stored-12');
	assert.equal(url.searchParams.has('pairingToken'), false);
});

test('opening a manager pairing URL reconstructs the session enrollment href', () => {
	const parsed = parseHostedPairingUrl(
		'https://app.terminay.com/?s=abc12345def67890abc12345def67890&hostName=Studio-Mac#secret-token-that-must-not-be-stored-12',
	);
	assert.equal(parsed.origin, 'https://abc12345def67890abc12345def67890.terminay.com');
	assert.equal(parsed.sessionId, 'abc12345def67890abc12345def67890');
	assert.equal(parsed.label, 'Studio-Mac');
	assert.equal(
		parsed.href,
		'https://abc12345def67890abc12345def67890.terminay.com/v1/?hostName=Studio-Mac#secret-token-that-must-not-be-stored-12',
	);
	assert.equal(parsed.managerHref.includes('app.terminay.com'), true);
	assert.equal(parsed.managerHref.includes(parsed.fragment), true);
});

test('legacy session-origin pairing URLs still parse to the same session origin', () => {
	const parsed = parseHostedPairingUrl(
		'https://abc12345def67890abc12345def67890.terminay.com/v1/?hostName=Studio-Mac#secret-token-that-must-not-be-stored-12',
	);
	assert.equal(parsed.origin, 'https://abc12345def67890abc12345def67890.terminay.com');
	assert.equal(
		new URL(parsed.managerHref).origin,
		'https://app.terminay.com',
	);
});

test('manager origin keeps the session port for local hosted stacks', () => {
	assert.equal(
		managerOriginFromSessionOrigin('https://abc12345def67890abc12345def67890.terminay.com:8443'),
		'https://app.terminay.com:8443',
	);
	assert.equal(
		managerOriginFromSessionOrigin('http://abc12345def67890abc12345def67890.localhost:18080'),
		'http://localhost:18080',
	);
	const parsed = parseHostedPairingUrl(
		'https://app.terminay.com:8443/?s=abc12345def67890abc12345def67890#secret-token-that-must-not-be-stored-12',
	);
	assert.equal(parsed.origin, 'https://abc12345def67890abc12345def67890.terminay.com:8443');
});

test('pairing secrets are rejected in the query', () => {
	assert.throws(
		() =>
			parseHostedPairingUrl(
				'https://app.terminay.com/?s=abc12345def67890abc12345def67890&pairingToken=leaked#secret-token-that-must-not-be-stored-12',
			),
		/fragment/,
	);
	assert.throws(
		() => parseHostedPairingUrl('https://app.terminay.com/v1/#secret-token-that-must-not-be-stored-12'),
		/pairing link/,
	);
});
