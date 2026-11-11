import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
	return { ...r, bot };
}
const settled = (r, id, state) =>
	until(r.service, 'changed', () => r.sessions.get(id).state === state);
const blocked = 'session cleanup failed; bot remains blocked';

test('a bot whose execution cleanup failed retries that cleanup on the next message and runs it', async (t) => {
	const options = { killFailures: 1, execs: [] };
	const r = await setup(t, options);
	const first = await r.service.send(r.bot.id, 'normal');
	await settled(r, first.sessionId, 'failed');
	assert.equal(r.sessions.get(first.sessionId).reason, blocked);

	const posted = await r.service.postUserMessage(r.bot.id, 'normal', 'next');
	assert.equal(posted.error, undefined);
	await settled(r, posted.sessionId, 'completed');
	const kills = options.execs.filter(
		(e) => e.args[1] === '--kill' && e.args[2] === first.sessionId,
	);
	assert.equal(kills.length, 2, 'the failed session is killed again');
	assert.equal(r.service.messages.get(r.bot.id, posted.message.id).dispatch.state, 'started');
});

test('while cleanup still cannot be confirmed the message says so, not sign-in', async (t) => {
	const options = { killFailures: 2 };
	const r = await setup(t, options);
	const first = await r.service.send(r.bot.id, 'normal');
	await settled(r, first.sessionId, 'failed');

	const posted = await r.service.postUserMessage(r.bot.id, 'normal', 'next');
	assert.match(posted.error, /could not be cleaned up/);
	assert.doesNotMatch(posted.error, /sign-in/i);

	// The engine recovers: the retry message now runs.
	const retry = await r.service.postUserMessage(r.bot.id, 'normal', 'again');
	assert.equal(retry.error, undefined);
	await settled(r, retry.sessionId, 'completed');
});

test('a direct execution request retries the failed cleanup and then runs', async (t) => {
	const options = { killFailures: 1 };
	const r = await setup(t, options);
	const first = await r.service.send(r.bot.id, 'normal');
	await settled(r, first.sessionId, 'failed');
	const next = await r.service.send(r.bot.id, 'normal');
	await settled(r, next.sessionId, 'completed');
});

test('the cleanup error is kept in Runner output, and re-enabling a blocked bot does not fail', async (t) => {
	const options = { killFailures: 1 };
	const r = await setup(t, options);
	const first = await r.service.send(r.bot.id, 'normal');
	await settled(r, first.sessionId, 'failed');
	await until(r.service, 'changed', () =>
		r.sessions.get(first.sessionId).runnerOutput.includes('Session cleanup failed: engine exec failed'),
	);
	r.service.enableBot(r.bot.id, false);
	r.service.enableBot(r.bot.id, true);
	const next = await r.service.send(r.bot.id, 'normal');
	await settled(r, next.sessionId, 'completed');
	assert.match(r.sessions.get(first.sessionId).runnerOutput, /cleanup confirmed on retry/);
});
