import assert from 'node:assert/strict';
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
  100   1 Ss   bash
  101 100 S+   sleep
  200   1 Ss   zsh
  201 200 S    node
  202 201 R+   codex
    1     0 Ss   /sbin/launchd
  532     1 Ss   /System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/FSEvents.framework/Versions/A/Support/fseventsd
`);
	assert.equal(table.get(100)?.command, 'bash');
	assert.equal(table.get(101)?.ppid, 100);
	assert.equal(table.get(101)?.stat.includes('+'), true);
	assert.equal(table.get(202)?.command, 'codex');
	assert.equal(table.get(1)?.command, 'launchd');
	assert.equal(table.get(532)?.command, 'fseventsd');
});

test('login-shell argv0 is the configured shell, not a running job', () => {
	const table = parseHostProcessTable(`
  300   1 Ss   -zsh
  301 300 S+   sleep
`);
	assert.equal(table.get(300)?.command, 'zsh');
	assert.deepEqual(
		selectForegroundProcessFromTable(300, table, 'zsh'),
		{ command: 'sleep', consultProcessGroup: false },
	);
});

test('an idle shell has no non-shell foreground process', () => {
	const table = parseHostProcessTable(`
  400   1 Ss   zsh
`);
	assert.deepEqual(
		selectForegroundProcessFromTable(400, table, 'zsh'),
		{ command: 'zsh', consultProcessGroup: false },
	);
});

test('a session whose root pid is the running command does not consult TPGID', () => {
	const table = parseHostProcessTable(`
  700   1 S+   sleep
`);
	assert.deepEqual(
		selectForegroundProcessFromTable(700, table, 'sleep'),
		{ command: 'sleep', consultProcessGroup: false },
	);
});

test('a unique foreground child is the running process', () => {
	const table = parseHostProcessTable(`
  500   1 Ss   zsh
  501 500 S+   python3
`);
	assert.deepEqual(
		selectForegroundProcessFromTable(500, table, 'zsh'),
		{ command: 'python3', consultProcessGroup: false },
	);
});

test('a login wrapper around the shell is not a running job', () => {
	const table = parseHostProcessTable(`
  600   1 Ss   login
  601 600 Ss   zsh
`);
	assert.deepEqual(
		selectForegroundProcessFromTable(600, table, 'login'),
		{ command: 'zsh', consultProcessGroup: false },
	);
});

test('an already-aborted close observation fails closed without a host-wide scan', async () => {
	const controller = new AbortController();
	controller.abort(new Error('foreground observation aborted'));
	await assert.rejects(
		resolveTerminalForegroundProcess(process.pid, controller.signal),
		/aborted/u,
	);
});

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
