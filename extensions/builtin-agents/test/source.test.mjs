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

/** The four declared harnesses, with Claude Code backed by the library's memory provider. */
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
		['claude-code', 'codex', 'cursor', 'gemini', 'grok', 'opencode'].map(
			(id) => `com.terminay.builtin-agents/${id}`,
		),
	);
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
	await new Promise((resolve) => setImmediate(resolve));
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
