import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { TerminalFileDrops, TerminalServiceError } from '../dist/index.js';

const identity = { serverId: 'server-a', projectId: 'project-a', sessionId: 'session-a' };
const owner = { clientId: 'client-a', connectionId: 'connection-a' };

async function withDrops(options, run) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-drop-unit-'));
	const directory = join(root, 'terminay-drops');
	const drops = new TerminalFileDrops({ directory, ...options });
	try {
		await run(drops, directory);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function eventually(check) {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.fail('condition was never met');
}

test('only the connection that began a drop may add to or finish it', async () => {
	await withDrops({}, async (drops) => {
		const id = await drops.begin(owner, identity, [{ name: 'a.txt', size: 2 }]);
		for (const other of [
			{ ...owner, connectionId: 'connection-b' },
			{ ...owner, clientId: 'client-b' },
		]) {
			await assert.rejects(
				() => drops.part(other, id, 0, 0, Uint8Array.of(1)),
				(error) => error instanceof TerminalServiceError && error.code === 'upload_not_found',
			);
			await assert.rejects(() => drops.finish(other, id), /not found/);
			await drops.cancel(other, id);
		}
		// Another connection's cancel did not end it.
		assert.equal(drops.size, 1);
		await drops.part(owner, id, 0, 0, Uint8Array.of(1, 2));
		assert.equal((await drops.finish(owner, id)).length, 1);
		assert.equal(drops.size, 0);
	});
});

test('an idle drop is abandoned and its folder removed', async () => {
	await withDrops({ idleMs: 20 }, async (drops, directory) => {
		const id = await drops.begin(owner, identity, [{ name: 'a.txt', size: 4 }]);
		await drops.part(owner, id, 0, 0, Uint8Array.of(1, 2));
		await eventually(async () => drops.size === 0 && (await readdir(directory)).length === 0);
	});
});

test('a closed connection abandons its drops and leaves others alone', async () => {
	await withDrops({}, async (drops, directory) => {
		const mine = await drops.begin(owner, identity, [{ name: 'a.txt', size: 4 }]);
		await drops.part(owner, mine, 0, 0, Uint8Array.of(1));
		const other = { clientId: 'client-a', connectionId: 'connection-b' };
		await drops.begin(other, identity, [{ name: 'b.txt', size: 4 }]);
		drops.closeConnection('connection-a');
		await eventually(async () => (await readdir(directory)).length === 1);
		assert.equal(drops.size, 1);
	});
});

test('an out-of-order part abandons the drop', async () => {
	await withDrops({}, async (drops, directory) => {
		const id = await drops.begin(owner, identity, [{ name: 'a.txt', size: 4 }]);
		await assert.rejects(() => drops.part(owner, id, 0, 2, Uint8Array.of(1)), /out of order/);
		assert.equal(drops.size, 0);
		assert.deepEqual(await readdir(directory), []);
	});
});

test('a connection may have only a few drops in progress', async () => {
	await withDrops({}, async (drops) => {
		for (let index = 0; index < 4; index += 1)
			await drops.begin(owner, identity, [{ name: 'a', size: 1 }]);
		await assert.rejects(
			() => drops.begin(owner, identity, [{ name: 'a', size: 1 }]),
			(error) => error.code === 'upload_limit',
		);
	});
});

test('offered files are validated before any folder is made', async () => {
	await withDrops({}, async (drops, directory) => {
		for (const files of [[], [{ name: '', size: 1 }], [{ name: 'a', size: -1 }], 'a', new Array(65).fill({ name: 'a', size: 1 })])
			await assert.rejects(() => drops.begin(owner, identity, files), (error) => error.code === 'invalid_bytes');
		assert.deepEqual(await readdir(directory).catch(() => []), []);
	});
});
