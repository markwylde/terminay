import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AgentStatusService,
	ProcessAncestry,
	ProjectAgentScope,
	SessionSourceBridge,
	TerminalActivityService,
} from '../dist/index.js';

const serverId = 'server-1';
const extensionId = 'com.example.agents';
const sourceId = `${extensionId}/agents`;
const harnesses = [
	{ id: 'claude-code', displayName: 'Claude Code' },
	{ id: 'codex', displayName: 'Codex' },
];

/**
 * A bridge over an in-memory process tree. `parents` maps pid → parent pid;
 * PTY shells are registered as terminals. Nothing reads the real machine.
 */
async function fixture({
	parents = {},
	projects = { 'project-1': '/work/app' },
	worktrees = {},
	clock = { now: 1_000 },
	bridgeOptions = {},
} = {}) {
	const activity = new TerminalActivityService({ serverId });
	const agents = new AgentStatusService({ activity, now: () => clock.now });
	await agents.start();
	const reads = [];
	const ancestry = new ProcessAncestry({
		readParent: async (pid) => {
			reads.push(pid);
			return parents[pid];
		},
	});
	const watchers = [];
	const scope = new ProjectAgentScope({
		canonicalize: async (path) => path,
		resolveWorktrees: async (root) => worktrees[root],
		watch: (directory, onChange) => {
			const watcher = { directory, onChange, closed: false };
			watchers.push(watcher);
			return () => {
				watcher.closed = true;
			};
		},
		ramp: { intervalsMs: [1] },
	});
	for (const [projectId, root] of Object.entries(projects))
		scope.setProject(projectId, root);
	await scope.settled();
	const bridge = new SessionSourceBridge({
		agents,
		scope,
		ancestry,
		now: () => clock.now,
		...bridgeOptions,
	});
	bridge.registerSource(
		{ id: sourceId, extensionId, harnesses },
		harnesses.map((harness) => harness.id),
	);
	const terminal = (sessionId, projectId, shellPid) => {
		const identity = { serverId, projectId, sessionId };
		activity.register(identity);
		agents.register(identity);
		agents.terminalStarted(identity, shellPid);
		return identity;
	};
	const publish = async (publication) => {
		const result = await bridge.publish({ extensionId, sourceId, publication });
		await bridge.settled();
		return result;
	};
	const entries = () => Object.values(agents.getSnapshot().entries);
	const root = (id) =>
		entries().find((entry) => entry.kind === 'root' && entry.agentId === id);
	return {
		activity,
		agents,
		ancestry,
		scope,
		bridge,
		terminal,
		publish,
		entries,
		root,
		reads,
		watchers,
		clock,
	};
}

const session = (overrides = {}) => ({
	id: 'session-1',
	harness: 'claude-code',
	pid: 500,
	cwd: '/work/app',
	status: 'running',
	...overrides,
});

test('a session inside a Terminay terminal binds to it by process ancestry', async () => {
	const { terminal, publish, root } = await fixture({
		parents: { 500: 400, 400: 300, 300: 1 },
	});
	terminal('terminal-1', 'project-1', 300);
	assert.deepEqual(await publish({ reset: [session()] }), { ok: true });
	const entry = root('session-1');
	assert.equal(entry.activationTerminalSessionId, 'terminal-1');
	assert.equal(entry.terminalSessionId, 'terminal-1');
	assert.equal(entry.external, false);
	assert.equal(entry.state, 'working');
	assert.equal(entry.provider, sourceId);
	assert.equal(entry.harness, 'claude-code');
	assert.equal(entry.providerDisplayName, 'Claude Code');
	assert.deepEqual(entry.projectIds, ['project-1']);
});

test('two terminals in one directory each own the session their process tree holds', async () => {
	const { terminal, publish, root } = await fixture({
		parents: { 501: 301, 502: 302 },
	});
	terminal('terminal-1', 'project-1', 301);
	terminal('terminal-2', 'project-1', 302);
	await publish({
		reset: [session({ id: 'a', pid: 501 }), session({ id: 'b', pid: 502 })],
	});
	assert.equal(root('a').activationTerminalSessionId, 'terminal-1');
	assert.equal(root('b').activationTerminalSessionId, 'terminal-2');
});

test('a session no terminal owns is external: inert, never unread, still in its project', async () => {
	const { publish, root, agents } = await fixture({ parents: { 900: 1 } });
	await publish({
		reset: [
			session({ pid: 900, status: 'waiting', waitingFor: 'approve Bash' }),
		],
	});
	const entry = root('session-1');
	assert.equal(entry.external, true);
	assert.equal(entry.activationTerminalSessionId, null);
	assert.equal(entry.terminalSessionId, null);
	assert.equal(entry.state, 'waiting');
	assert.equal(entry.unread, false);
	assert.deepEqual(entry.projectIds, ['project-1']);
	assert.equal(
		Object.keys(agents.getSnapshotForProject('project-1').entries).length,
		1,
	);
	assert.equal(
		Object.keys(agents.getSnapshotForProject('project-2').entries).length,
		0,
	);
});

test('project scope: subdirectory, linked worktree outside the root, unrelated directory', async () => {
	const { publish, root } = await fixture({
		parents: {},
		worktrees: {
			'/work/app': {
				commonDir: '/work/app/.git',
				worktrees: ['/work/app', '/elsewhere/app-feature'],
			},
		},
	});
	await publish({
		reset: [
			session({ id: 'sub', pid: 11, cwd: '/work/app/packages/api' }),
			session({ id: 'linked', pid: 12, cwd: '/elsewhere/app-feature/src' }),
			session({ id: 'unrelated', pid: 13, cwd: '/work/application' }),
		],
	});
	assert.deepEqual(root('sub').projectIds, ['project-1']);
	assert.deepEqual(root('linked').projectIds, ['project-1']);
	assert.deepEqual(root('unrelated').projectIds, []);
});

test('a worktree added later is picked up by the metadata watch, not a timer', async () => {
	const worktrees = {
		'/work/app': { commonDir: '/work/app/.git', worktrees: ['/work/app'] },
	};
	const { publish, root, watchers, scope, bridge } = await fixture({
		worktrees,
	});
	await publish({ reset: [session({ pid: 12, cwd: '/elsewhere/new-tree' })] });
	assert.deepEqual(root('session-1').projectIds, []);
	assert.ok(watchers.some((watcher) => watcher.directory === '/work/app/.git'));
	worktrees['/work/app'] = {
		commonDir: '/work/app/.git',
		worktrees: ['/work/app', '/elsewhere/new-tree'],
	};
	for (const watcher of watchers) if (!watcher.closed) watcher.onChange();
	await scope.settled();
	await bridge.settled();
	assert.deepEqual(root('session-1').projectIds, ['project-1']);
});

test('a project outside any repository owns only its own tree', async () => {
	const { publish, root } = await fixture({ worktrees: {} });
	await publish({
		reset: [
			session({ id: 'in', pid: 1, cwd: '/work/app/x' }),
			session({ id: 'out', pid: 2, cwd: '/work/other' }),
		],
	});
	assert.deepEqual(root('in').projectIds, ['project-1']);
	assert.deepEqual(root('out').projectIds, []);
});

test("a bound session that leaves its project directory stays in its terminal's project", async () => {
	const { terminal, publish, root } = await fixture({ parents: { 500: 300 } });
	terminal('terminal-1', 'project-1', 300);
	await publish({ reset: [session({ cwd: '/tmp/scratch' })] });
	assert.equal(root('session-1').activationTerminalSessionId, 'terminal-1');
	assert.deepEqual(root('session-1').projectIds, ['project-1']);
});

test('a turn completing while unacknowledged is done and unread; startup idle is idle', async () => {
	const clock = { now: 1_000 };
	const { terminal, publish, root } = await fixture({
		parents: { 500: 300, 600: 300 },
		clock,
	});
	terminal('terminal-1', 'project-1', 300);
	await publish({
		reset: [
			session(),
			session({
				id: 'old',
				pid: 600,
				status: 'idle',
				lastTurn: 'completed',
				lastTurnEndedAt: 10,
			}),
		],
	});
	assert.equal(root('old').state, 'idle');
	assert.equal(root('old').unread, false);
	clock.now = 2_000;
	await publish({
		upserts: [
			session({
				status: 'idle',
				lastTurn: 'completed',
				lastTurnEndedAt: 1_900,
			}),
		],
	});
	assert.equal(root('session-1').state, 'done');
	assert.equal(root('session-1').completionOutcome, 'success');
	assert.equal(root('session-1').unread, true);
});

test('running to idle without an end time is still a completion', async () => {
	const clock = { now: 1_000 };
	const { terminal, publish, root } = await fixture({
		parents: { 500: 300 },
		clock,
	});
	terminal('terminal-1', 'project-1', 300);
	await publish({ reset: [session()] });
	clock.now = 1_500;
	await publish({ upserts: [session({ status: 'idle' })] });
	assert.equal(root('session-1').state, 'done');
});

test('acknowledging a done entry keeps it read; the next idle snapshot settles to idle', async () => {
	const clock = { now: 1_000 };
	const { terminal, publish, root, agents } = await fixture({
		parents: { 500: 300 },
		clock,
	});
	const identity = terminal('terminal-1', 'project-1', 300);
	await publish({ reset: [session()] });
	clock.now = 2_000;
	await publish({
		upserts: [
			session({
				status: 'idle',
				lastTurn: 'completed',
				lastTurnEndedAt: 1_900,
			}),
		],
	});
	clock.now = 3_000;
	assert.equal(agents.acknowledge(identity, root('session-1').entryId), true);
	assert.equal(root('session-1').unread, false);
	await publish({
		upserts: [
			session({
				status: 'idle',
				lastTurn: 'completed',
				lastTurnEndedAt: 1_900,
				title: 'Renamed',
			}),
		],
	});
	assert.equal(root('session-1').state, 'idle');
	assert.equal(root('session-1').unread, false);
});

test('waiting, blocked, failed, and interrupted map to the canonical model', async () => {
	const clock = { now: 1_000 };
	const { publish, root } = await fixture({ clock });
	await publish({
		reset: [
			session({
				id: 'w',
				pid: 1,
				status: 'waiting',
				waitingFor: 'approve Bash',
			}),
			session({ id: 'b', pid: 2, status: 'blocked' }),
			session({ id: 'f', pid: 3 }),
			session({ id: 'i', pid: 4 }),
		],
	});
	assert.equal(root('w').state, 'waiting');
	assert.equal(root('w').waitingReason, 'approve Bash');
	assert.equal(root('b').state, 'blocked');
	clock.now = 2_000;
	await publish({
		upserts: [
			session({
				id: 'f',
				pid: 3,
				status: 'idle',
				lastTurn: 'failed',
				lastTurnEndedAt: 1_500,
				error: 'rate limited',
			}),
			session({
				id: 'i',
				pid: 4,
				status: 'idle',
				lastTurn: 'interrupted',
				lastTurnEndedAt: 1_500,
			}),
		],
	});
	assert.equal(root('f').state, 'done');
	assert.equal(root('f').completionOutcome, 'error');
	assert.equal(root('f').summary, 'rate limited');
	assert.equal(root('i').completionOutcome, 'cancelled');
});

test('metadata-only changes keep state, acknowledgement, and the root', async () => {
	const { terminal, publish, root, entries } = await fixture({
		parents: { 500: 300 },
	});
	terminal('terminal-1', 'project-1', 300);
	await publish({ reset: [session()] });
	const before = root('session-1');
	await publish({
		upserts: [session({ title: 'Refactor', model: 'opus', tool: 'Bash' })],
	});
	const after = root('session-1');
	assert.equal(entries().filter((entry) => entry.kind === 'root').length, 1);
	assert.equal(after.entryId, before.entryId);
	assert.equal(after.state, 'working');
	assert.equal(after.displayName, 'Refactor');
	assert.deepEqual(after.model, { id: 'opus' });
	assert.deepEqual(
		after.activeTools.map((tool) => tool.name),
		['Bash'],
	);
});

test('a snapshot without status leaves the state unchanged', async () => {
	const { publish, root } = await fixture();
	await publish({ reset: [session({ status: 'waiting' })] });
	const { status: _status, ...withoutStatus } = session();
	await publish({ upserts: [withoutStatus] });
	assert.equal(root('session-1').state, 'waiting');
});

test('subagents nest under their root and change only themselves', async () => {
	const { publish, root, entries } = await fixture();
	await publish({
		reset: [
			session({
				subagents: [
					{
						id: 'child-1',
						type: 'explore',
						title: 'Search',
						status: 'running',
					},
					{
						id: 'child-2',
						parentId: 'child-1',
						type: 'general',
						status: 'running',
					},
				],
			}),
		],
	});
	const children = () => entries().filter((entry) => entry.kind === 'subagent');
	assert.equal(children().length, 2);
	const nested = children().find((entry) => entry.agentId === 'child-2');
	assert.equal(
		nested.parentEntryId,
		children().find((entry) => entry.agentId === 'child-1').entryId,
	);
	assert.equal(root('session-1').openSubagents, 2);
	await publish({
		upserts: [
			session({
				subagents: [
					{
						id: 'child-1',
						type: 'explore',
						title: 'Search',
						status: 'completed',
					},
					{
						id: 'child-2',
						parentId: 'child-1',
						type: 'general',
						status: 'running',
					},
				],
			}),
		],
	});
	assert.equal(
		children().find((entry) => entry.agentId === 'child-1').state,
		'done',
	);
	assert.equal(root('session-1').state, 'working');
	await publish({ upserts: [session({ subagents: [] })] });
	assert.equal(children().length, 0);
});

test('a session the source removes retires its entry and children', async () => {
	const { publish, entries } = await fixture();
	await publish({
		reset: [
			session({ subagents: [{ id: 'c', type: 't', status: 'running' }] }),
			session({ id: 'other', pid: 7 }),
		],
	});
	assert.equal(entries().length, 3);
	await publish({ removals: ['session-1'] });
	assert.deepEqual(
		entries().map((entry) => entry.agentId),
		['other'],
	);
});

test('an invalid snapshot rejects the whole batch without touching the store', async () => {
	const { publish, agents } = await fixture();
	await publish({ reset: [session()] });
	const revision = agents.getSnapshot().revision;
	const result = await publish({
		upserts: [
			session({ id: 'ok', pid: 2 }),
			{ ...session({ id: 'bad' }), transcript: 'secret' },
		],
	});
	assert.equal(result.ok, false);
	assert.equal(agents.getSnapshot().revision, revision);
});

test('a harness that is switched off is dropped by the host and refused afterwards', async () => {
	const { bridge, publish, entries } = await fixture();
	await publish({
		reset: [session(), session({ id: 'codex-1', harness: 'codex', pid: 2 })],
	});
	bridge.setEnabledHarnesses(sourceId, ['claude-code']);
	assert.deepEqual(
		entries().map((entry) => entry.harness),
		['claude-code'],
	);
	assert.equal(
		(
			await publish({
				upserts: [session({ id: 'codex-2', harness: 'codex', pid: 3 })],
			})
		).ok,
		false,
	);
});

test('a closed terminal revokes its binding and the entry becomes external', async () => {
	const { terminal, publish, root, agents } = await fixture({
		parents: { 500: 300 },
	});
	const identity = terminal('terminal-1', 'project-1', 300);
	await publish({ reset: [session()] });
	assert.equal(root('session-1').external, false);
	agents.terminalExited(identity);
	const entry = root('session-1');
	assert.equal(entry.external, true);
	assert.equal(entry.activationTerminalSessionId, null);
});

test('a terminal started after the session binds it from the cached chain without reading again', async () => {
	const { terminal, publish, root, bridge, reads } = await fixture({
		parents: { 500: 400, 400: 300, 300: 1 },
	});
	await publish({ reset: [session()] });
	assert.equal(root('session-1').external, true);
	const readsBefore = reads.length;
	terminal('terminal-1', 'project-1', 300);
	await bridge.settled();
	assert.equal(root('session-1').activationTerminalSessionId, 'terminal-1');
	assert.equal(reads.length, readsBefore);
});

test('ancestry is read once per session, not on every snapshot', async () => {
	const { terminal, publish, reads } = await fixture({
		parents: { 500: 400, 400: 300 },
	});
	terminal('terminal-1', 'project-1', 300);
	await publish({ reset: [session()] });
	const readsAfterFirst = reads.length;
	for (let index = 0; index < 5; index += 1)
		await publish({ upserts: [session({ title: `t${index}` })] });
	assert.equal(reads.length, readsAfterFirst);
});

test('an overflowing source is told to resend without a store call', async () => {
	const { bridge, agents } = await fixture({
		bridgeOptions: { maximumQueuedPublications: 1 },
	});
	const revision = agents.getSnapshot().revision;
	const first = bridge.publish({
		extensionId,
		sourceId,
		publication: { reset: [session()] },
	});
	const second = await bridge.publish({
		extensionId,
		sourceId,
		publication: { reset: [session({ id: 'x' })] },
	});
	assert.deepEqual(second, {
		ok: false,
		resend: true,
		failure: 'session source publication queue is full',
	});
	assert.equal((await first).ok, true);
	assert.equal(agents.getSnapshot().revision, revision + 1);
});

test('a publication after the source is retired reaches no store', async () => {
	const { bridge, agents, publish } = await fixture();
	await publish({ reset: [session()] });
	bridge.retireSource(sourceId);
	assert.equal(Object.keys(agents.getSnapshot().entries).length, 0);
	const revision = agents.getSnapshot().revision;
	assert.equal(
		(
			await bridge.publish({
				extensionId,
				sourceId,
				publication: { reset: [session()] },
			})
		).ok,
		false,
	);
	assert.equal(agents.getSnapshot().revision, revision);
});

test('another extension cannot publish for a source it does not own', async () => {
	const { bridge } = await fixture();
	const result = await bridge.publish({
		extensionId: 'com.evil.ext',
		sourceId,
		publication: { reset: [session()] },
	});
	assert.equal(result.ok, false);
});

test('disabling agent status clears entries and refuses new ones', async () => {
	const { agents, publish } = await fixture();
	await publish({ reset: [session()] });
	agents.setIntegrationEnabled(false);
	assert.equal(Object.keys(agents.getSnapshot().entries).length, 0);
	await publish({ upserts: [session({ id: 'later', pid: 9 })] });
	assert.equal(Object.keys(agents.getSnapshot().entries).length, 0);
});

test("a bound root drives its terminal's provider activity; an external one never does", async () => {
	const { terminal, publish, activity } = await fixture({
		parents: { 500: 300 },
	});
	const identity = terminal('terminal-1', 'project-1', 300);
	await publish({ reset: [session(), session({ id: 'ext', pid: 999 })] });
	const snapshot = activity.snapshot().sessions[identity.sessionId];
	assert.equal(snapshot.providerState, 'working');
	assert.equal(snapshot.agentId, 'session-1');
});
