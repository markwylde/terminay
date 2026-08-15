import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const { parseHostProcessTable } = await importProcessCwd();

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
				contents: `export { parseHostProcessTable } from ${JSON.stringify(new URL('../electron/processCwd.ts', import.meta.url).pathname)}`,
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
