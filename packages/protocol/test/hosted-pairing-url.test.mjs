import assert from 'node:assert/strict';
import test from 'node:test';
import {
	classifyPairingOrigin,
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

const SECRET = 'secret-token-that-must-not-be-stored-12';

test('every hosted and manager link is classified as hosted', () => {
	for (const link of [
		`https://app.terminay.com/?s=abc12345def67890abc12345def67890#${SECRET}`,
		`https://abc12345def67890abc12345def67890.terminay.com/v1/#${SECRET}`,
		`http://abc12345def67890abc12345def67890.localhost:18080/v1/#${SECRET}`,
		`http://localhost:18080/?s=abc12345def67890abc12345def67890#${SECRET}`,
	]) {
		assert.equal(parseHostedPairingUrl(link).class, 'hosted', link);
	}
});

test('a standalone server link keeps its literal origin and carries no session id', () => {
	const parsed = parseHostedPairingUrl(`https://box.example.test:8443/v1/?hostName=Studio-Mac#${SECRET}`);
	assert.equal(parsed.class, 'direct');
	// The origin an operator pointed at their own box is used exactly as written.
	assert.equal(parsed.origin, 'https://box.example.test:8443');
	assert.equal(parsed.sessionId, '');
	assert.equal(parsed.hostName, 'Studio-Mac');
	assert.equal(parsed.label, 'Studio-Mac');
	assert.equal(parsed.fragment, SECRET);
	assert.equal(parsed.href, `https://box.example.test:8443/v1/?hostName=Studio-Mac#${SECRET}`);
	// There is no separate connection manager beside a self-hosted endpoint.
	assert.equal(parsed.managerHref, parsed.href);

	// A hostname short enough to have no session-id shape still works, as does
	// an IP literal, because nothing is derived from the hostname.
	assert.equal(parseHostedPairingUrl(`https://box/v1/#${SECRET}`).origin, 'https://box');
	const byAddress = parseHostedPairingUrl(`https://203.0.113.4:8443/v1/#${SECRET}`);
	assert.equal(byAddress.class, 'direct');
	assert.equal(byAddress.origin, 'https://203.0.113.4:8443');
	assert.equal(byAddress.label, '203.0.113.4:8443');
});

test('direct links are rejected without HTTPS, the /v1/ path, or a fragment', () => {
	assert.throws(() => parseHostedPairingUrl(`http://box.example.test:8443/v1/#${SECRET}`), /HTTPS or loopback HTTP/u);
	assert.throws(() => parseHostedPairingUrl(`https://box.example.test:8443/#${SECRET}`), /pairing link/u);
	assert.throws(() => parseHostedPairingUrl(`https://box.example.test:8443/signal#${SECRET}`), /pairing link/u);
	assert.throws(() => parseHostedPairingUrl('https://box.example.test:8443/v1/'), /fragment|pairing link|secret/iu);
	// A secret must never be reachable from the query string.
	assert.throws(() => parseHostedPairingUrl(`https://box.example.test:8443/v1/?pairingToken=leaked#${SECRET}`), /fragment/u);
	assert.throws(() => parseHostedPairingUrl(`https://user:pass@box.example.test/v1/#${SECRET}`), /credentials/u);
	assert.throws(() => parseHostedPairingUrl('not a url'), /complete Terminay pairing link/u);
});

test('an origin classifies the same way for pairing and for reconnect', () => {
	// Pairing reads the class off the link; reconnect only has the saved
	// origin. They must agree, or a device pairs with an endpoint it can never
	// reach again.
	for (const [origin, expected] of [
		['https://app.terminay.com', 'hosted'],
		['https://abc12345def67890abc12345def67890.terminay.com', 'hosted'],
		['http://abc12345def67890abc12345def67890.localhost:18080', 'hosted'],
		['http://127.0.0.1:4321', 'hosted'],
		['https://box.example.test:8443', 'direct'],
		['https://203.0.113.4:8443', 'direct'],
		['https://box', 'direct'],
	]) {
		assert.equal(classifyPairingOrigin(origin), expected, origin);
	}

	for (const link of [
		`https://box.example.test:8443/v1/#${SECRET}`,
		`https://abc12345def67890abc12345def67890.terminay.com/v1/#${SECRET}`,
		`https://app.terminay.com/?s=abc12345def67890abc12345def67890#${SECRET}`,
	]) {
		const parsed = parseHostedPairingUrl(link);
		assert.equal(classifyPairingOrigin(parsed.origin), parsed.class, link);
	}
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
