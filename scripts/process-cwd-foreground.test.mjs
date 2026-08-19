import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const {
	parseHostProcessTable,
	selectForegroundProcessFromTable,
	resolveTerminalForegroundProcess,
} = await importProcessCwd();

test('host process table parsing keeps a single snapshot walk session-scoped', () => {
	const table = parseHostProcessTable(`
  100   1   100 Ss   bash
  101 100   101 S+   sleep
  200   1   200 Ss   zsh
  201 200   201 S    node
  202 201   201 R+   codex
    1     0     1 Ss   /sbin/launchd
  532     1   532 Ss   /System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/FSEvents.framework/Versions/A/Support/fseventsd
`);
	assert.equal(table.get(100)?.command, 'bash');
	assert.equal(table.get(101)?.ppid, 100);
	assert.equal(table.get(101)?.pgid, 101);
	assert.equal(table.get(101)?.stat.includes('+'), true);
	assert.equal(table.get(202)?.command, 'codex');
	assert.equal(table.get(1)?.command, 'launchd');
	assert.equal(table.get(532)?.command, 'fseventsd');
});

test('login-shell argv0 is the configured shell, not a running job', () => {
	const table = parseHostProcessTable(`
  300   1   300 Ss   -zsh
  301 300   301 S+   sleep
`);
	assert.equal(table.get(300)?.command, 'zsh');
	assert.deepEqual(
		selectForegroundProcessFromTable(300, table, 'zsh'),
		{ command: 'sleep', consultProcessGroup: false },
	);
});

test('an idle shell has no non-shell foreground process', () => {
	const table = parseHostProcessTable(`
  400   1   400 Ss   zsh
`);
	assert.deepEqual(
		selectForegroundProcessFromTable(400, table, 'zsh'),
		{ command: 'zsh', consultProcessGroup: false },
	);
});

test('a session whose root pid is the running command does not consult TPGID', () => {
	const table = parseHostProcessTable(`
  700   1   700 S+   sleep
`);
	assert.deepEqual(
		selectForegroundProcessFromTable(700, table, 'sleep'),
		{ command: 'sleep', consultProcessGroup: false },
	);
});

test('a silent TUI with helper children is still a running process', () => {
	const table = parseHostProcessTable(`
  800   1   800 Ss   zsh
  801 800   801 S+   agent
  802 801   801 S    node
  803 801   801 S    node
`);
	assert.deepEqual(
		selectForegroundProcessFromTable(800, table, 'zsh'),
		{ command: 'agent', consultProcessGroup: false },
	);
});

test('a TUI whose helpers share the foreground group is still a running process', () => {
	const table = parseHostProcessTable(`
  810   1   810 Ss   zsh
  811 810   811 S+   agent
  812 811   811 S+   node
  813 811   811 S+   node
`);
	assert.deepEqual(
		selectForegroundProcessFromTable(810, table, 'zsh'),
		{ command: 'agent', consultProcessGroup: true },
	);
});

test('a non-job-control shell sharing its process group with a TUI is still busy', () => {
	const table = parseHostProcessTable(`
  820   1   820 Ss   dash
  821 820   820 S    node
  822 821   820 S    sleep
  823 821   820 S    sleep
`);
	assert.deepEqual(
		selectForegroundProcessFromTable(820, table, 'dash'),
		{ command: 'node', consultProcessGroup: true },
	);
});

test('a background job in another process group is not a running foreground process', () => {
	const table = parseHostProcessTable(`
  900   1   900 Ss   zsh
  901 900   901 S    sleep
`);
	assert.deepEqual(
		selectForegroundProcessFromTable(900, table, 'zsh'),
		{ command: 'zsh', consultProcessGroup: true },
	);
});

test('a unique foreground child is the running process', () => {
	const table = parseHostProcessTable(`
  500   1   500 Ss   zsh
  501 500   501 S+   python3
`);
	assert.deepEqual(
		selectForegroundProcessFromTable(500, table, 'zsh'),
		{ command: 'python3', consultProcessGroup: false },
	);
});

test('a login wrapper around the shell is not a running job', () => {
	const table = parseHostProcessTable(`
  600   1   600 Ss   login
  601 600   600 Ss   zsh
`);
	assert.deepEqual(
		selectForegroundProcessFromTable(600, table, 'login'),
		{ command: 'zsh', consultProcessGroup: false },
	);
});

test('a live silent TUI with helper children is not the idle shell', {
	skip: process.platform === 'win32',
}, async () => {
	const script = [
		"const { spawn } = require('node:child_process');",
		"for (let i = 0; i < 4; i++) spawn('sleep', ['30'], { stdio: 'ignore' });",
		"process.stdout.write('ready\\n');",
		'setInterval(() => {}, 1000);',
	].join('');
	const child = spawn('/bin/sh', ['-c', `${process.execPath} -e ${JSON.stringify(script)}`], {
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	try {
		await waitForStdout(child, 'ready');
		const name = await resolveTerminalForegroundProcess(child.pid);
		assert.notEqual(name, 'sh');
		assert.notEqual(name, 'dash');
		assert.notEqual(name, 'bash');
		assert.notEqual(name, 'zsh');
	} finally {
		killProcessTree(child.pid);
	}
});

test('an already-aborted close observation fails closed without a host-wide scan', async () => {
	const controller = new AbortController();
	controller.abort(new Error('foreground observation aborted'));
	await assert.rejects(
		resolveTerminalForegroundProcess(process.pid, controller.signal),
		/aborted/u,
	);
});

function waitForStdout(child, marker) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error('timed out waiting for the silent TUI to start'));
		}, 5_000);
		child.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once('exit', (code) => {
			clearTimeout(timer);
			reject(new Error(`silent TUI exited ${code}`));
		});
		let output = '';
		child.stdout.on('data', (chunk) => {
			output += chunk;
			if (!output.includes(marker)) return;
			clearTimeout(timer);
			resolve();
		});
	});
}

function killProcessTree(pid) {
	const result = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' });
	for (const line of (result.stdout ?? '').split('\n')) {
		const childPid = Number.parseInt(line.trim(), 10);
		if (Number.isSafeInteger(childPid) && childPid > 0) killProcessTree(childPid);
	}
	try {
		process.kill(pid, 'SIGKILL');
	} catch {
		// The tree may already have exited.
	}
}

async function importProcessCwd() {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-process-cwd-'));
	const outputPath = join(directory, 'process-cwd.mjs');
	try {
		await build({
			bundle: true,
			format: 'esm',
			outfile: outputPath,
			platform: 'node',
			stdin: {
				contents: `export { parseHostProcessTable, selectForegroundProcessFromTable, resolveTerminalForegroundProcess } from ${JSON.stringify(new URL('../electron/processCwd.ts', import.meta.url).pathname)}`,
				loader: 'ts',
				resolveDir: process.cwd(),
			},
			target: 'node24',
		});
		return await import(outputPath);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
