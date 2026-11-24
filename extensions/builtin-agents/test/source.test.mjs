import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { claudeCode } from '@markwylde/all-your-agents';
import {
	createClaudeFixtureDriver,
	createMemoryHarness,
} from '@markwylde/all-your-agents/testing';
import { createAgentExtensionHarness } from '@terminay/extension-api/testing';
import { createBuiltInAgentsExtension, HARNESSES } from '../dist/index.js';

const manifest = JSON.parse(
	await readFile(new URL('../package.json', import.meta.url), 'utf8'),
).terminay;
const SOURCE = 'com.terminay.builtin-agents/agents';
const REAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Every pid is alive; nothing watches process exit, so only the fixture closes sessions. */
const processes = {
	async info() {
		return { alive: true };
	},
	watch() {
		return 'unsupported';
	},
};

/** The declared harnesses, with Claude Code backed by the library's memory provider. */
function memoryHarnesses() {
	const memory = createMemoryHarness();
	const harnesses = HARNESSES.map((harness) =>
		harness.id === 'claude-code'
			? { ...harness, createProvider: () => memory.provider }
			: harness,
	);
	return { driver: memory.driver, harnesses };
}

async function start(
	t,
	{
		harnesses,
		enabledHarnesses = ['claude-code'],
		processWatchAvailable = () => true,
	} = {},
) {
	const extension = createBuiltInAgentsExtension({
		source: {
			harnesses,
			instanceOptions: { processes, sqlite: false },
			processWatchAvailable,
		},
	});
	const harness = await createAgentExtensionHarness(extension, { manifest });
	t.after(() => harness.dispose());
	await harness.start(SOURCE, { enabledHarnesses });
	return harness;
}

const lastReset = (harness) =>
	harness
		.publications()
		.filter((publication) => publication.kind === 'reset')
		.at(-1);

test('registers one session source and six MCP install targets', async (t) => {
	const harness = await createAgentExtensionHarness(
		createBuiltInAgentsExtension(),
		{ manifest },
	);
	t.after(() => harness.dispose());
	assert.deepEqual(harness.registeredSourceIds(), [SOURCE]);
	assert.deepEqual(
		harness.registeredTargetIds(),
		['claude-code', 'codex', 'cursor', 'antigravity', 'grok', 'opencode'].map(
			(id) => `com.terminay.builtin-agents/${id}`,
		),
	);
});

test('the manifest declares exactly the runtime harnesses, and the MCP targets match the manifest', async (t) => {
	const declared = manifest.contributes.agentSessionSources[0].harnesses;
	assert.deepEqual(
		declared.map(({ id, displayName }) => ({ id, displayName })),
		HARNESSES.map(({ id, displayName }) => ({ id, displayName })),
	);
	const harness = await createAgentExtensionHarness(
		createBuiltInAgentsExtension(),
		{ manifest },
	);
	t.after(() => harness.dispose());
	assert.deepEqual(
		harness.registeredTargetIds(),
		manifest.contributes.mcpInstallTargets.map(({ id }) => id),
	);
});

test('each harness is backed by its own library provider', () => {
	assert.deepEqual(
		Object.fromEntries(
			HARNESSES.map((harness) => [harness.id, harness.createProvider().id]),
		),
		{
			'claude-code': 'claude-code',
			codex: 'codex-cli',
			grok: 'grok-build',
			'oh-my-pi': 'oh-my-pi',
			antigravity: 'antigravity-cli',
		},
	);
});

test('the library runs only the providers whose harness is switched on', async (t) => {
	const started = [];
	const recording = HARNESSES.map((harness) => ({
		...harness,
		createProvider: () => {
			started.push(harness.id);
			return {
				id: harness.id,
				harness: harness.displayName,
				watch: () => () => {},
				async *list() {},
				async *inspect() {},
			};
		},
	}));
	const harness = await start(t, {
		harnesses: recording,
		enabledHarnesses: ['claude-code'],
	});
	assert.deepEqual(started, ['claude-code']);

	started.length = 0;
	harness.setEnabledHarnesses(['claude-code', 'antigravity']);
	await harness.waitFor(() => started.includes('antigravity'));
	assert.deepEqual(started.sort(), ['antigravity', 'claude-code']);
});

test('catch-up is published as one reset when the library is ready', async (t) => {
	const { driver, harnesses } = memoryHarnesses();
	await driver.createLiveSession({
		id: 'a',
		pid: 101,
		cwd: '/work/app',
		status: 'busy',
		title: 'Fix tests',
	});
	await driver.createLiveSession({
		id: 'b',
		pid: 102,
		cwd: '/work/app/pkg',
		status: 'waiting',
	});
	await driver.createLiveSession({ id: 'c', pid: 103, cwd: '/work/other' });
	const harness = await start(t, { harnesses });

	const resets = harness
		.publications()
		.filter((publication) => publication.kind === 'reset');
	assert.equal(resets.length, 1);
	assert.deepEqual(
		resets[0].sessions
			.map((session) => [
				session.id,
				session.harness,
				session.pid,
				session.cwd,
				session.status,
			])
			.sort(),
		[
			['a', 'claude-code', 101, '/work/app', 'running'],
			['b', 'claude-code', 102, '/work/app/pkg', 'waiting'],
			['c', 'claude-code', 103, '/work/other', 'idle'],
		],
	);
	assert.equal(
		harness.sessions().find((session) => session.id === 'a').title,
		'Fix tests',
	);
	harness.assertConformant();
});

test('live changes are upserts and a closed session is removed', async (t) => {
	const { driver, harnesses } = memoryHarnesses();
	const harness = await start(t, { harnesses });

	await driver.createLiveSession({
		id: 'live',
		pid: 201,
		cwd: '/work/app',
		status: 'busy',
	});
	await harness.waitFor((h) =>
		h
			.sessions()
			.some((session) => session.id === 'live' && session.status === 'running'),
	);

	await driver.rewriteStatus('live', 'waiting');
	await harness.waitFor((h) => h.sessions()[0]?.status === 'waiting');

	await driver.runTurnWithTool('live');
	await harness.waitFor((h) => h.sessions()[0]?.lastTurn === 'completed');
	assert.equal(typeof harness.sessions()[0].lastTurnEndedAt, 'number');

	await driver.failTurn('live');
	await harness.waitFor((h) => h.sessions()[0]?.lastTurn === 'failed');
	assert.equal(harness.sessions()[0].error, 'api');

	await driver.remove('live');
	await harness.waitFor((h) => h.sessions().length === 0);
	assert.deepEqual(harness.publications().at(-1), {
		kind: 'remove',
		sourceId: SOURCE,
		sessionId: 'live',
	});
	harness.assertConformant();
});

test('a session without a pid or an absolute cwd is never published', async (t) => {
	const { driver, harnesses } = memoryHarnesses();
	const harness = await start(t, { harnesses });

	await driver.createLiveSession({ id: 'no-cwd', pid: 301 });
	await driver.createLiveSession({
		id: 'history',
		pid: undefined,
		cwd: '/work/app',
	});
	await driver.createLiveSession({ id: 'ok', pid: 302, cwd: '/work/app' });
	await harness.waitFor((h) =>
		h.sessions().some((session) => session.id === 'ok'),
	);
	assert.deepEqual(
		harness.sessions().map((session) => session.id),
		['ok'],
	);

	// Once its cwd is known, the session appears.
	await driver.updateMetadata('no-cwd', { cwd: '/work/app' });
	await harness.waitFor((h) =>
		h.sessions().some((session) => session.id === 'no-cwd'),
	);
	harness.assertConformant();
});

test('a background shell wait is reported as running, not as waiting on the user', async (t) => {
	const { driver, harnesses } = memoryHarnesses();
	const harness = await start(t, { harnesses });

	await driver.createLiveSession({
		id: 'live',
		pid: 251,
		cwd: '/work/app',
		status: 'waiting',
	});
	await harness.waitFor((h) => h.sessions()[0]?.status === 'waiting');

	await driver.startBackgroundWait('live');
	await harness.waitFor((h) => h.sessions()[0]?.status === 'running');
	assert.equal(harness.sessions()[0].waitingFor, undefined);

	await driver.endBackgroundWait('live');
	await harness.waitFor((h) => h.sessions()[0]?.status === 'idle');
	harness.assertConformant();
});

/**
 * The memory provider reports its background wait as `shell`; this wrapper
 * rewrites that word, as the Antigravity provider reports `task`, `subagent`
 * or a request for the user.
 */
function harnessesReportingWaitAs(waitingFor) {
	const memory = createMemoryHarness();
	const provider = {
		...memory.provider,
		watch(ctx) {
			const relay = Object.create(ctx);
			relay.emit = (event, payload) =>
				ctx.emit(
					event,
					event === 'session:status' && payload?.waitingFor === 'shell'
						? { ...payload, waitingFor }
						: payload,
				);
			return memory.provider.watch(relay);
		},
	};
	const harnesses = HARNESSES.map((harness) =>
		harness.id === 'antigravity'
			? { ...harness, createProvider: () => provider }
			: harness,
	);
	return { driver: memory.driver, harnesses };
}

for (const waitingFor of ['task', 'subagent']) {
	test(`a background ${waitingFor} wait is reported as running, not as waiting on the user`, async (t) => {
		const { driver, harnesses } = harnessesReportingWaitAs(waitingFor);
		const harness = await start(t, { harnesses, enabledHarnesses: ['antigravity'] });
		await driver.createLiveSession({ id: 'live', pid: 261, cwd: '/work/app' });
		await harness.waitFor((h) => h.sessions()[0]?.status === 'idle');

		await driver.startBackgroundWait('live');
		await harness.waitFor((h) => h.sessions()[0]?.status === 'running');
		assert.equal(harness.sessions()[0].harness, 'antigravity');
		assert.equal(harness.sessions()[0].waitingFor, undefined);

		await driver.endBackgroundWait('live');
		await harness.waitFor((h) => h.sessions()[0]?.status === 'idle');
		harness.assertConformant();
	});
}

test('a wait for the user to approve stays waiting with its reason', async (t) => {
	const { driver, harnesses } = harnessesReportingWaitAs('approval');
	const harness = await start(t, { harnesses, enabledHarnesses: ['antigravity'] });
	await driver.createLiveSession({ id: 'live', pid: 271, cwd: '/work/app' });
	await harness.waitFor((h) => h.sessions()[0]?.status === 'idle');

	await driver.startBackgroundWait('live');
	await harness.waitFor((h) => h.sessions()[0]?.status === 'waiting');
	assert.equal(harness.sessions()[0].harness, 'antigravity');
	assert.equal(harness.sessions()[0].waitingFor, 'approval');
	harness.assertConformant();
});

test('subagents are reported with their status', async (t) => {
	const { driver, harnesses } = memoryHarnesses();
	await driver.createLiveSession({
		id: 'parent',
		pid: 401,
		cwd: '/work/app',
		status: 'busy',
	});
	const harness = await start(t, { harnesses });

	const { subagentId } = await driver.launchForegroundSubagent('parent');
	await harness.waitFor(
		(h) => h.sessions()[0]?.subagents?.[0]?.status === 'running',
	);
	assert.deepEqual(harness.sessions()[0].subagents, [
		{ id: subagentId, type: 'Explore', status: 'running' },
	]);

	await driver.finishForegroundSubagent('parent', subagentId);
	await harness.waitFor(
		(h) => h.sessions()[0]?.subagents?.[0]?.status === 'completed',
	);
	harness.assertConformant();
});

test('switching a harness off clears its sessions and switching it on reports them again', async (t) => {
	const { driver, harnesses } = memoryHarnesses();
	await driver.createLiveSession({ id: 'kept', pid: 501, cwd: '/work/app' });
	const harness = await start(t, { harnesses });
	assert.equal(harness.sessions().length, 1);

	harness.setEnabledHarnesses([]);
	await harness.waitFor(
		(h) => lastReset(h)?.sessions.length === 0 && h.sessions().length === 0,
	);

	harness.setEnabledHarnesses(['claude-code']);
	await harness.waitFor((h) =>
		h.sessions().some((session) => session.id === 'kept'),
	);
	harness.assertConformant();
});

test('stopping the source stops publishing', async (t) => {
	const { driver, harnesses } = memoryHarnesses();
	const harness = await start(t, { harnesses });
	harness.stop();
	const count = harness.publications().length;
	await driver.createLiveSession({ id: 'late', pid: 601, cwd: '/work/app' });
	// Stopping aborts the source's signal before it returns, and both the source
	// and the host's publisher refuse anything once it is aborted, so there is
	// no later moment at which the count could move.
	assert.equal(harness.publications().length, count);
	harness.assertConformant();
});

test('degraded process-exit detection and provider failures are typed diagnostics', async (t) => {
	const failing = {
		...HARNESSES[0],
		createProvider: () => ({
			id: 'claude-code',
			harness: 'ClaudeCode',
			watch() {
				throw new Error('/Users/someone/.claude is secret');
			},
			async *list() {},
			async *inspect() {},
		}),
	};
	const harness = await start(t, {
		harnesses: [failing],
		processWatchAvailable: () => false,
	});
	await harness.waitFor((h) =>
		h.diagnostics().some((diagnostic) => diagnostic.code === 'provider-error'),
	);
	assert.deepEqual(
		harness
			.diagnostics()
			.map((diagnostic) => diagnostic.code)
			.sort(),
		['process-watch-degraded', 'provider-error'],
	);
	assert.doesNotMatch(JSON.stringify(harness.diagnostics()), /secret|\/Users/u);
	harness.assertConformant();
});

test('the real Claude Code provider reads a live session from its home', async (t) => {
	const home = await mkdtemp(join(tmpdir(), 'builtin-agents-claude-'));
	t.after(() => rm(home, { recursive: true, force: true }));
	const driver = createClaudeFixtureDriver(home);
	await driver.createLiveSession({
		id: REAL_ID,
		pid: 7001,
		cwd: '/work/app',
		status: 'busy',
		title: 'Ship it',
	});
	const harnesses = HARNESSES.map((harness) =>
		harness.id === 'claude-code'
			? { ...harness, createProvider: () => claudeCode({ home }) }
			: harness,
	);
	const harness = await start(t, { harnesses });
	await harness.waitFor((h) =>
		h.sessions().some((session) => session.id === REAL_ID),
	);
	const [session] = harness.sessions();
	assert.equal(session.harness, 'claude-code');
	assert.equal(session.status, 'running');
	assert.equal(session.cwd, '/work/app');

	await driver.rewriteStatus(REAL_ID, 'idle');
	await harness.waitFor((h) => h.sessions()[0]?.status === 'idle');
	await driver.remove(REAL_ID);
	await harness.waitFor((h) => h.sessions().length === 0);
	harness.assertConformant();
});
