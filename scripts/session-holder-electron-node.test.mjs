import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	createSessionHolderPtyFactory,
	launchDetachedSessionHolder,
	readHolderRecords,
	TerminalService,
} from '../packages/server-core/dist/index.js';

/**
 * Desktop starts its session holder with Electron's own binary in Node mode,
 * from the built `dist-electron` entry. This runs exactly that process and
 * drives a real shell through it, then "restarts the server" and adopts it.
 *
 * It needs `npm run build:app` (or `vite build`) to have produced the entry.
 */

const entry = fileURLToPath(
	new URL('../dist-electron/sessionHolderEntry.js', import.meta.url),
);
const electronBinary = createRequire(import.meta.url)('electron');
const skip = !existsSync(entry)
	? 'dist-electron/sessionHolderEntry.js is not built'
	: process.platform === 'win32'
		? 'the session holder is not supported on Windows'
		: false;

const text = (bytes) => new TextDecoder().decode(bytes);
const bytesOf = (value) => new TextEncoder().encode(value);

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolves once a process this test did not start has exited. Nothing it owns
 * tells the test, so the operating system's own exit notification is waited
 * on: `caffeinate -w` (kqueue) on macOS, `waitpid` (pidfd) on Linux. Both
 * return at once for a process already gone.
 */
function exitOf(pid) {
	const [command, args] =
		process.platform === 'darwin'
			? ['caffeinate', ['-w', String(pid)]]
			: ['waitpid', [String(pid)]];
	return new Promise((resolve, reject) => {
		const waiter = spawn(command, args, { stdio: 'ignore' });
		waiter.once('error', reject);
		waiter.once('exit', () => resolve());
	});
}

/** Resolves once the session's retained output includes `marker`, checked
 * now and on every terminal event the service publishes. */
function printed(service, sessionId, marker) {
	return new Promise((resolve) => {
		let stop;
		const check = () => {
			if (!outputOf(service, sessionId).includes(marker)) return false;
			stop?.();
			resolve();
			return true;
		};
		if (check()) return;
		stop = service.onEvent(check);
	});
}

function server(dataRoot) {
	const factory = createSessionHolderPtyFactory({
		dataRoot,
		buildId: 'desktop-build',
		limitMs: 60_000,
		launch: ({ env }) =>
			launchDetachedSessionHolder(electronBinary, [entry], {
				...process.env,
				ELECTRON_RUN_AS_NODE: '1',
				...env,
			}),
	});
	return {
		factory,
		service: new TerminalService({ serverId: 'desktop', ptyFactory: factory }),
	};
}

function outputOf(service, sessionId) {
	return text(
		service.readRetainedOutput(sessionId, { maxBytes: 1024 * 1024 }).bytes,
	);
}

test(
	"Electron's Node mode runs the built session holder and a shell outlives its server",
	{ skip },
	async (t) => {
		const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), 'th-')));
		t.after(async () => {
			for (const record of readHolderRecords(dataRoot)) {
				try {
					process.kill(record.pid, 'SIGKILL');
				} catch {
					/* already gone */
				}
			}
			rmSync(dataRoot, { recursive: true, force: true });
		});

		const first = server(dataRoot);
		await first.service.createSession({
			projectId: 'p1',
			sessionId: 's1',
			shellPath: '/bin/sh',
			args: [],
			cwd: dataRoot,
			cols: 80,
			rows: 24,
		});
		const pid = first.service.getSession('s1').pid;
		const answered = printed(first.service, 's1', 'electron-42');
		await first.service.write('s1', bytesOf('echo electron-$((6*7))\n'));
		await answered;
		const [holder] = readHolderRecords(dataRoot);
		assert.notEqual(holder.pid, process.pid);

		await first.service.shutdown({ detach: true });
		await first.factory.detach();
		assert.equal(isAlive(pid), true, 'the shell died with its server');
		assert.equal(isAlive(holder.pid), true);

		const second = server(dataRoot);
		const [held] = await second.factory.start();
		assert.equal(held.sessionId, 's1');
		const adopted = await second.factory.adopt('s1');
		second.service.adoptSession({
			identity: { serverId: 'desktop', projectId: 'p1', sessionId: 's1' },
			cwd: adopted.record.cwd,
			createdAt: adopted.record.createdAt,
			cols: adopted.record.cols,
			rows: adopted.record.rows,
			process: adopted.process,
			outputPosition: adopted.from,
		});
		assert.equal(second.service.getSession('s1').pid, pid);
		assert.ok(outputOf(second.service, 's1').includes('electron-42'));

		const answeredAgain = printed(second.service, 's1', 'again-10');
		await second.service.write('s1', bytesOf('echo again-$((9+1))\n'));
		await answeredAgain;

		await second.service.shutdown();
		await second.factory.endAll();
		await Promise.all([exitOf(pid), exitOf(holder.pid)]);
		assert.equal(isAlive(pid), false);
		assert.equal(isAlive(holder.pid), false);
		assert.deepEqual(readHolderRecords(dataRoot), []);
	},
);
