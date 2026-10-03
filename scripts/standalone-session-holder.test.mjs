import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

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

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function until(predicate, label, timeoutMs = 20_000) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await predicate();
		if (value) return value;
		if (Date.now() > deadline)
			throw new Error(`timed out waiting for ${label}`);
		await delay(25);
	}
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
	await until(
		async () => {
			if (stdout.includes('\n')) return true;
			if (child.exitCode !== null) throw new Error(`server exited before readiness: ${stderr}`);
			return false;
		},
		'server readiness',
	);
	assert.equal(JSON.parse(stdout.slice(0, stdout.indexOf('\n'))).ready, true);
	return {
		child,
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
		await delay(50);
		rmSync(dataRoot, { recursive: true, force: true });
	});

	// First start: a new data root is seeded with one terminal, held outside
	// the server process.
	server = await startServer(dataRoot);
	const [holder] = await until(() => {
		const records = readHolderRecords(dataRoot);
		return records.length === 1 ? records : undefined;
	}, 'the session holder');
	assert.notEqual(holder.pid, server.child.pid);
	const shells = await until(() => {
		const children = childrenOf(holder.pid);
		return children.length === 1 ? children : undefined;
	}, 'the seeded shell');
	const [shellPid] = shells;
	const before = terminalSessions(dataRoot);
	assert.equal(before.length, 1);
	assert.equal(before[0].status, 'running');
	// The shell is the holder's child, not the server's.
	assert.equal(childrenOf(server.child.pid).includes(shellPid), false);

	// Stop the way systemd stops a unit.
	await server.stop();
	assert.equal(isAlive(holder.pid), true, 'the holder ended with the server');
	assert.equal(isAlive(shellPid), true, 'the shell ended with the server');
	assert.equal(terminalSessions(dataRoot)[0].status, 'running', 'a stop recorded an exit');

	// Second start, same data root: same holder, same shell, nothing new.
	server = await startServer(dataRoot);
	await delay(300);
	assert.deepEqual(readHolderRecords(dataRoot).map((record) => record.pid), [holder.pid]);
	assert.deepEqual(childrenOf(holder.pid), [shellPid], 'a replacement shell was started');
	const after = terminalSessions(dataRoot);
	assert.deepEqual(after.map((session) => [session.id, session.status]), [[before[0].id, 'running']]);

	await server.stop();
	server = undefined;

	// Nothing is attached now, so the holder answers to its data-root credential.
	const client = await SessionHolderClient.connect(readHolderRecords(dataRoot)[0]);
	const held = await client.list();
	assert.deepEqual(held.map((session) => [session.sessionId, session.pid]), [[before[0].id, shellPid]]);
	await client.endAll().catch(() => undefined);
	await until(() => !isAlive(holder.pid) && !isAlive(shellPid), 'the holder and shell to end');
});
