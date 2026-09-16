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

test('an environment root resolves as its own directory, so a provider can wait on it', async () => {
	const { spawn } = await import('node:child_process');
	const { mkdtempSync, realpathSync, rmSync } = await import('node:fs');
	const { tmpdir } = await import('node:os');
	const { join } = await import('node:path');
	const home = realpathSync(mkdtempSync(join(tmpdir(), 'terminay-env-root-')));
	// The adapter reads the terminal's environment from its process, so the
	// variable must be on a real process below the "shell".
	const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { env: { ...process.env, TERMINAY_TEST_AGENT_HOME: home }, stdio: 'ignore' });
	const controller = new AbortController();
	try {
		await new Promise((resolve) => setTimeout(resolve, 50));
		const built = await createAgentTerminalContext(
			{ contextId: randomUUID(), serverId: 'server', projectId: 'project', terminalSessionId: 'terminal', terminalIncarnationId: '1', providerId: 'example.agent/cli', shellPid: child.pid },
			controller.signal,
		);
		const root = await built.terminal.observation.files.resolveDirectoryRelativeToEnvironment('.', { environmentVariable: 'TERMINAY_TEST_AGENT_HOME' });
		assert.ok(root, 'the root itself resolves');
		assert.strictEqual(await built.directoryPath(root), home);
		assert.strictEqual(
			await built.terminal.observation.files.resolveDirectoryRelativeToEnvironment('missing', { environmentVariable: 'TERMINAY_TEST_AGENT_HOME' }),
			undefined,
		);
	} finally {
		controller.abort();
		child.kill();
		rmSync(home, { recursive: true, force: true });
	}
});
