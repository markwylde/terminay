import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createAgentTerminalContext } from '../dist/extensions/child.js';

/**
 * The terminal context a provider sees is built by the child from JSON the
 * adapter answers. The API promises `undefined` for a file, directory, or fact
 * that does not exist; JSON carries `null`. A provider that checks for
 * `undefined` and then reads the handle it got would throw on `null`, which
 * is exactly what a Claude session before its first prompt looked like.
 */
async function bridge() {
	const controller = new AbortController();
	const built = await createAgentTerminalContext(
		{
			contextId: randomUUID(),
			serverId: 'server',
			projectId: 'project',
			terminalSessionId: 'terminal',
			terminalIncarnationId: '1',
			providerId: 'example.agent/cli',
			shellPid: process.pid,
		},
		controller.signal,
	);
	return { files: built.terminal.observation.files, dispose: () => controller.abort() };
}

test('a home-relative file that does not exist resolves to undefined, never null', async () => {
	const { files, dispose } = await bridge();
	try {
		const missing = `.terminay-test-${randomUUID()}/missing.json`;
		assert.strictEqual(await files.resolveHomeRelative(missing), undefined);
		assert.strictEqual(await files.resolveHomeDirectory(`.terminay-test-${randomUUID()}`), undefined);
		assert.strictEqual(
			await files.resolveDirectoryRelativeToEnvironment('sessions', { environmentVariable: 'TERMINAY_TEST_UNSET_HOME' }),
			undefined,
		);
	} finally {
		dispose();
	}
});
