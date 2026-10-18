import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	readHolderRecords,
	SessionHolderClient,
} from '../packages/server-core/dist/index.js';

/**
 * The standalone server, started for real, stopped with SIGTERM the way a
 * service manager stops it, and started again on the same data root. The
 * terminal it seeded must be the same process afterwards.
 */

const cli = 'apps/terminay-server/dist/cli.js';
const skip =
	process.platform === 'win32'
		? 'the session holder is not supported on Windows'
		: false;

/**
 * Whether a process is still running. A process that has exited but has not
 * been reaped still answers a signal, and in a container whose first process
 * does not reap orphans it stays that way, so its state is read instead.
 */
function isAlive(pid) {
	try {
		const state = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], {
			encoding: 'utf8',
		}).trim();
		return state.length > 0 && !state.startsWith('Z');
	} catch {
		return false;
	}
}

/**
 * Resolves once a process this test did not start has exited. Nothing it owns
 * tells the test, so the operating system's own exit notification is waited
 * on: `caffeinate -w` (kqueue) on macOS, `waitpid` (pidfd) on Linux. Both
 * return at once for a process already gone, and both see an exited but
 * unreaped process as exited, which is what `isAlive` reports too.
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

/** Direct children of a process, as the kernel reports them. */
function childrenOf(pid) {
	try {
		return execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
			.split('\n')
			.filter(Boolean)
			.map(Number);
	} catch {
		return [];
	}
}

/** Every process below one, however deep. */
function descendantsOf(pid) {
	const found = [];
	for (const child of childrenOf(pid)) found.push(child, ...descendantsOf(child));
	return found;
}

/** `terminay-server end-sessions`, as `daemon uninstall` runs it. */
function endSessions(dataRoot) {
	return spawnSync(process.execPath, [cli, 'end-sessions', '--data-root', dataRoot], {
		encoding: 'utf8',
		env: { ...process.env, TERMINAY_SESSION_HOLDER: '1' },
	});
}

async function startServer(dataRoot) {
	const child = spawn(
		process.execPath,
		[cli, '--server-id', 'holder-smoke', '--data-root', dataRoot, '--endpoint', 'loopback'],
		{
			env: { ...process.env, TERMINAY_SESSION_HOLDER: '1', TERMINAY_SERVER_VERSION: '1.2.3' },
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);
	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
	child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
	const exited = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
	// Readiness is the first line on stdout. The server either prints it or
	// exits; both are events. It prints it only once its terminals are up: the
	// default terminal of a new data root is created, through the session
	// holder, before readiness, and an existing holder is attached before it.
	await new Promise((resolve, reject) => {
		const ready = () => {
			if (!stdout.includes('\n')) return;
			child.stdout.off('data', ready);
			child.off('close', early);
			resolve();
		};
		const early = () => reject(new Error(`server exited before readiness: ${stderr}`));
		child.stdout.on('data', ready);
		child.once('close', early);
		ready();
	});
	assert.equal(JSON.parse(stdout.slice(0, stdout.indexOf('\n'))).ready, true);
	return {
		child,
		/** Session-holder reports this server has written to its service log. */
		holderReports: () =>
			stderr
				.split('\n')
				.filter((line) => line.startsWith('[terminay-server] session holder '))
				.map((line) => JSON.parse(line.slice('[terminay-server] session holder '.length))),
		async stop() {
			child.kill('SIGTERM');
			const result = await exited;
			assert.equal(result.code, 0, `server did not stop cleanly: ${stderr}`);
		},
	};
}

function terminalSessions(dataRoot) {
	const state = JSON.parse(readFileSync(join(dataRoot, 'workspace.v3.json'), 'utf8'));
	return Object.values(state.terminalSessions ?? {});
}

test('a standalone server restarts onto the terminal it already had', { skip }, async (t) => {
	const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), 'th-')));
	let server;
	t.after(async () => {
		server?.child.kill('SIGKILL');
		for (const record of readHolderRecords(dataRoot)) {
			try { process.kill(record.pid, 'SIGKILL'); } catch { /* already gone */ }
		}
		rmSync(dataRoot, { recursive: true, force: true });
	});

	// First start: a new data root is seeded with one terminal, held outside
	// the server process.
	server = await startServer(dataRoot);
	const records = readHolderRecords(dataRoot);
	assert.equal(records.length, 1, 'the session holder');
	const [holder] = records;
	assert.notEqual(holder.pid, server.child.pid);
	const shells = childrenOf(holder.pid);
	assert.equal(shells.length, 1, 'the seeded shell');
	const [shellPid] = shells;
	const before = terminalSessions(dataRoot);
	assert.equal(before.length, 1);
	assert.equal(before[0].status, 'running');
	// The shell is the holder's child, not the server's.
	assert.equal(childrenOf(server.child.pid).includes(shellPid), false);
	// The service log says a holder was started, and names it by process.
	const identity = { pid: holder.pid, startedAt: holder.startedAt };
	assert.deepEqual(
		server.holderReports().filter((report) => report.kind === 'launched').map((report) => report.holder),
		[identity],
	);

	// Stop the way systemd stops a unit.
	await server.stop();
	assert.equal(isAlive(holder.pid), true, 'the holder ended with the server');
	assert.equal(isAlive(shellPid), true, 'the shell ended with the server');
	assert.equal(terminalSessions(dataRoot)[0].status, 'running', 'a stop recorded an exit');

	// Second start, same data root: same holder, same shell, nothing new.
	server = await startServer(dataRoot);
	assert.deepEqual(readHolderRecords(dataRoot).map((record) => record.pid), [holder.pid]);
	// The restart is in the log as an attach to the same holder, same build,
	// with its one live session, and nothing was launched or drained.
	const [attached, ...others] = server
		.holderReports()
		.filter((report) => ['attached', 'launched', 'drained', 'closed'].includes(report.kind));
	assert.deepEqual(others, []);
	assert.deepEqual(
		{ ...attached, buildId: undefined, limitMs: undefined },
		{
			kind: 'attached',
			holder: identity,
			buildId: undefined,
			sameBuild: true,
			draining: false,
			liveSessions: 1,
			endedSessions: 0,
			limitMs: undefined,
		},
	);
	// A report never names the session or where anything lives.
	const logged = JSON.stringify(server.holderReports());
	assert.equal(logged.includes(before[0].id), false);
	assert.equal(logged.includes(dataRoot), false);
	assert.deepEqual(childrenOf(holder.pid), [shellPid], 'a replacement shell was started');
	const after = terminalSessions(dataRoot);
	assert.deepEqual(after.map((session) => [session.id, session.status]), [[before[0].id, 'running']]);

	await server.stop();
	server = undefined;

	// Nothing is attached now, so the holder answers to its data-root credential.
	const client = await SessionHolderClient.connect(readHolderRecords(dataRoot)[0]);
	const held = await client.list();
	assert.deepEqual(held.map((session) => [session.sessionId, session.pid]), [[before[0].id, shellPid]]);
	await client.close();

	// What `daemon uninstall` runs once the service is stopped.
	const ended = endSessions(dataRoot);
	assert.equal(ended.status, 0, ended.stderr);
	assert.deepEqual(JSON.parse(ended.stdout), { holders: 1, sessions: 1, remaining: 0 });
	await Promise.all([exitOf(holder.pid), exitOf(shellPid)]);
	assert.equal(isAlive(holder.pid), false);
	assert.equal(isAlive(shellPid), false);
	assert.deepEqual(readHolderRecords(dataRoot), []);

	// With nothing held, it is a no-op rather than an error.
	const again = endSessions(dataRoot);
	assert.equal(again.status, 0, again.stderr);
	assert.deepEqual(JSON.parse(again.stdout), { holders: 0, sessions: 0, remaining: 0 });
});

test('end-sessions refuses to take terminals away from a running server', { skip }, async (t) => {
	const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), 'th-')));
	let server;
	t.after(async () => {
		server?.child.kill('SIGKILL');
		for (const record of readHolderRecords(dataRoot)) {
			try { process.kill(record.pid, 'SIGKILL'); } catch { /* already gone */ }
		}
		rmSync(dataRoot, { recursive: true, force: true });
	});
	server = await startServer(dataRoot);
	const [holder] = readHolderRecords(dataRoot);
	const [shellPid] = childrenOf(holder.pid);

	const refused = endSessions(dataRoot);
	assert.equal(refused.status, 1);
	assert.equal(JSON.parse(refused.stdout).remaining, 1);
	assert.match(refused.stderr, /stop the server first/);
	assert.equal(isAlive(shellPid), true, 'a running server lost its terminal');
	assert.equal(terminalSessions(dataRoot)[0].status, 'running');

	await server.stop();
	server = undefined;
	assert.equal(endSessions(dataRoot).status, 0);
	await Promise.all([exitOf(holder.pid), exitOf(shellPid)]);
	assert.equal(isAlive(holder.pid), false);
	assert.equal(isAlive(shellPid), false);
});

/**
 * The systemd unit stops the server process only (`KillMode=process`), so
 * nothing but the server itself cleans up after it. This is the worst case of
 * that: the server is killed outright, with no chance to shut anything down.
 * Everything it started must go away on its own, except the session holder and
 * the shells it holds, which are meant to stay.
 */
test('a killed server leaves nothing behind but the session holder and its shells', { skip }, async (t) => {
	const dataRoot = realpathSync(mkdtempSync(join(tmpdir(), 'th-')));
	let server;
	t.after(async () => {
		server?.child.kill('SIGKILL');
		for (const record of readHolderRecords(dataRoot)) {
			try { process.kill(record.pid, 'SIGKILL'); } catch { /* already gone */ }
		}
		rmSync(dataRoot, { recursive: true, force: true });
	});
	server = await startServer(dataRoot);
	const [holder] = readHolderRecords(dataRoot);
	const [shellPid] = childrenOf(holder.pid);
	// Extension hosts and watchers are started before readiness, so they are
	// in the list.

	const kept = new Set([holder.pid, ...descendantsOf(holder.pid)]);
	const others = descendantsOf(server.child.pid).filter((pid) => !kept.has(pid));

	server.child.kill('SIGKILL');
	await new Promise((resolve) => server.child.once('close', resolve));
	server = undefined;

	await Promise.all(others.map(exitOf));
	assert.deepEqual(others.filter((pid) => isAlive(pid)), [], "the server's other children exited");
	assert.equal(isAlive(holder.pid), true, 'the holder died with the server');
	assert.equal(isAlive(shellPid), true, 'the shell died with the server');

	assert.equal(endSessions(dataRoot).status, 0);
	await Promise.all([exitOf(holder.pid), exitOf(shellPid)]);
	assert.equal(isAlive(holder.pid), false);
	assert.equal(isAlive(shellPid), false);
});
