import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

const FIXTURE_PATH = resolve('scripts/spikes/pty-electron-main-supervisor.cjs');
const HOST_PATH = resolve('dist-electron/ptyHost.js');
const RESULT_PREFIX = 'TERMINAY_ELECTRON_PTY_PROOF=';

test('a real Electron main process supervises the built PTY host over IPC', {
	skip:
		process.platform !== 'darwin' &&
		'This Electron Desktop supervisor proof currently covers macOS only.',
	timeout: 20_000,
}, async () => {
	await Promise.all([access(FIXTURE_PATH), access(HOST_PATH)]);
	const electronPath = (await import('electron')).default;
	const env = {
		...process.env,
		TERMINAY_PTY_HOST_PATH: HOST_PATH,
	};
	delete env.ELECTRON_RUN_AS_NODE;

	const child = spawn(electronPath, [FIXTURE_PATH], {
		cwd: resolve('.'),
		env,
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let stdout = '';
	let stderr = '';
	child.stdout.on('data', (chunk) => {
		stdout += chunk.toString();
	});
	child.stderr.on('data', (chunk) => {
		stderr += chunk.toString();
	});
	const exit = await new Promise((resolveExit, rejectExit) => {
		child.once('error', rejectExit);
		child.once('exit', (code, signal) => {
			resolveExit({ code, signal });
		});
	});
	assert.deepEqual(
		exit,
		{ code: 0, signal: null },
		`Electron supervisor failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
	);
	const resultLine = stdout
		.split('\n')
		.find((line) => line.startsWith(RESULT_PREFIX));
	assert.ok(
		resultLine,
		`Electron supervisor did not emit its proof.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
	);
	const result = JSON.parse(resultLine.slice(RESULT_PREFIX.length));
	assert.equal(result.appReady, true);
	assert.equal(result.processType, 'browser');
	assert.equal(result.electronRunAsNode, false);
	assert.match(result.electronVersion, /^\d+\.\d+\.\d+/);
	assert.equal(result.supervisorExecPath, electronPath);
	assert.notEqual(result.interactive.childExecPath, electronPath);
	assert.match(
		result.interactive.childExecPath,
		/Electron Helper\.app\/Contents\/MacOS\/Electron Helper$/,
	);
	assert.deepEqual(
		{
			cwd: result.interactive.cwd,
			exitCode: result.interactive.exitCode,
			resize: result.interactive.resize,
			rootPidRemoved: result.interactive.rootPidRemoved,
			signal: result.interactive.signal,
			utf8: result.interactive.utf8,
		},
		{
			cwd: '/tmp',
			exitCode: 13,
			resize: { cols: 97, rows: 31 },
			rootPidRemoved: true,
			signal: null,
			utf8: true,
		},
	);
	assert.equal(result.cleanup.rootPidRemoved, true);
	assert.equal(result.cleanup.childPidRemoved, true);
	assert.ok(result.cleanup.shutdownMs < 3_000);
});
