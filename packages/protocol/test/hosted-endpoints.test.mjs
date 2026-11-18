import assert from 'node:assert/strict';
import test from 'node:test';
import {
	HostedEndpointsError,
	hostedEndpointsFromLegacyDomain,
	isAppServerOrigin,
	parseHostedEndpoints,
	PRODUCTION_HOSTED_ENDPOINTS,
	recognisedHostedEndpoints,
	sessionIdFromOrigin,
	sessionOriginFor,
} from '../dist/index.js';

const ID = 'abc12345def67890abc12345def67890';

test('production defaults', () => {
	assert.deepEqual({ ...PRODUCTION_HOSTED_ENDPOINTS }, {
		appServer: 'https://app.terminay.com',
		sessionServer: 'https://<session>.terminay.com',
	});
	assert.equal(
		sessionOriginFor(PRODUCTION_HOSTED_ENDPOINTS, ID),
		`https://${ID}.terminay.com`,
	);
	assert.equal(
		sessionIdFromOrigin(PRODUCTION_HOSTED_ENDPOINTS, `https://${ID}.terminay.com`),
		ID,
	);
	assert.equal(
		sessionIdFromOrigin(PRODUCTION_HOSTED_ENDPOINTS, 'https://app.terminay.com'),
		undefined,
	);
	assert.equal(
		isAppServerOrigin(PRODUCTION_HOSTED_ENDPOINTS, 'https://app.terminay.com'),
		true,
	);
});

test('preview endpoints round-trip a session id through one wildcard label', () => {
	const preview = parseHostedEndpoints({
		appServer: 'https://app-pr123.dev.terminay.com',
		sessionServer: 'https://<session>-pr123.dev.terminay.com',
	});
	const origin = sessionOriginFor(preview, ID);
	assert.equal(origin, `https://${ID}-pr123.dev.terminay.com`);
	assert.equal(sessionIdFromOrigin(preview, origin), ID);
	// Another preview's sessions and production sessions do not match.
	assert.equal(
		sessionIdFromOrigin(preview, `https://${ID}-pr124.dev.terminay.com`),
		undefined,
	);
	assert.equal(sessionIdFromOrigin(preview, `https://${ID}.terminay.com`), undefined);
	assert.equal(sessionIdFromOrigin(preview, preview.appServer), undefined);
	// A deeper host, another scheme, or another port is not this template.
	assert.equal(
		sessionIdFromOrigin(preview, `https://x.${ID}-pr123.dev.terminay.com`),
		undefined,
	);
	assert.equal(
		sessionIdFromOrigin(preview, `https://${ID}-pr123.dev.terminay.com:8443`),
		undefined,
	);
});

test('distinct session ids produce distinct origins', () => {
	const other = 'fff12345def67890abc12345def67890';
	assert.notEqual(
		sessionOriginFor(PRODUCTION_HOSTED_ENDPOINTS, ID),
		sessionOriginFor(PRODUCTION_HOSTED_ENDPOINTS, other),
	);
});

test('bare hosts default to HTTPS, loopback to HTTP, and case is normalised', () => {
	const endpoints = parseHostedEndpoints({
		appServer: 'APP-pr1.dev.terminay.com',
		sessionServer: '<session>-PR1.dev.terminay.com',
	});
	assert.equal(endpoints.appServer, 'https://app-pr1.dev.terminay.com');
	assert.equal(endpoints.sessionServer, 'https://<session>-pr1.dev.terminay.com');
	const loopback = parseHostedEndpoints({
		appServer: 'localhost:5173',
		sessionServer: '<session>.localhost:5173',
	});
	assert.equal(loopback.appServer, 'http://localhost:5173');
	assert.equal(loopback.sessionServer, 'http://<session>.localhost:5173');
	assert.equal(sessionOriginFor(loopback, ID), `http://${ID}.localhost:5173`);
});

function rejects(input, field, pattern) {
	assert.throws(
		() => parseHostedEndpoints(input),
		(error) =>
			error instanceof HostedEndpointsError &&
			error.field === field &&
			pattern.test(error.message),
		JSON.stringify(input),
	);
}

test('every isolation rule is enforced', () => {
	const app = 'https://app.terminay.com';
	// Placeholder count and position.
	rejects({ appServer: app, sessionServer: 'https://terminay.com' }, 'sessionServer', /exactly once/u);
	rejects(
		{ appServer: app, sessionServer: 'https://<session><session>.terminay.com' },
		'sessionServer',
		/exactly once/u,
	);
	rejects(
		{ appServer: app, sessionServer: 'https://dev.<session>.terminay.com' },
		'sessionServer',
		/leftmost label/u,
	);
	rejects({ appServer: app, sessionServer: 'https://<session>' }, 'sessionServer', /domain/u);
	// The manager must never be a session origin.
	rejects(
		{
			appServer: 'https://app-preview12.dev.terminay.com',
			sessionServer: 'https://app-<session>.dev.terminay.com',
		},
		'appServer',
		/Session Server template can produce/u,
	);
	rejects(
		{ appServer: 'https://<session>.terminay.com', sessionServer: 'https://<session>.terminay.com' },
		'appServer',
		/must not contain/u,
	);
	// HTTP only on loopback.
	rejects({ appServer: 'http://app.terminay.com', sessionServer: 'https://<session>.terminay.com' }, 'appServer', /HTTPS/u);
	rejects({ appServer: app, sessionServer: 'http://<session>.terminay.com' }, 'sessionServer', /HTTPS/u);
	// Origins only.
	rejects({ appServer: 'https://app.terminay.com/path', sessionServer: 'https://<session>.terminay.com' }, 'appServer', /no path/u);
	rejects({ appServer: 'https://app.terminay.com/?q=1', sessionServer: 'https://<session>.terminay.com' }, 'appServer', /no path/u);
	rejects({ appServer: 'https://u:p@app.terminay.com', sessionServer: 'https://<session>.terminay.com' }, 'appServer', /credentials/u);
	rejects({ appServer: app, sessionServer: 'https://<session>.terminay.com/v1/' }, 'sessionServer', /no path/u);
	// Room for a minted id in one DNS label.
	rejects(
		{ appServer: app, sessionServer: `https://<session>-${'x'.repeat(40)}.terminay.com` },
		'sessionServer',
		/too little room/u,
	);
	rejects({ appServer: '', sessionServer: 'https://<session>.terminay.com' }, 'appServer', /required/u);
});

test('a client recognises its configured endpoints and production', () => {
	const preview = parseHostedEndpoints({
		appServer: 'https://app-pr123.dev.terminay.com',
		sessionServer: 'https://<session>-pr123.dev.terminay.com',
	});
	assert.deepEqual(recognisedHostedEndpoints(), [PRODUCTION_HOSTED_ENDPOINTS]);
	assert.deepEqual(recognisedHostedEndpoints(PRODUCTION_HOSTED_ENDPOINTS), [
		PRODUCTION_HOSTED_ENDPOINTS,
	]);
	assert.deepEqual(recognisedHostedEndpoints(preview), [
		preview,
		PRODUCTION_HOSTED_ENDPOINTS,
	]);
});

test('a legacy hosted domain reads as the pair it always meant', () => {
	assert.equal(hostedEndpointsFromLegacyDomain('terminay.com'), PRODUCTION_HOSTED_ENDPOINTS);
	assert.equal(hostedEndpointsFromLegacyDomain(''), PRODUCTION_HOSTED_ENDPOINTS);
	assert.deepEqual({ ...hostedEndpointsFromLegacyDomain('remote.example.com') }, {
		appServer: 'https://app.remote.example.com',
		sessionServer: 'https://<session>.remote.example.com',
	});
	assert.deepEqual({ ...hostedEndpointsFromLegacyDomain('localhost:18080') }, {
		appServer: 'http://localhost:18080',
		sessionServer: 'http://<session>.localhost:18080',
	});
	assert.deepEqual({ ...hostedEndpointsFromLegacyDomain('http://localhost:18080') }, {
		appServer: 'http://localhost:18080',
		sessionServer: 'http://<session>.localhost:18080',
	});
});
