import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BOT_CLEANUP_FAILURE_LIMIT } from '../dist/botService/queue.js';
import { runtime, until } from './fixtures/bot-test-runtime.mjs';

// The engine fails the agent's kill while `failing.agentKills` > 0.
async function setup(t, failing, execs = []) {
	t.mock.method(console, 'error', () => {});
	const root = mkdtempSync(join(tmpdir(), 'bots-cleanup-recovery-'));
	const r = await runtime(root, {
		execs,
		execFailure: (args) => {
			if (
				failing.agentKills > 0 &&
				args[1] === '--kill' &&
				!args[2].startsWith('mcp-')
			) {
				failing.agentKills--;
				return new Error('engine operation deadline exceeded');
			}
		},
	});
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
	return { ...r, bot };
}
const ended = (r, id) =>
	until(
		r.service,
		'changed',
		() =>
			!['queued', 'running', 'needs-you'].includes(r.sessions.get(id).state) &&
			r.service.queue.active(r.bot.id).length === 0,
	);
async function block(r) {
	const ids = [];
	for (let n = 0; n < BOT_CLEANUP_FAILURE_LIMIT; n++) {
		const run = await r.service.send(r.bot.id, 'normal');
		await ended(r, run.sessionId);
		ids.push(run.sessionId);
	}
	assert.equal(r.service.queue.blocked(r.bot.id), true);
	return ids;
}

test('a bot blocked by unconfirmed cleanup retries it on the next message and runs it', async (t) => {
	const failing = { agentKills: BOT_CLEANUP_FAILURE_LIMIT };
	const execs = [];
	const r = await setup(t, failing, execs);
	const ids = await block(r);

	const posted = await r.service.postUserMessage(r.bot.id, 'normal', 'next');
	assert.equal(posted.error, undefined);
	await ended(r, posted.sessionId);
	assert.equal(r.sessions.get(posted.sessionId).state, 'completed');
	assert.equal(r.service.queue.blocked(r.bot.id), false);
	for (const id of ids) {
		assert.equal(
			execs.filter((e) => e.args[1] === '--kill' && e.args[2] === id).length,
			2,
			'each unconfirmed session is killed again',
		);
		assert.match(r.sessions.get(id).runnerOutput, /cleanup confirmed on retry/);
	}
});

test('while the retried cleanup fails the message names it, not sign-in, and a later message recovers', async (t) => {
	const failing = { agentKills: BOT_CLEANUP_FAILURE_LIMIT + 1 };
	const r = await setup(t, failing);
	await block(r);

	const posted = await r.service.postUserMessage(r.bot.id, 'normal', 'next');
	assert.match(posted.error, /could not be cleaned up/);
	assert.doesNotMatch(posted.error, /sign-in/i);

	const retry = await r.service.postUserMessage(r.bot.id, 'normal', 'again');
	assert.equal(retry.error, undefined);
	await ended(r, retry.sessionId);
	assert.equal(r.sessions.get(retry.sessionId).state, 'completed');
});

test('re-enabling a blocked bot does not fail, and its next execution recovers', async (t) => {
	const failing = { agentKills: BOT_CLEANUP_FAILURE_LIMIT };
	const r = await setup(t, failing);
	await block(r);
	r.service.enableBot(r.bot.id, false);
	r.service.enableBot(r.bot.id, true);
	const next = await r.service.send(r.bot.id, 'normal');
	await ended(r, next.sessionId);
	assert.equal(r.sessions.get(next.sessionId).state, 'completed');
});
