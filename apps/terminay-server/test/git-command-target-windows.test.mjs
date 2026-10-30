import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

/**
 * Where Git in a Windows terminal reports (ADR-0082): a directory, because Node
 * cannot serve the Unix socket Git targets elsewhere.
 */

const { gitCommandSocketHostOptions } = await import('../dist/index.js');

const base = {
	serverId: 'server-1',
	platform: 'win32',
	temporaryDirectory: 'C:\\Users\\ada\\AppData\\Local\\Temp',
};

test('a Windows server with a data directory reports through a fixed directory under it', async () => {
	const dataDirectory = await mkdtemp(join(tmpdir(), 'tgcw-'));
	try {
		const options = gitCommandSocketHostOptions({ ...base, dataDirectory });
		assert.equal(options.socketPlacement, 'trace-directory');
		assert.ok(options.traceDirectory.endsWith('\\run\\git-trace'), options.traceDirectory);
		assert.equal(options.tokenKey.length, 32, 'tokens survive a restart, as on a socket');
		const again = gitCommandSocketHostOptions({ ...base, dataDirectory });
		assert.equal(again.traceDirectory, options.traceDirectory, 'the next run has the same address');
		assert.deepEqual(again.tokenKey, options.tokenKey);
	} finally {
		await rm(dataDirectory, { recursive: true, force: true });
	}
});

test('a Windows server without a data directory reports through a directory for the run', () => {
	const options = gitCommandSocketHostOptions(base);
	assert.equal(options.socketPlacement, 'trace-directory');
	assert.match(options.traceDirectory, /^C:\\Users\\ada\\AppData\\Local\\Temp\\terminay-git-[0-9a-f]{12}-[0-9a-f]{8}$/);
	assert.equal(options.tokenKey, undefined);
});

test('elsewhere Git still reports through a socket', () => {
	const options = gitCommandSocketHostOptions({ ...base, platform: 'linux', temporaryDirectory: '/tmp' });
	assert.equal(options.traceDirectory, undefined);
	assert.match(options.socketPath, /^\/tmp\/terminay-git-.*\.sock$/);
});
