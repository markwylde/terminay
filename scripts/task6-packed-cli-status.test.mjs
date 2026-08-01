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

test('the extracted standalone artifact executes its redacted status command with flag-over-environment precedence', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-packed-status-'));
	try {
		const packed = join(root, 'packed');
		const extracted = join(root, 'extracted');
		await mkdir(packed);
		await mkdir(extracted);
		const repositoryPath = new URL('.', repositoryRoot).pathname;
		const pack = JSON.parse(
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
		);
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
		const privateEnvironmentRoot = join(root, 'environment-data-root');
		const privateFlagRoot = join(root, 'flag-data-root');
		const privateLog = join(root, 'private-log.jsonl');
		const privateBundle = join(root, 'private-ui-bundle');
		const result = await run(
			process.execPath,
			[
				join(packageRoot, packageJson.bin['terminay-server']),
				'--status',
				'--server-id',
				'packed-status-flag',
				'--data-root',
				privateFlagRoot,
			],
			{
				cwd: packageRoot,
				env: {
					...process.env,
					TERMINAY_SERVER_VERSION: packageJson.version,
					TERMINAY_SERVER_ID: 'packed-status-environment',
					TERMINAY_DATA_ROOT: privateEnvironmentRoot,
					TERMINAY_LOG_SINK: privateLog,
					TERMINAY_UI_BUNDLE: privateBundle,
				},
			},
		);
		assert.equal(result.stderr, '');
		const status = JSON.parse(result.stdout);
		assert.equal(status.runtimeMode, 'standalone');
		assert.equal(status.serverId, 'packed-status-flag');
		assert.equal(status.version, packageJson.version);
		assert.equal(status.dataRootConfigured, true);
		assert.equal(status.uiBundleConfigured, true);
		assert.equal(status.localEndpointConfigured, true);
		assert.deepEqual(status.remoteExposure, {
			state: 'disabled',
			roomId: null,
			expiresAt: null,
			connectedPeers: 0,
			headlessSessions: 0,
		});
		const serialized = JSON.stringify(status);
		for (const privateValue of [
			privateEnvironmentRoot,
			privateFlagRoot,
			privateLog,
			privateBundle,
		]) {
			assert.equal(
				serialized.includes(privateValue),
				false,
				`status must redact ${privateValue}`,
			);
		}
		for (const forbidden of [
			'dataRoot',
			'logSink',
			'uiBundle',
			'pairingUrl',
			'pairingToken',
			'secret',
		]) {
			assert.equal(
				Object.hasOwn(status, forbidden),
				false,
				`status must omit ${forbidden}`,
			);
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
