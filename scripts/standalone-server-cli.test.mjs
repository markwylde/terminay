import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const cli = 'apps/terminay-server/dist/cli.js';
const run = (...args) =>
	execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8' }).trim();
const runWithEnv = (args, env) =>
	execFileSync(process.execPath, [cli, ...args], {
		encoding: 'utf8',
		env: { ...process.env, ...env },
	}).trim();

test('standalone server CLI has deterministic version and redacted status entry points', () => {
	assert.equal(run('--version'), '0.0.0');
	const status = JSON.parse(
		run('--status', '--data-root', '/private/terminay'),
	);
	assert.equal(status.runtimeMode, 'standalone');
	assert.equal(status.serverId, 'local-server');
	assert.equal(status.dataRootConfigured, true);
	assert.equal(Object.hasOwn(status, 'dataRoot'), false);
	assert.deepEqual(status.remoteExposure, {
		state: 'disabled',
		roomId: null,
		expiresAt: null,
		connectedPeers: 0,
	});
	assert.equal(JSON.stringify(status).includes('pairingUrl'), false);
});

test('standalone server CLI exposes help and explicit pairing handoff without secrets', () => {
	assert.match(run('--help'), /--pairing/);
	assert.match(run('--help'), /headless MCP stdio adapter/);
	const pairing = JSON.parse(
		runWithEnv(
			['--pairing', '--server-id', 'server-pair', '--endpoint', 'loopback'],
			{ TERMINAY_REMOTE_PAIRING_PIN: '736941' },
		),
	);
	assert.equal(pairing.serverId, 'server-pair');
	assert.equal(pairing.endpoint, 'loopback');
	assert.match(pairing.roomId, /^pair-/);
	assert.equal(pairing.requiresApproval, true);
	assert.ok(pairing.expiresInSeconds >= 59 && pairing.expiresInSeconds <= 60);
	const pairingUrl = new URL(pairing.pairingUrl);
	assert.equal(pairingUrl.protocol, 'https:');
	assert.equal(pairingUrl.hostname, 'server-pair.remote.terminay.local');
	assert.ok(pairingUrl.hash.length > 1);
	assert.equal(typeof pairing.expiresAt, 'string');
	assert.equal(Object.hasOwn(pairing, 'token'), false);
	assert.equal(Object.hasOwn(pairing, 'secret'), false);
});

test('standalone mcp entry fails closed without an inherited local control socket', () => {
	const result = spawnSync(process.execPath, [cli, 'mcp'], {
		encoding: 'utf8',
		env: {
			...process.env,
			TERMINAY_CONTROL_SOCKET: '',
			TERMINAY_CONTROL_TOKEN: '',
		},
	});
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /requires an absolute local control socket/);
	assert.doesNotMatch(result.stderr, /TERMINAY_CONTROL_TOKEN/);
});

test('standalone CLI applies flag-over-environment precedence without exposing configured paths in status', () => {
	const fromEnvironment = JSON.parse(
		runWithEnv(['--status'], {
			TERMINAY_SERVER_ID: 'environment-server',
			TERMINAY_DATA_ROOT: '/private/environment-data',
			TERMINAY_LOG_SINK: '/private/environment-log.jsonl',
			TERMINAY_UI_BUNDLE: '/private/environment-ui',
		}),
	);
	assert.equal(fromEnvironment.serverId, 'environment-server');
	assert.equal(fromEnvironment.dataRootConfigured, true);
	assert.equal(fromEnvironment.uiBundleConfigured, true);
	assert.equal(Object.hasOwn(fromEnvironment, 'dataRoot'), false);
	assert.equal(Object.hasOwn(fromEnvironment, 'logSink'), false);

	const fromFlag = JSON.parse(
		runWithEnv(
			[
				'--status',
				'--server-id',
				'flag-server',
				'--data-root',
				'/private/flag-data',
			],
			{
				TERMINAY_SERVER_ID: 'environment-server',
				TERMINAY_DATA_ROOT: '/private/environment-data',
			},
		),
	);
	assert.equal(fromFlag.serverId, 'flag-server');
	assert.equal(fromFlag.dataRootConfigured, true);
});

test('clean foreground startup emits bounded readiness and responds to SIGTERM', async () => {
	const dataRoot = await mkdtemp(join(tmpdir(), 'terminay-server-smoke-'));
	const logSink = join(dataRoot, 'server.jsonl');
	const child = spawn(
		process.execPath,
		[
			cli,
			'--server-id',
			'clean-smoke',
			'--data-root',
			dataRoot,
			'--log-sink',
			logSink,
			'--endpoint',
			'loopback',
		],
		{
			env: {
				...process.env,
				TERMINAY_REMOTE_PAIRING_PIN: '736941',
				TERMINAY_SERVER_VERSION: '1.2.3',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);

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

	try {
		const ready = await new Promise((resolve, reject) => {
			let buffer = '';
			const onData = (chunk) => {
				buffer += chunk;
				const newline = buffer.indexOf('\n');
				if (newline < 0) return;
				child.stdout.off('data', onData);
				try {
					resolve(JSON.parse(buffer.slice(0, newline)));
				} catch (error) {
					reject(
						new Error(`invalid readiness JSON: ${error}; stderr=${stderr}`),
					);
				}
			};
			child.stdout.on('data', onData);
			child.once('error', reject);
			child.once('close', (code, signal) =>
				reject(
					new Error(
						`server exited before readiness code=${code} signal=${signal}; stdout=${stdout}; stderr=${stderr}`,
					),
				),
			);
		});

		assert.deepEqual(
			{
				...ready,
				protocolEndpoint: undefined,
				pairing: undefined,
			},
			{
				ready: true,
				serverId: 'clean-smoke',
				version: '1.2.3',
				endpoint: 'loopback',
				protocolEndpoint: undefined,
				dataRoot,
				logSink,
				healthEndpoint: null,
				pairing: undefined,
			},
		);
		const protocolEndpoint = new URL(ready.protocolEndpoint);
		assert.equal(protocolEndpoint.hostname, '127.0.0.1');
		assert.equal(protocolEndpoint.protocol, 'http:');
		const pairingUrl = new URL(ready.pairing.pairingUrl);
		assert.equal(pairingUrl.origin, protocolEndpoint.origin);
		const bootstrap = new URLSearchParams(pairingUrl.hash.slice(1));
		assert.equal(
			bootstrap.get('pairingSessionId'),
			ready.pairing.pairingSessionId,
		);
		assert.ok((bootstrap.get('pairingToken') ?? '').length >= 16);
		assert.equal(ready.pairing.requiresApproval, true);
		assert.ok(
			ready.pairing.expiresInSeconds > 0 &&
				ready.pairing.expiresInSeconds <= 300,
		);
		assert.equal(stderr, '');
	} finally {
		child.kill('SIGTERM');
		await new Promise((resolve) => {
			const timer = setTimeout(() => {
				child.kill('SIGKILL');
				resolve();
			}, 1_000);
			child.once('close', () => {
				clearTimeout(timer);
				resolve();
			});
		});
		await rm(dataRoot, { recursive: true, force: true });
	}
});
