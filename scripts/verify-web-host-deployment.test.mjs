import assert from 'node:assert/strict';
import test from 'node:test';
import {
	WebHostDeploymentVerificationError,
	verifyWebHostDeployment,
} from './verify-web-host-deployment.mjs';

const headers = {
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
		fetchImpl: async url => {
			calls.push(url);
			if (url.endsWith('/healthz')) return new Response('{"ok":true}', { status: 200 });
			if (url.endsWith('/')) {
				return new Response('<title>Terminay Connections</title><script src="/assets/web-abc.js"></script>', { status: 200, headers });
			}
			return new Response('asset', { status: 200 });
		},
	});
	assert.equal(result.shell, true);
	assert.deepEqual(calls, [
		'https://web.terminay.com/healthz',
		'https://web.terminay.com/',
		'https://web.terminay.com/assets/web-abc.js',
	]);
});

test('deployment verifier rejects a healthy CDN whose origin does not serve the manager', async () => {
	await assert.rejects(
		verifyWebHostDeployment({
			fetchImpl: async url => url.endsWith('/healthz')
				? new Response('{"ok":true}', { status: 200 })
				: new Response('Invalid Terminay host.', { status: 421, headers: { 'content-type': 'text/plain' } }),
		}),
		WebHostDeploymentVerificationError,
	);
});
