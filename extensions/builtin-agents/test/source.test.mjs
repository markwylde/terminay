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
import {
	validateAgentSessionReset,
	validateAgentSessionSnapshot,
} from '@terminay/extension-api';
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
		const harness = await start(t, {
			harnesses,
			enabledHarnesses: ['antigravity'],
		});
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
	const harness = await start(t, {
		harnesses,
		enabledHarnesses: ['antigravity'],
	});
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

/**
 * The memory provider stamps every row `provider: 'memory'`. A second one is
 * renamed on the way out so the library can tell the two apart.
 */
function renamedProvider(provider, id, onWatch = () => {}) {
	const rename = (value) =>
		value && typeof value === 'object' && value.provider === 'memory'
			? { ...value, provider: id }
			: value;
	const context = (ctx) =>
		new Proxy(ctx, {
			get(target, key) {
				if (key === 'emit')
					return (verb, payload) => target.emit(verb, rename(payload));
				const value = target[key];
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
	return {
		...provider,
		id,
		watch: (ctx) => {
			const stop = provider.watch(context(ctx));
			onWatch();
			return stop;
		},
		async *list(ctx, ...rest) {
			for await (const row of provider.list(context(ctx), ...rest))
				yield rename(row);
		},
		inspect: (ctx, ...rest) => provider.inspect(context(ctx), ...rest),
		revalidate: (ctx, ...rest) => provider.revalidate(context(ctx), ...rest),
		subagents: (ctx, ...rest) => provider.subagents(context(ctx), ...rest),
	};
}

/** Claude Code and Antigravity, each backed by its own memory provider. */
function twoMemoryHarnesses({ onAgyWatch } = {}) {
	const claude = createMemoryHarness();
	const agy = createMemoryHarness();
	const agyProvider = renamedProvider(
		agy.provider,
		'memory-antigravity',
		onAgyWatch && (() => onAgyWatch(agy.driver)),
	);
	const harnesses = HARNESSES.map((harness) => {
		if (harness.id === 'claude-code')
			return { ...harness, createProvider: () => claude.provider };
		if (harness.id === 'antigravity')
			return { ...harness, createProvider: () => agyProvider };
		return harness;
	});
	return { claude: claude.driver, agy: agy.driver, harnesses };
}

/** Run `fn` while the library's clock reads `at`. */
async function at(t, value, fn) {
	const mock = t.mock.method(Date, 'now', () => value);
	try {
		await fn();
	} finally {
		mock.mock.restore();
	}
}

// agy records turn end times with sub-millisecond precision.
const AGY_ENDED_AT = 1795772970190.7083;

test('with Claude Code and Antigravity live, every publication stays valid through a fractional turn end', async (t) => {
	const { claude, agy, harnesses } = twoMemoryHarnesses();
	await claude.createLiveSession({ id: 'claude', pid: 601, cwd: '/work/app' });
	await agy.createLiveSession({ id: 'agy', pid: 602, cwd: '/work/app' });
	const harness = await start(t, {
		harnesses,
		enabledHarnesses: ['claude-code', 'antigravity'],
	});
	assert.deepEqual(
		lastReset(harness)
			.sessions.map((session) => [session.id, session.harness])
			.sort(),
		[
			['agy', 'antigravity'],
			['claude', 'claude-code'],
		],
	);

	// The memory fixture only reports turns while it is watched, so the
	// fractional end arrives as a live upsert beside the Claude Code session.
	await claude.runTurnWithTool('claude');
	await at(t, AGY_ENDED_AT, () => agy.runTurnWithTool('agy'));
	await harness.waitFor((h) =>
		h.sessions().every((session) => session.lastTurn === 'completed'),
	);
	const published = harness.sessions().find((session) => session.id === 'agy');
	assert.equal(published.lastTurnEndedAt, 1795772970190);
	assert.equal(validateAgentSessionReset(harness.sessions()).ok, true);
	for (const publication of harness.publications()) {
		if (publication.kind === 'reset')
			assert.equal(validateAgentSessionReset(publication.sessions).ok, true);
		if (publication.kind === 'upsert')
			assert.equal(validateAgentSessionSnapshot(publication.session).ok, true);
	}
	harness.assertConformant();
});

test('a fractional turn end time reported during catch-up is floored in the reset', async (t) => {
	// The turn ends while the library is catching up, before `ready`, so it is
	// part of the one reset rather than a later upsert.
	const { claude, agy, harnesses } = twoMemoryHarnesses({
		onAgyWatch: (driver) => {
			const mock = t.mock.method(Date, 'now', () => AGY_ENDED_AT);
			try {
				driver.runTurnWithTool('agy');
			} finally {
				mock.mock.restore();
			}
		},
	});
	await claude.createLiveSession({ id: 'claude', pid: 611, cwd: '/work/app' });
	await agy.createLiveSession({ id: 'agy', pid: 612, cwd: '/work/app' });
	const harness = await start(t, {
		harnesses,
		enabledHarnesses: ['claude-code', 'antigravity'],
	});

	const resets = harness
		.publications()
		.filter((publication) => publication.kind === 'reset');
	assert.equal(resets.length, 1);
	assert.deepEqual(
		resets[0].sessions.map((session) => [session.id, session.harness]).sort(),
		[
			['agy', 'antigravity'],
			['claude', 'claude-code'],
		],
	);
	const published = resets[0].sessions.find((session) => session.id === 'agy');
	assert.equal(published.lastTurn, 'completed');
	assert.equal(published.lastTurnEndedAt, 1795772970190);
	assert.equal(validateAgentSessionReset(resets[0].sessions).ok, true);
	harness.assertConformant();
});

test('a fractional turn end time in a live upsert is floored', async (t) => {
	const { agy, harnesses } = twoMemoryHarnesses();
	const harness = await start(t, {
		harnesses,
		enabledHarnesses: ['antigravity'],
	});
	await agy.createLiveSession({ id: 'agy', pid: 603, cwd: '/work/app' });
	await at(t, AGY_ENDED_AT, () => agy.runTurnWithTool('agy'));
	await harness.waitFor((h) => h.sessions()[0]?.lastTurn === 'completed');

	const published = harness.sessions()[0];
	assert.equal(published.lastTurnEndedAt, 1795772970190);
	assert.equal(validateAgentSessionSnapshot(published).ok, true);
	harness.assertConformant();
});

test('an unusable turn end time is omitted; a whole one is unchanged', async (t) => {
	const cases = [
		[Number.NaN, undefined],
		[Number.POSITIVE_INFINITY, undefined],
		[Number.NEGATIVE_INFINITY, undefined],
		[-1, undefined],
		[Number.MAX_SAFE_INTEGER + 2, undefined],
		[1_795_772_970_190, 1_795_772_970_190],
	];
	for (const [endedAt, expected] of cases) {
		const { driver, harnesses } = memoryHarnesses();
		const harness = await start(t, { harnesses });
		await driver.createLiveSession({ id: 's', pid: 604, cwd: '/work/app' });
		await at(t, endedAt, () => driver.runTurnWithTool('s'));
		await harness.waitFor((h) => h.sessions()[0]?.lastTurn === 'completed');
		const published = harness.sessions()[0];
		assert.equal(published.lastTurnEndedAt, expected, `end time ${endedAt}`);
		assert.equal(
			Object.hasOwn(published, 'lastTurnEndedAt'),
			expected !== undefined,
		);
		harness.assertConformant();
	}

	// A session whose turn never ended carries no end time.
	const { driver, harnesses } = memoryHarnesses();
	const harness = await start(t, { harnesses });
	await driver.createLiveSession({ id: 'fresh', pid: 605, cwd: '/work/app' });
	await harness.waitFor((h) => h.sessions().length === 1);
	assert.equal(Object.hasOwn(harness.sessions()[0], 'lastTurnEndedAt'), false);
});
