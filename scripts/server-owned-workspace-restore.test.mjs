import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/**
 * What a restored workspace contains is server policy, and the reason it was
 * wrong is that a host held a copy of it. These assertions are about where the
 * code lives rather than what it computes, because that is what went wrong: the
 * daemon restored a workspace differently from Desktop for as long as each had
 * its own bootstrap deciding it.
 */

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const HOSTS = [
	'../electron/serverTerminalAuthority.ts',
	'../apps/terminay-server/src/cli.ts',
];

test('the restore has exactly one call site, and it is the server composition', async () => {
	const composition = await read('../packages/server-core/src/composition.ts');
	assert.match(composition, /restoreWorkspaceOnStartup\(/u);

	for (const host of HOSTS) {
		const source = await read(host);
		assert.doesNotMatch(
			source,
			/restoreWorkspaceOnStartup/u,
			`${host} must not run the restore itself`,
		);
		// Reaping is the half a host is most likely to reach for directly, and
		// reaching for it is how the two hosts diverged.
		assert.doesNotMatch(
			source,
			/discardStale\w*TerminalState/u,
			`${host} must not decide which terminals are stale`,
		);
	}
});

test('a host supplies only how a session is made', async () => {
	for (const host of HOSTS) {
		const source = await read(host);
		assert.match(
			source,
			/workspaceStartup: \{/u,
			`${host} must declare its startup seam`,
		);
		assert.match(source, /createTerminal:/u);
	}
});

test('neither host keeps its own copy of the seeding policy', async () => {
	const desktop = await read(HOSTS[0]);
	const daemon = await read(HOSTS[1]);
	// The presentation ordering, the remote retry, and the first-run seed were
	// three separate opinions living in one host. They are one now.
	assert.doesNotMatch(desktop, /restoredLocalProjects/u);
	assert.doesNotMatch(desktop, /seedRemoteProjectTerminal/u);
	assert.doesNotMatch(desktop, /REMOTE_TERMINAL_SEED_DEADLINE_MS/u);
	assert.doesNotMatch(daemon, /ensureDefaultTerminalSession/u);
	// And the flag that made the daemon seed on a first run only.
	assert.doesNotMatch(daemon, /if \(serverComposition\.workspaceWasCreated\)/u);
});

test('the server names the condition rather than a host', async () => {
	const workspace = await read('../packages/server-core/src/workspace.ts');
	assert.match(workspace, /discardStaleTerminalState\(\)/u);
	// The old name asserted the wrong precondition, and is a fair part of why the
	// daemon never called it.
	assert.doesNotMatch(workspace, /discardStaleLocalTerminalState/u);
});
