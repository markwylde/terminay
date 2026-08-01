import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PACKAGE_VERSION = '0.32.3';
const proofPath = fileURLToPath(
	new URL('./spikes/headless-webrtc-node-datachannel.mjs', import.meta.url),
);

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			...options,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const stderr = [];
		const stdout = [];
		const timeout = setTimeout(() => {
			child.kill('SIGKILL');
			reject(
				new Error(
					`${command} ${args.join(' ')} did not terminate within ${
						options.timeoutMs ?? 60_000
					}ms.`,
				),
			);
		}, options.timeoutMs ?? 60_000);

		child.stdout.on('data', (chunk) => stdout.push(chunk));
		child.stderr.on('data', (chunk) => stderr.push(chunk));
		child.once('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once('exit', (code, signal) => {
			clearTimeout(timeout);
			resolve({
				code,
				signal,
				stderr: Buffer.concat(stderr).toString(),
				stdout: Buffer.concat(stdout).toString(),
			});
		});
	});
}

async function commandPath(command) {
	const result = await run('/bin/sh', ['-lc', `command -v ${command}`]);
	return result.code === 0 ? result.stdout.trim() : null;
}

async function inspectBinary(binaryPath) {
	const inspection = {};
	for (const [name, args] of [
		['file', [binaryPath]],
		['ldd', [binaryPath]],
		['readelf', ['-d', binaryPath]],
	]) {
		if (await commandPath(name)) {
			const result = await run(name, args);
			assert.equal(result.code, 0, result.stderr || result.stdout);
			inspection[name] = result.stdout.trim();
		}
	}
	return inspection;
}

test('node-datachannel installs in isolation and exits after bounded headless traffic', {
	timeout: 120_000,
}, async () => {
	const tempRoot = await mkdtemp(
		path.join(os.tmpdir(), 'terminay-node-datachannel-'),
	);
	try {
		await writeFile(
			path.join(tempRoot, 'package.json'),
			`${JSON.stringify(
				{
					name: 'terminay-node-datachannel-spike',
					private: true,
					type: 'module',
				},
				null,
				2,
			)}\n`,
		);

		const compilerCommands = [
			'cc',
			'c++',
			'gcc',
			'g++',
			'clang',
			'clang++',
			'cmake',
			'make',
			'ninja',
		];
		const availableCompilerCommands = (
			await Promise.all(
				compilerCommands.map(async (command) => ({
					command,
					path: await commandPath(command),
				})),
			)
		).filter(({ path: commandLocation }) => commandLocation);
		if (process.env.TERMINAY_SPIKE_REQUIRE_NO_COMPILER === '1') {
			assert.deepEqual(
				availableCompilerCommands,
				[],
				`Compiler/build tools unexpectedly available: ${JSON.stringify(
					availableCompilerCommands,
				)}`,
			);
		}

		const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
		const install = await run(
			npmCommand,
			[
				'install',
				'--no-save',
				'--omit=dev',
				'--foreground-scripts',
				`node-datachannel@${PACKAGE_VERSION}`,
			],
			{
				cwd: tempRoot,
				env: {
					...process.env,
					npm_config_audit: 'false',
					npm_config_fund: 'false',
				},
				timeoutMs: 90_000,
			},
		);
		assert.equal(
			install.code,
			0,
			`Isolated install failed.\n${install.stdout}\n${install.stderr}`,
		);
		assert.equal(install.signal, null);

		const installedPackage = JSON.parse(
			await readFile(
				path.join(tempRoot, 'node_modules', 'node-datachannel', 'package.json'),
				'utf8',
			),
		);
		assert.equal(installedPackage.version, PACKAGE_VERSION);

		const binaryPath = path.join(
			tempRoot,
			'node_modules',
			'node-datachannel',
			'build',
			'Release',
			'node_datachannel.node',
		);
		await access(binaryPath);
		const binaryInspection = await inspectBinary(binaryPath);

		const proof = await run(process.execPath, [proofPath], {
			env: {
				...process.env,
				TERMINAY_NODE_DATACHANNEL_SPIKE_ROOT: tempRoot,
			},
			timeoutMs: 60_000,
		});
		assert.equal(proof.signal, null);
		assert.equal(proof.code, 0, proof.stderr || proof.stdout);
		const evidence = JSON.parse(proof.stdout.trim());

		assert.equal(evidence.nodeDatachannelVersion, PACKAGE_VERSION);
		assert.deepEqual(evidence.channels, ['api', 'asset', 'terminal']);
		assert.equal(evidence.binaryBytes, 16 * 1024 * 1024);
		assert.equal(
			evidence.binaryDigest,
			'2755ce9870e28532a2dc174d69313ae6784873b17a7e67f12622641bbd4defb4',
		);
		assert.equal(evidence.orderedMessagesPerDirectionPerChannel, 1_000);
		assert.ok(evidence.applicationPressureWaits > 0);
		if (process.env.TERMINAY_SPIKE_EXPECT_FALSE_SEND === '1') {
			assert.ok(evidence.falseSendResults > 0);
		}
		assert.ok(evidence.maxInFlightBytes <= evidence.ackWindowBytes);
		assert.deepEqual(evidence.activeNonStdioHandles, []);

		console.log(
			JSON.stringify({
				availableCompilerCommands,
				binaryInspection,
				evidence,
				installUsedIsolatedTempProject: true,
			}),
		);
	} finally {
		await rm(tempRoot, { force: true, recursive: true });
	}
});
