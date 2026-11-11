import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runtime, until } from './fixtures/bot-test-runtime.mjs';

async function setup(t) {
	const root = mkdtempSync(join(tmpdir(), 'bots-retry-'));
	const r = await runtime(root);
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
const settled = (r, id) =>
	until(r.service, 'changed', () =>
		['completed', 'failed', 'stopped'].includes(r.sessions.get(id).state),
	);
/** Make the next `count` dispatches fail, then restore the real one. */
function failStarts(r, count = 1) {
	const real = r.service.dispatchExecution.bind(r.service);
	let left = count;
	r.service.dispatchExecution = async (...args) => {
		if (left > 0) {
			left--;
			throw new Error('engine unavailable');
		}
		return real(...args);
	};
}
async function failedMessage(r, key = 'first') {
	failStarts(r);
	const sent = await r.service.postUserMessage(r.bot.id, 'normal', key);
	assert.equal(sent.message.dispatch.state, 'failed');
	assert.match(sent.error, /then retry\./);
	return sent.message;
}
const chatExecutions = (r, messageId) =>
	r.sessions
		.list(r.bot.id)
		.filter(
			(s) => s.origin.kind === 'chat' && s.origin.messageId === messageId,
		);

test('retry starts a fresh execution for the same message and posts nothing new', async (t) => {
	const r = await setup(t);
	const failed = await failedMessage(r);
	const total = r.service.messages.list(r.bot.id).total;
	const retried = await r.service.retryUserMessage(
		r.bot.id,
		failed.id,
		failed.revision,
		1,
	);
	assert.ok(retried.sessionId);
	assert.equal(retried.error, undefined);
	assert.deepEqual(
		{
			state: retried.message.dispatch.state,
			attempt: retried.message.dispatch.attempt,
		},
		{ state: 'started', attempt: 2 },
	);
	assert.equal(retried.message.dispatch.executionId, retried.sessionId);
	assert.equal(r.sessions.get(retried.sessionId).origin.messageId, failed.id);
	await settled(r, retried.sessionId);
	assert.equal(
		r.service.messages.list(r.bot.id).items.filter((m) => m.author === 'user')
			.length,
		1,
	);
	assert.ok(r.service.messages.list(r.bot.id).total >= total);
});

test('a retry that fails again keeps the failure with a new attempt', async (t) => {
	const r = await setup(t);
	const failed = await failedMessage(r);
	failStarts(r);
	const retried = await r.service.retryUserMessage(
		r.bot.id,
		failed.id,
		failed.revision,
		1,
	);
	assert.equal(retried.sessionId, undefined);
	assert.ok(retried.error);
	assert.equal(retried.message.dispatch.state, 'failed');
	assert.equal(retried.message.dispatch.attempt, 2);
	assert.equal(chatExecutions(r, failed.id).length, 0);
});

test('concurrent retries of one attempt accept exactly one, whether the start succeeds or fails', async (t) => {
	for (const outcome of ['starts', 'fails']) {
		await t.test(outcome, async (t) => {
			const r = await setup(t);
			const failed = await failedMessage(r);
			let starts = 0;
			const real = r.service.dispatchExecution.bind(r.service);
			r.service.dispatchExecution = async (...args) => {
				starts++;
				if (outcome === 'fails') throw new Error('engine unavailable');
				return real(...args);
			};
			const results = await Promise.allSettled([
				r.service.retryUserMessage(r.bot.id, failed.id, failed.revision, 1),
				r.service.retryUserMessage(r.bot.id, failed.id, failed.revision, 1),
			]);
			const accepted = results.filter((x) => x.status === 'fulfilled');
			const refused = results.filter((x) => x.status === 'rejected');
			assert.equal(accepted.length, 1);
			assert.equal(refused.length, 1);
			assert.equal(refused[0].reason.code, 'conflict');
			assert.equal(starts, 1);
			const started = accepted[0].value.sessionId;
			if (started) await settled(r, started);
		});
	}
});

test('a late retry naming an earlier attempt, or a stale revision, is refused', async (t) => {
	const r = await setup(t);
	const failed = await failedMessage(r);
	failStarts(r);
	await r.service.retryUserMessage(r.bot.id, failed.id, failed.revision, 1);
	const before = r.sessions.list(r.bot.id).length;
	await assert.rejects(
		r.service.retryUserMessage(r.bot.id, failed.id, failed.revision, 1),
		(e) => e.code === 'conflict',
	);
	r.service.messages.edit(r.bot.id, failed.id, failed.revision, 'edited');
	await assert.rejects(
		r.service.retryUserMessage(r.bot.id, failed.id, failed.revision, 2),
		(e) => e.code === 'conflict',
	);
	await assert.rejects(
		r.service.dismissDispatchFailure(r.bot.id, failed.id, failed.revision, 2),
		(e) => e.code === 'conflict',
	);
	assert.equal(r.sessions.list(r.bot.id).length, before);
	const current = r.service.messages.get(r.bot.id, failed.id);
	assert.equal(current.dispatch.state, 'failed');
	assert.equal(current.dispatch.dismissed, undefined);
});

test('retry and dismiss refuse started, pending, dismissed and bot messages', async (t) => {
	const r = await setup(t);
	const started = await r.service.postUserMessage(r.bot.id, 'normal', 'ok');
	await settled(r, started.sessionId);
	const pending = r.service.messages.post(
		r.bot.id,
		'user',
		'Pending',
		null,
		'pending',
	);
	const bot = r.service.messages.post(r.bot.id, 'bot', 'Hi', null, 'bot');
	const failed = await failedMessage(r, 'dismissed');
	await r.service.dismissDispatchFailure(
		r.bot.id,
		failed.id,
		failed.revision,
		1,
	);
	for (const m of [
		started.message,
		pending,
		bot,
		r.service.messages.get(r.bot.id, failed.id),
	]) {
		const before = r.service.messages.get(r.bot.id, m.id);
		await assert.rejects(
			r.service.retryUserMessage(r.bot.id, m.id, m.revision, 1),
			(e) => e.code === 'conflict',
		);
		await assert.rejects(
			r.service.dismissDispatchFailure(r.bot.id, m.id, m.revision, 1),
			(e) => e.code === 'conflict',
		);
		assert.deepEqual(r.service.messages.get(r.bot.id, m.id), before);
	}
	const other = await r.service.save({
		name: 'Other',
		agentId: 'fake.agent',
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
	});
	await assert.rejects(
		r.service.retryUserMessage(other.id, failed.id, failed.revision, 1),
		(e) => e.code === 'not_found',
	);
});

test('dismiss is stored on the message, emits an event and survives a reload', async (t) => {
	const r = await setup(t);
	const failed = await failedMessage(r);
	const cursor = r.service.messages.events(r.bot.id).nextCursor;
	const dismissed = await r.service.dismissDispatchFailure(
		r.bot.id,
		failed.id,
		failed.revision,
		1,
	);
	assert.equal(dismissed.dispatch.dismissed, true);
	assert.equal(dismissed.dispatch.state, 'failed');
	const events = r.service.messages.events(r.bot.id, cursor).items;
	assert.ok(
		events.some((e) => e.type === 'message.dispatch' && e.subjectId === failed.id),
	);
	const reopened = new r.service.messages.constructor(
		r.service.messages.root,
	);
	assert.equal(reopened.get(r.bot.id, failed.id).dispatch.dismissed, true);
});

test('deleting a message while its retry starts does not bring it back', async (t) => {
	const r = await setup(t);
	const failed = await failedMessage(r);
	let enter, release;
	const entered = new Promise((resolve) => (enter = resolve)),
		gate = new Promise((resolve) => (release = resolve));
	r.service.dispatchExecution = async () => {
		enter();
		await gate;
		throw new Error('engine unavailable');
	};
	const retrying = r.service.retryUserMessage(
		r.bot.id,
		failed.id,
		failed.revision,
		1,
	);
	await entered;
	r.service.messages.edit(r.bot.id, failed.id, failed.revision, null);
	release();
	await assert.rejects(retrying, /message log changed/);
	assert.throws(() => r.service.messages.get(r.bot.id, failed.id));
});

test('restart reconciles a pending retry without starting more work', async (t) => {
	for (const linked of [true, false]) {
		await t.test(linked ? 'execution exists' : 'no execution', async (t) => {
			const r = await setup(t);
			const failed = await failedMessage(r);
			r.service.messages.setDispatch(r.bot.id, failed.id, {
				state: 'pending',
				executionId: null,
				attempt: 2,
			});
			let record;
			if (linked) {
				record = r.sessions.create(
					r.bot.id,
					{ kind: 'chat', messageId: failed.id },
					undefined,
				);
			}
			const count = r.sessions.list(r.bot.id).length;
			await r.service.reconcile();
			const after = r.service.messages.get(r.bot.id, failed.id).dispatch;
			assert.equal(after.attempt, 2);
			if (linked) {
				assert.equal(after.state, 'started');
				assert.equal(after.executionId, record.id);
			} else {
				assert.equal(after.state, 'failed');
				assert.match(after.error, /Retry it/);
			}
			assert.equal(r.sessions.list(r.bot.id).length, count);
		});
	}
});
