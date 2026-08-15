import assert from 'node:assert/strict';
import test from 'node:test';
import {
	verifyWebHostDeployment,
	WebHostDeploymentVerificationError,
} from './verify-web-host-deployment.mjs';

const headers = {
	'cache-control': 'no-store',
	'content-security-policy': "default-src 'self'",
	'content-type': 'text/html; charset=utf-8',
	'cross-origin-opener-policy': 'same-origin',
	'permissions-policy': 'geolocation=()',
	'referrer-policy': 'no-referrer',
	'x-content-type-options': 'nosniff',
	'x-frame-options': 'DENY',
};

test('deployment verifier requires health, manager HTML, security headers, and live assets', async () => {
	const calls = [];
	const result = await verifyWebHostDeployment({
		expectedRevision: '0123456789abcdef0123456789abcdef01234567',
		fetchImpl: async (url) => {
			calls.push(url);
			if (url.endsWith('/healthz')) return jsonResponse({ ok: true });
			if (url.endsWith('/.well-known/terminay-release.json')) {
				return jsonResponse({
					product: 'terminay-web',
					schemaVersion: 1,
					sourceRevision: '0123456789abcdef0123456789abcdef01234567',
				});
			}
			if (url.endsWith('/')) {
				return new Response(
					'<title>Terminay Connections</title><script src="/assets/web-abcdefgh.js"></script>',
					{ status: 200, headers },
				);
			}
			return new Response('asset', {
				status: 200,
				headers: { 'content-type': 'text/javascript' },
			});
		},
	});
	assert.equal(result.shell, true);
	assert.deepEqual(calls, [
		'https://app.terminay.com/healthz',
		'https://app.terminay.com/.well-known/terminay-release.json',
		'https://app.terminay.com/',
		'https://app.terminay.com/assets/web-abcdefgh.js',
	]);
});

test('deployment verifier rejects a healthy CDN whose origin does not serve the manager', async () => {
	await assert.rejects(
		verifyWebHostDeployment({
			fetchImpl: async (url) =>
				url.endsWith('/healthz')
					? jsonResponse({ ok: true })
					: url.endsWith('/.well-known/terminay-release.json')
						? jsonResponse({
								product: 'terminay-web',
								schemaVersion: 1,
								sourceRevision: 'local',
							})
						: new Response('Invalid Terminay host.', {
								status: 421,
								headers: { 'content-type': 'text/plain' },
							}),
		}),
		WebHostDeploymentVerificationError,
	);
});

test('deployment verifier rejects a remote workspace document even when health and release marker pass', async () => {
	await assert.rejects(
		verifyWebHostDeployment({
			fetchImpl: async (url) =>
				url.endsWith('/healthz')
					? jsonResponse({ ok: true })
					: url.endsWith('/.well-known/terminay-release.json')
						? jsonResponse({
								product: 'terminay-web',
								schemaVersion: 1,
								sourceRevision: 'local',
							})
						: new Response(
								'<title>Terminay Connections</title><h1>Terminay Remote</h1>',
								{ status: 200, headers },
							),
		}),
		/not the Terminay connection manager/u,
	);
});

test('deployment verifier rejects a stale release and unhashed assets', async () => {
	await assert.rejects(
		verifyWebHostDeployment({
			expectedRevision: '0123456789abcdef0123456789abcdef01234567',
			fetchImpl: async (url) =>
				url.endsWith('/healthz')
					? jsonResponse({ ok: true })
					: jsonResponse({
							product: 'terminay-web',
							schemaVersion: 1,
							sourceRevision: 'fedcba9876543210fedcba9876543210fedcba98',
						}),
		}),
		/revision does not match/u,
	);

	await assert.rejects(
		verifyWebHostDeployment({
			fetchImpl: async (url) =>
				url.endsWith('/healthz')
					? jsonResponse({ ok: true })
					: url.endsWith('/.well-known/terminay-release.json')
						? jsonResponse({
								product: 'terminay-web',
								schemaVersion: 1,
								sourceRevision: 'local',
							})
						: new Response(
								'<title>Terminay Connections</title><script src="/assets/web.js"></script>',
								{ status: 200, headers },
							),
		}),
		/not content-hashed/u,
	);
});

function jsonResponse(value) {
	return new Response(JSON.stringify(value), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}
