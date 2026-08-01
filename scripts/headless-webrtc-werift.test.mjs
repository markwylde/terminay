import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const fixtureDir = fileURLToPath(
	new URL('./spikes/werift-fixture/', import.meta.url),
);
const spikeSourcePath = fileURLToPath(
	new URL('./spikes/headless-webrtc-werift.mjs', import.meta.url),
);

function runSpike(spikePath) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [spikePath], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const stderr = [];
		const stdout = [];
		const timeout = setTimeout(() => {
			child.kill('SIGKILL');
			reject(
				new Error(
					'The displayless werift spike did not terminate after 15 seconds.',
				),
			);
		}, 15_000);

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

test('werift proves a bounded displayless Node data-channel runtime', async () => {
	const tempDir = await mkdtemp(join(tmpdir(), 'terminay-werift-spike-'));
	let result;

	try {
		await Promise.all([
			copyFile(join(fixtureDir, 'package.json'), join(tempDir, 'package.json')),
			copyFile(
				join(fixtureDir, 'package-lock.json'),
				join(tempDir, 'package-lock.json'),
			),
			copyFile(spikeSourcePath, join(tempDir, 'headless-webrtc-werift.mjs')),
		]);

		await execFileAsync(
			process.platform === 'win32' ? 'npm.cmd' : 'npm',
			['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
			{
				cwd: tempDir,
				timeout: 60_000,
			},
		);
		result = await runSpike(join(tempDir, 'headless-webrtc-werift.mjs'));
	} finally {
		await rm(tempDir, { force: true, recursive: true });
	}

	assert.equal(result.signal, null);
	assert.equal(result.code, 0, result.stderr || result.stdout);

	const evidence = JSON.parse(result.stdout.trim());
	assert.deepEqual(evidence.channels, ['api', 'asset', 'terminal']);
	assert.equal(evidence.asset.bytes, 8 * 1024 * 1024);
	assert.ok(evidence.asset.pressureWaits > 0);
	assert.ok(
		evidence.asset.maxBufferedAmount <=
			evidence.asset.highWaterBytes + evidence.asset.chunkBytes,
	);
	assert.ok(evidence.hostIceCandidates > 0);
	assert.ok(evidence.clientIceCandidates > 0);
	assert.equal(evidence.orderedMessagesPerDirectionPerChannel, 32);
	assert.ok(
		evidence.activeResourcesAfterClose.every(
			(resource) => resource === 'PipeWrap',
		),
	);
});
