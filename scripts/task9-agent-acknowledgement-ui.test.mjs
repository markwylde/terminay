import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const testDirectory = await mkdtemp(
	join(process.cwd(), '.task9-agent-ack-ui-'),
);

const outputPath = join(testDirectory, 'agents-sidebar.cjs');
const adapterOutputPath = join(testDirectory, 'server-agent-status-adapter.cjs');
await build({
	entryPoints: ['src/components/AgentsSidebar.tsx'],
	outfile: outputPath,
	bundle: true,
	format: 'cjs',
	platform: 'node',
	external: ['react'],
	loader: { '.css': 'empty' },
	logLevel: 'silent',
});

await build({
	entryPoints: ['electron/agentStatus/serverAdapter.ts'],
	outfile: adapterOutputPath,
	bundle: true,
	format: 'cjs',
	platform: 'node',
	logLevel: 'silent',
});

const { activateAgentFromSnapshot } = require(outputPath);
const { createServerAgentStatusIpcAdapter } = require(adapterOutputPath);

test.after(async () => {
	await rm(testDirectory, { recursive: true, force: true });
});

const entry = (overrides = {}) => ({
	entryId: 'terminal-1:session-1:agent-1',
	kind: 'root',
	provider: 'codex',
	agentId: 'agent-1',
	sessionId: 'session-1',
	activationTerminalSessionId: 'terminal-1',
	state: 'waiting',
	active: true,
	unread: true,
	...overrides,
});

test('sidebar activation focuses the snapshot terminal and acknowledges the exact unread entry', () => {
	const calls = [];
	const selected = entry();

	activateAgentFromSnapshot(
		selected,
		(terminalSessionId, activatedEntry) =>
			calls.push(['activate', terminalSessionId, activatedEntry.entryId]),
		(entryId) => calls.push(['acknowledge', entryId]),
	);

	assert.deepEqual(calls, [
		['activate', 'terminal-1', 'terminal-1:session-1:agent-1'],
		['acknowledge', 'terminal-1:session-1:agent-1'],
	]);
});

test('already acknowledged snapshot entries do not manufacture an acknowledgement', () => {
	const calls = [];

	activateAgentFromSnapshot(
		entry({ unread: false }),
		(terminalSessionId) => calls.push(['activate', terminalSessionId]),
		(entryId) => calls.push(['acknowledge', entryId]),
	);

	assert.deepEqual(calls, [['activate', 'terminal-1']]);
});

test('Desktop acknowledgement resolves the server-owned project/session identity before clearing', () => {
	const identityA = { projectId: 'project-a', serverId: 'desktop-local', sessionId: 'terminal-a' };
	const identityB = { projectId: 'project-b', serverId: 'desktop-local', sessionId: 'terminal-b' };
	const acknowledgements = [];
	const snapshot = {
		revision: 7,
		entries: {
			'entry-a': entry({ entryId: 'entry-a', activationTerminalSessionId: 'terminal-a' }),
			'entry-b': entry({ entryId: 'entry-b', activationTerminalSessionId: 'terminal-b' }),
		},
	};
	const agents = {
		acknowledge: (identity, entryId) => {
			acknowledgements.push([identity, entryId]);
			return true;
		},
		getSnapshot: () => snapshot,
		isSessionActive: () => true,
		subscribe: () => () => {},
	};
	const adapter = createServerAgentStatusIpcAdapter({
		agents,
		agentIdentity: (terminalSessionId) =>
			terminalSessionId === 'terminal-a'
				? identityA
				: terminalSessionId === 'terminal-b'
					? identityB
					: undefined,
	});

	assert.equal(adapter.markAcknowledged('entry-a'), true);
	assert.equal(adapter.markTerminalAcknowledged('terminal-a'), 1);
	assert.equal(adapter.markTerminalAcknowledged('missing-terminal'), 0);
	assert.deepEqual(acknowledgements, [
		[identityA, 'entry-a'],
		[identityA, undefined],
	]);
});
