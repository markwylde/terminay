import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { request } from 'node:http';
import test from 'node:test';
import { verifyWebHostDeployment } from './verify-web-host-deployment.mjs';

const revision = '0123456789abcdef0123456789abcdef01234567';
const image = `terminay-web-contract:${process.pid}`;
const container = `terminay-web-contract-${process.pid}`;

test('actual production web image satisfies the deployment verifier', {
	timeout: 15 * 60_000,
}, async (t) => {
	execFileSync(
		'docker',
		[
			'build',
			'--build-arg',
			`TERMINAY_SOURCE_REVISION=${revision}`,
			'--tag',
			image,
			'--file',
			'Dockerfile.web',
			'.',
		],
		{ stdio: 'inherit' },
	);
	t.after(() => {
		execFileSync('docker', ['rm', '--force', container], { stdio: 'ignore' });
		execFileSync('docker', ['image', 'rm', '--force', image], {
			stdio: 'ignore',
		});
	});
	execFileSync(
		'docker',
		[
			'run',
			'--detach',
			'--name',
			container,
			'--publish',
			'127.0.0.1::8080',
			image,
		],
		{ stdio: 'ignore' },
	);
	const mapping = execFileSync('docker', ['port', container, '8080/tcp'], {
		encoding: 'utf8',
	}).trim();
	const port = mapping.match(/:(\d+)$/u)?.[1];
	assert.ok(port, `Docker did not publish the web image port: ${mapping}`);
	const origin = `http://127.0.0.1:${port}`;

	let lastError;
	for (let attempt = 0; attempt < 30; attempt += 1) {
		try {
			const result = await verifyWebHostDeployment({
				origin,
				expectedRevision: revision,
				allowHttp: true,
			});
			assert.equal(result.release.sourceRevision, revision);
			const legacy = await requestWithHost(origin, '/', 'app.terminay.com');
			assert.equal(legacy.status, 200);
			assert.match(legacy.body, /Moving saved Terminay connections/u);
			const crossAuthorityEntry = await requestWithHost(
				origin,
				'/web.html',
				'app.terminay.com',
			);
			assert.equal(crossAuthorityEntry.status, 404);
			const unknown = await requestWithHost(
				origin,
				'/',
				'unrecognised.example',
			);
			assert.equal(unknown.status, 421);
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
	throw lastError;
});

function requestWithHost(origin, path, host) {
	return new Promise((resolve, reject) => {
		const target = new URL(path, origin);
		const outgoing = request(target, { headers: { host } }, (response) => {
			const chunks = [];
			response.on('data', (chunk) => chunks.push(chunk));
			response.on('end', () =>
				resolve({
					status: response.statusCode,
					body: Buffer.concat(chunks).toString('utf8'),
				}),
			);
		});
		outgoing.on('error', reject);
		outgoing.end();
	});
}
