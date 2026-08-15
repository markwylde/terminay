#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSecureWeriftCandidate } from './build-secure-werift-candidate.mjs';

function readOption(name) {
	const prefix = `--${name}=`;
	return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: 'inherit',
		});
		const timeout = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error(`${command} ${args.join(' ')} timed out.`));
		}, options.timeoutMs ?? 300_000);
		child.once('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once('exit', (code, signal) => {
			clearTimeout(timeout);
			if (code === 0 && signal === null) resolve();
			else reject(new Error(`${command} exited with code ${code} and signal ${signal}.`));
		});
	});
}

const mock = process.argv.includes('--mock');
const expectedArch = readOption('expected-arch');
if (expectedArch) assert.equal(process.arch, expectedArch);

if (!mock) {
	await run(process.execPath, ['scripts/server-ui-archive-integration-proof.mjs'], {
		cwd: process.cwd(), timeoutMs: 120_000,
	});
	process.stdout.write(`webrtc-compatibility=server-ui-archive:${process.arch}:ok\n`);
} else {

const proofRoot = await mkdtemp(path.join(tmpdir(), 'terminay-webrtc-compatibility-'));
try {
	const candidate = await buildSecureWeriftCandidate(path.join(proofRoot, 'runtime'));
	await copyFile(
		path.join(process.cwd(), 'build', 'webrtc-runtime', 'selection.json'),
		path.join(candidate.auditRoot, 'selection.json'),
	);
	const specification = 'e2e/webrtc-production-turn-routes.spec.ts';
	const args = [
		'playwright',
		'test',
		specification,
		'--workers=1',
		'--reporter=line',
		'--config=scripts/support/playwright-headless-webrtc-linux.config.mjs',
	];
	if (mock) args.push('--grep=mock hosted signaling peer');
	await run(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
		cwd: process.cwd(),
		env: {
			...process.env,
			TERMINAY_WEBRTC_SPIKE_ROOT: candidate.auditRoot,
			TERMINAY_WEBRTC_SPIKE_RUNTIME: 'werift',
			TERMINAY_WEBRTC_SELECTED_RUNTIME_ROOT: candidate.auditRoot,
			TERMINAY_WEBRTC_STAGED_RUNTIME_ROOT: candidate.artifactRoot,
		},
		timeoutMs: 120_000,
	});
	process.stdout.write(`webrtc-compatibility=mock:${process.arch}:ok\n`);
} finally {
	await rm(proofRoot, { force: true, recursive: true });
}
}
