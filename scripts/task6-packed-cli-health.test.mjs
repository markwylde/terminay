import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stageProductionDependencyClosure } from './standalone-runtime-dependencies.mjs';

const repositoryRoot = new URL('..', import.meta.url);

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.once('error', reject);
		child.once('close', (code) => {
			if (code === 0) resolve({ stdout, stderr });
			else
				reject(
					new Error(`${command} ${args.join(' ')} exited ${code}: ${stderr}`),
				);
		});
	});
}

test('the extracted standalone CLI serves its opt-in health/readiness contract and shuts down cleanly', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-packed-health-'));
	let server;
	try {
		const packed = join(root, 'packed');
		const extracted = join(root, 'extracted');
		await mkdir(packed);
		await mkdir(extracted);
		const repositoryPath = new URL('.', repositoryRoot).pathname;
		const pack = Object.values(JSON.parse(
			(
				await run(
					'npm',
					[
						'pack',
						'--workspace',
						'@terminay/server',
						'--json',
						'--pack-destination',
						packed,
					],
					{ cwd: repositoryPath },
				)
			).stdout,
		));
		assert.equal(pack.length, 1);
		await run('tar', ['-xzf', join(packed, pack[0].filename), '-C', extracted]);

		const packageRoot = join(extracted, 'package');
		await stageProductionDependencyClosure({
			destinationModules: join(packageRoot, 'node_modules'),
			runtimeModules: join(repositoryPath, 'node_modules'),
			workspacePackages: {
				'@terminay/server-core': join(repositoryPath, 'packages/server-core'),
				'@terminay/protocol': join(repositoryPath, 'packages/protocol'),
			},
			rootPackages: [
				'@terminay/server-core',
				'@terminay/protocol',
				'@modelcontextprotocol/sdk',
				'node-pty',
				'ws',
				'zod',
			],
		});
		const packageJson = JSON.parse(
			await readFile(join(packageRoot, 'package.json'), 'utf8'),
		);
		const dataRoot = join(root, 'data');
		server = spawn(
			process.execPath,
			[
				join(packageRoot, packageJson.bin['terminay-server']),
				'--server-id',
				'packed-health',
				'--data-root',
				dataRoot,
				'--project-root',
				packageRoot,
				'--endpoint',
				'disabled',
				'--health-host',
				'127.0.0.1',
				'--health-port',
				'0',
				'--agent-integration',
				'disabled',
			],
			{
				cwd: packageRoot,
				env: {
					...process.env,
					HOME: join(root, 'home'),
					TERMINAY_SERVER_VERSION: packageJson.version,
				},
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);
		server.stdout.setEncoding('utf8');
		server.stderr.setEncoding('utf8');
		const readiness = await readReadiness(server);
		assert.equal(readiness.ready, true);
		assert.equal(readiness.serverId, 'packed-health');
		assert.equal(readiness.version, packageJson.version);
		assert.equal(readiness.protocolEndpoint, null);
		assert.match(readiness.healthEndpoint, /^http:\/\/127\.0\.0\.1:\d+$/u);

		const ready = await fetch(`${readiness.healthEndpoint}/readyz`);
		assert.equal(ready.status, 200);
		assert.equal(ready.headers.get('cache-control'), 'no-store');
		assert.equal(ready.headers.get('referrer-policy'), 'no-referrer');
		assert.equal(ready.headers.get('access-control-allow-origin'), null);
		assert.deepEqual(await ready.json(), {
			status: 'ok',
			ready: true,
			phase: 'ready',
			serverId: 'packed-health',
			version: packageJson.version,
		});

		const live = await fetch(`${readiness.healthEndpoint}/healthz`);
		assert.equal(live.status, 200);
		const liveBody = await live.json();
		assert.equal(liveBody.ready, true);
		assert.equal(Object.hasOwn(liveBody, 'dataRoot'), false);
		assert.equal(Object.hasOwn(liveBody, 'pairing'), false);

		const exit = await stop(server);
		assert.equal(exit.code, 0, exit.stderr);
		server = undefined;
	} finally {
		if (server !== undefined) await stop(server);
		await rm(root, { recursive: true, force: true });
	}
});

function readReadiness(child) {
	return new Promise((resolve, reject) => {
		let output = '';
		let stderr = '';
		const timeout = setTimeout(
			() => reject(new Error('packed CLI did not become ready')),
			20_000,
		);
		const fail = (code) => {
			clearTimeout(timeout);
			reject(
				new Error(`packed CLI exited before readiness (${code}): ${stderr}`),
			);
		};
		child.once('exit', fail);
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		child.stdout.on('data', (chunk) => {
			output += chunk;
			const newline = output.indexOf('\n');
			if (newline === -1) return;
			clearTimeout(timeout);
			child.off('exit', fail);
			try {
				resolve(JSON.parse(output.slice(0, newline)));
			} catch (error) {
				reject(error);
			}
		});
	});
}

function stop(child) {
	if (child.exitCode !== null || child.signalCode !== null)
		return Promise.resolve({ code: child.exitCode, stderr: '' });
	return new Promise((resolve) => {
		let stderr = '';
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
		});
		const timeout = setTimeout(() => {
			child.kill('SIGKILL');
			resolve({ code: child.exitCode, stderr });
		}, 10_000);
		child.once('exit', (code) => {
			clearTimeout(timeout);
			resolve({ code, stderr });
		});
		child.kill('SIGTERM');
	});
}
