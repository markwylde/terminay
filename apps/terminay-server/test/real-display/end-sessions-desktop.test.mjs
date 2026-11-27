/**
 * `terminay-server end-sessions`, which an uninstall runs, ends a desktop a
 * server left running. Runs in the real-display container.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
	DESKTOP_SESSION_SCRIPT,
	DISPLAY_LAUNCHER_SCRIPT,
	desktopSessionDirectory,
} from '@terminay/remote-desktop/session';
import {
	adoptOrStartDesktopHolder,
	connectDesktopHolder,
	desktopHolderLockHeld,
	examineServerDesktopHost,
	hostFacts,
} from '@terminay/server-core';

const run = promisify(execFile);
const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const launcher = path.join(desktopSessionDirectory(), DISPLAY_LAUNCHER_SCRIPT);
const sessionScript = path.join(desktopSessionDirectory(), DESKTOP_SESSION_SCRIPT);
const skip =
	process.platform === 'linux' && existsSync('/usr/bin/Xtigervnc') && existsSync('/usr/bin/xfwm4')
		? undefined
		: 'needs the desktop packages';

const pidOf = async (pattern) =>
	(await run('pgrep', ['-f', pattern]).then(
		({ stdout }) => stdout.trim().split('\n').filter(Boolean),
		() => [],
	)).map(Number);

/** `end-sessions` against a data root, with nothing of this shell's server. */
async function endSessions(dataRoot) {
	const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('TERMINAY_')));
	const { stdout } = await run(process.execPath, [cli, 'end-sessions'], {
		env: { ...env, TERMINAY_DATA_ROOT: dataRoot },
		timeout: 60_000,
	});
	return JSON.parse(stdout.trim().split('\n').at(-1));
}

test('end-sessions ends a running desktop through its holder and leaves nothing of it', { skip }, async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), 'tes-'));
	const dataRoot = path.join(root, 'data');
	const home = path.join(root, 'home');
	// Where a standalone server keeps its desktop.
	const directory = path.join(dataRoot, 'desktop');
	await mkdir(dataRoot, { mode: 0o700 });
	await mkdir(home, { mode: 0o700 });
	t.after(async () => {
		const connection = await connectDesktopHolder(directory);
		if (connection.outcome === 'adopted') await connection.client.stop();
		await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});
	const support = await examineServerDesktopHost(hostFacts(launcher));
	assert.deepEqual(support.missing, []);
	const adoption = await adoptOrStartDesktopHolder(directory, {
		dataRoot,
		home,
		programs: {
			displayServer: support.programs.displayServer,
			passwordTool: support.programs.passwordTool,
			python: support.programs.python,
			shell: support.programs.shell,
		},
		launcher,
		sessionScript,
		env: { PATH: process.env.PATH, HOME: home, LANG: 'C.UTF-8' },
	});
	assert.equal(adoption.outcome, 'ready', JSON.stringify(adoption));
	const deadline = Date.now() + 40_000;
	let state = await adoption.client.status();
	while (state.phase !== 'running') {
		assert.notEqual(state.phase, 'failed', state.reason);
		assert.ok(Date.now() < deadline, 'the desktop did not start');
		await new Promise((resolve) => setTimeout(resolve, 500));
		state = await adoption.client.status();
	}
	// The server that started it is gone; the desktop is not.
	adoption.client.disconnect();
	assert.equal(await desktopHolderLockHeld(directory), true);
	assert.equal((await pidOf(`Xtigervnc :${state.display}`)).length, 1);

	const report = await endSessions(dataRoot);
	assert.equal(report.desktop, 'ended');
	await new Promise((resolve) => setTimeout(resolve, 500));
	assert.deepEqual(await pidOf(`Xtigervnc :${state.display}`), []);
	assert.deepEqual(await pidOf('holderEntry.js'), []);
	assert.equal(await desktopHolderLockHeld(directory), false);
	assert.equal((await connectDesktopHolder(directory)).outcome, 'absent');

	// With no desktop there is nothing to end, and it says so.
	assert.equal((await endSessions(dataRoot)).desktop, 'none');
});
