#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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
const hostedRepo = readOption('hosted-repo');
const hostedScope = readOption('hosted-scope') ?? 'full';
const expectedArch = readOption('expected-arch');
assert.notEqual(mock, Boolean(hostedRepo), 'choose exactly one of --mock or --hosted-repo=PATH');
assert.match(hostedScope, /^(?:bootstrap|full)$/, 'hosted scope must be bootstrap or full');
assert.ok(hostedRepo || hostedScope === 'full', '--hosted-scope requires --hosted-repo');
if (expectedArch) assert.equal(process.arch, expectedArch);

const proofRoot = await mkdtemp(path.join(tmpdir(), 'terminay-webrtc-compatibility-'));
try {
	if (hostedRepo) {
		await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:app'], {
			cwd: process.cwd(),
			timeoutMs: 180_000,
		});
	}
	const candidate = await buildSecureWeriftCandidate(path.join(proofRoot, 'runtime'));
	const specification = mock
		? 'e2e/webrtc-production-turn-routes.spec.ts'
		: 'e2e/webrtc-headless-node-host.spec.ts';
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
			...(hostedRepo ? {
				TERMINAY_HOSTED_PROOF_SCOPE: hostedScope,
				TERMINAY_HOSTED_SERVER_REPO: path.resolve(hostedRepo),
			} : {}),
			TERMINAY_WEBRTC_SPIKE_ROOT: candidate.auditRoot,
			TERMINAY_WEBRTC_SPIKE_RUNTIME: 'werift',
			TERMINAY_WEBRTC_STAGED_RUNTIME_ROOT: candidate.artifactRoot,
		},
		timeoutMs: hostedRepo ? 300_000 : 120_000,
	});
	const proofName = mock ? 'mock' : `hosted-${hostedScope}`;
	process.stdout.write(`webrtc-compatibility=${proofName}:${process.arch}:ok\n`);
} finally {
	await rm(proofRoot, { force: true, recursive: true });
}
