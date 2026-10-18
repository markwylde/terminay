import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
	closeSync,
	existsSync,
	mkdtempSync,
	openSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	watch,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { SessionHolderClient } from '../packages/server-core/dist/index.js';

/**
 * The packaged application, with terminals held by a session holder.
 *
 * Only a packaged build exercises this: node-pty locates its spawn helper by
 * rewriting `app.asar` in its own path, so where the holder is loaded from
 * decides whether any shell can start. A signed beta whose holder was loaded
 * from `app.asar.unpacked` started the holder and then failed every spawn with
 * `posix_spawnp failed`, which no unpackaged test could have seen.
 */

const appPath = resolve(
	process.env.TERMINAY_PACKAGED_APP ?? 'release/0.0.0/mac-arm64/Terminay.app',
);
const skip =
	process.platform !== 'darwin'
		? 'the packaged macOS application is only built on macOS'
		: !existsSync(appPath)
			? `no packaged application at ${appPath}`
			: false;

function processState(pid) {
	try {
		return execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {
			encoding: 'utf8',
		}).trim();
	} catch {
		return '';
	}
}
const isAlive = (pid) => {
	const state = processState(pid);
	return state.length > 0 && !state.startsWith('Z');
};
const childrenOf = (pid) => {
	try {
		return execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
			.split('\n')
			.filter(Boolean)
			.map(Number);
	} catch {
		return [];
	}
};
const commandOf = (pid) => {
	try {
		return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
			encoding: 'utf8',
		}).trim();
	} catch {
		return '';
	}
};

function holderRecords(userData) {
	const directory = join(userData, 'session-holder');
	if (!existsSync(directory)) return [];
	return readdirSync(directory)
		.filter((name) => name.endsWith('.json'))
		.flatMap((name) => {
			try {
				return [JSON.parse(readFileSync(join(directory, name), 'utf8'))];
			} catch {
				return [];
			}
		});
}

/**
 * Resolves with the first value `read` gives, asked now and again whenever
 * anything under `paths` changes. What this waits for is written there: the
 * holder's record, and the workspace the application saves once its seeded
 * terminal exists (so after the holder has started that terminal's shell).
 * `read` may throw to fail the wait.
 */
function onChangeUnder(paths, read) {
	return new Promise((resolveValue, rejectValue) => {
		const watchers = [];
		let settled = false;
		const finish = (callback, value) => {
			if (settled) return;
			settled = true;
			for (const watcher of watchers) watcher.close();
			callback(value);
		};
		const check = () => {
			if (settled) return;
			try {
				const value = read();
				if (value) finish(resolveValue, value);
			} catch (error) {
				finish(rejectValue, error);
			}
		};
		for (const path of paths) {
			const watcher = watch(path, { recursive: true }, check);
			watcher.on('error', (error) => finish(rejectValue, error));
			watchers.push(watcher);
		}
		check();
	});
}

/** Resolves once a process this test did not start has exited, through the
 * operating system's own notification (kqueue, via `caffeinate -w`). */
function exitOf(pid) {
	return new Promise((resolveExit, rejectExit) => {
		const waiter = spawn('caffeinate', ['-w', String(pid)], { stdio: 'ignore' });
		waiter.once('error', rejectExit);
		waiter.once('exit', () => resolveExit());
	});
}

test(
	'the packaged application starts its terminal in a session holder that outlives it',
	{ skip },
	async (t) => {
		// A short, real path: the holder's socket lives under it.
		const userData = realpathSync(mkdtempSync(join(tmpdir(), 'th-')));
		// Output goes to a file, not a pipe: the application's helper processes
		// inherit its stdio, and a pipe one of them still holds would keep this
		// test process waiting long after the test itself had finished.
		const logDirectory = mkdtempSync(join(tmpdir(), 'th-log-'));
		const logPath = join(logDirectory, 'app.log');
		const logFile = openSync(logPath, 'a');
		const readOutput = () => {
			try {
				return readFileSync(logPath, 'utf8');
			} catch {
				return '';
			}
		};
		const app = spawn(
			join(appPath, 'Contents/MacOS/Terminay'),
			['--headless', '--disable-gpu', '--use-mock-keychain'],
			{
				env: {
					...process.env,
					TERMINAY_USER_DATA_DIR: userData,
					TERMINAY_SESSION_HOLDER: '1',
				},
				stdio: ['ignore', logFile, logFile],
				// Its own process group, so teardown can end the application and
				// every helper it started without naming anything else.
				detached: true,
			},
		);
		closeSync(logFile);
		const exited = new Promise((resolveExit) => app.once('exit', resolveExit));
		t.after(async () => {
			const holders = holderRecords(userData).map((record) => record.pid);
			// The application's process group, then the holders, which left it.
			for (const pid of [-app.pid, ...holders]) {
				try {
					process.kill(pid, 'SIGKILL');
				} catch {
					/* already gone */
				}
			}
			await Promise.all([exited, ...holders.map(exitOf)]);
			rmSync(userData, { recursive: true, force: true });
			rmSync(logDirectory, { recursive: true, force: true });
		});

		const [holder] = await onChangeUnder([userData], () => {
			const records = holderRecords(userData);
			return records.length === 1 ? records : undefined;
		});
		assert.notEqual(holder.pid, app.pid);
		assert.match(
			commandOf(holder.pid),
			/sessionHolderEntry\.js/,
			'the holder is not the packaged holder entry',
		);

		// The seeded terminal: a shell that is the holder's child. This is the
		// assertion a mis-located spawn helper fails.
		// A spawn failure is logged; the log is watched as well, so it fails the
		// wait as soon as it is written.
		const [shell] = await onChangeUnder([userData, logPath], () => {
			const output = readOutput();
			if (/posix_spawnp failed|spawn_failed/u.test(output))
				throw new Error(
					`the packaged holder could not start a shell:\n${output.slice(-1500)}`,
				);
			const children = childrenOf(holder.pid);
			return children.length >= 1 ? children : undefined;
		});
		assert.equal(isAlive(shell), true);

		// Quitting the application leaves the holder and its shell running.
		app.kill('SIGTERM');
		await exited;
		assert.equal(isAlive(holder.pid), true, 'the holder ended with the app');
		assert.equal(isAlive(shell), true, 'the shell ended with the app');
		// Not merely still exiting: with the application gone the holder answers
		// to its data-root credential, and still holds that shell, running.
		const client = await SessionHolderClient.connect(holder);
		const held = await client.list();
		await client.close();
		assert.deepEqual(
			held.map((session) => [session.pid, session.exit]),
			[[shell, undefined]],
		);
	},
);
