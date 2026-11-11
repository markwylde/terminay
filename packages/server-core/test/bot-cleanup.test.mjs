import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BOT_KILL_DEADLINE_MS } from '../dist/botService/engine.js';
import { runtime, until } from './fixtures/bot-test-runtime.mjs';

async function setup(t, options) {
	const root = mkdtempSync(join(tmpdir(), 'bots-cleanup-'));
	const r = await runtime(root, options);
	t.after(async () => {
		await r.service.shutdown();
		await r.kill();
		rmSync(root, { recursive: true, force: true });
	});
	const bot = await r.service.save({
		name: 'Bird',
		agentId: 'fake.agent',
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
	});
	return { ...r, root, bot };
}
const kills = (execs, sessionId) =>
	execs.filter(
		(e) =>
			e.args[0] === 'terminay-run' &&
			e.args[1] === '--kill' &&
			e.args[2].endsWith(sessionId),
	);
const ended = (r, id) =>
	until(
		r.service,
		'changed',
		() =>
			!['queued', 'running', 'needs-you'].includes(r.sessions.get(id).state) &&
			r.service.queue.active(r.bot.id).length === 0,
	);

test('the agent and its relay are killed with the 5-minute deadline', async (t) => {
	assert.equal(BOT_KILL_DEADLINE_MS, 5 * 60_000);
	const execs = [];
	const r = await setup(t, { execs });
	const first = await r.service.send(r.bot.id, 'normal');
	await ended(r, first.sessionId);
	const sent = kills(execs, first.sessionId).map((e) => e.args[2]);
	assert.deepEqual(
		new Set(sent),
		new Set([first.sessionId, `mcp-${first.sessionId}`]),
	);
	for (const e of kills(execs, first.sessionId))
		assert.equal(e.options.deadlineMs, BOT_KILL_DEADLINE_MS);
});

test('a failed agent kill still closes the relays and leaves the turn completed', async (t) => {
	const execs = [];
	const logged = [];
	t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
	let failOnce = true;
	const r = await setup(t, {
		execs,
		execFailure: (args) => {
			if (failOnce && args[1] === '--kill' && !args[2].startsWith('mcp-')) {
				failOnce = false;
				return new Error('engine operation deadline exceeded');
			}
		},
	});
	const first = await r.service.send(r.bot.id, 'normal');
	await ended(r, first.sessionId);
	const record = r.sessions.get(first.sessionId);
	assert.equal(record.state, 'completed');
	assert.match(record.runnerOutput, /Cleanup failed: .*deadline exceeded/);
	assert.ok(
		kills(execs, first.sessionId).some(
			(e) => e.args[2] === `mcp-${first.sessionId}`,
		),
		'the relay was still closed',
	);
	assert.ok(logged.some((l) => l.includes('bot cleanup failed')));
	const second = await r.service.send(r.bot.id, 'normal');
	await ended(r, second.sessionId);
	assert.equal(r.sessions.get(second.sessionId).state, 'completed');
});

test('a failed relay kill is logged and does not count as a cleanup failure', async (t) => {
	const logged = [];
	t.mock.method(console, 'error', (...args) => logged.push(args.join(' ')));
	const r = await setup(t, {
		execFailure: (args) =>
			args[1] === '--kill' && args[2].startsWith('mcp-')
				? new Error('relay kill failed')
				: undefined,
	});
	for (let n = 0; n < 4; n++) {
		const run = await r.service.send(r.bot.id, 'normal');
		await ended(r, run.sessionId);
		const record = r.sessions.get(run.sessionId);
		assert.equal(record.state, 'completed');
		assert.doesNotMatch(record.runnerOutput, /Cleanup failed/);
	}
	assert.ok(logged.some((l) => l.includes('bot relay cleanup failed')));
});
