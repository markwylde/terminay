import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { processEnded } from './fixtures/process-ended.mjs';
import { runtime, until } from './fixtures/bot-test-runtime.mjs';

async function setup(t, options) {
	const root = mkdtempSync(join(tmpdir(), 'bots-runtime-'));
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
const completed = (r, id) =>
	until(r.service, 'changed', () => r.sessions.get(id).state === 'completed');
test('5.2 agent launch names credential variables for the tool shell, never values', async (t) => {
	const r = await setup(t);
	const first = await r.service.send(r.bot.id, 'normal');
	await completed(r, first.sessionId);
	assert.ok(r.spawnedEnvironments.length > 0);
	for (const env of r.spawnedEnvironments) {
		assert.equal(env.TERMINAY_CREDENTIAL_VARIABLES, 'FAKE_KEY');
		assert.ok(!env.TERMINAY_CREDENTIAL_VARIABLES.includes('secret'));
	}
});
test('5.4 idle chat yields to trigger; next message reloads same ACP session; profile inputs stay snapshotted', async (t) => {
	const r = await setup(t);
	const first = await r.service.send(r.bot.id, 'normal');
	await completed(r, first.sessionId);
	await r.service.save({
		...r.bot,
		instructions: 'new instructions',
		modelId: 'selected',
	});
	const trigger = await r.service.send(r.bot.id, 'normal', undefined, {
		kind: 'trigger',
		triggerId: 'trigger',
		triggerName: 'Tick',
		fireTime: 1,
	});
	await completed(r, trigger.sessionId);
	assert.equal(r.sessions.get(first.sessionId).state, 'suspended');
	const again = await r.service.send(r.bot.id, 'normal', first.sessionId);
	await completed(r, again.sessionId);
	assert.equal(again.sessionId, first.sessionId);
	assert.equal(r.sessions.get(first.sessionId).snapshot.instructions, '');
	assert.equal(r.sessions.get(first.sessionId).snapshot.modelId, null);
	assert.ok(r.sessions.get(first.sessionId).updates.length > 0);
});
test('5.3 Stop always ends acknowledged agent group and next message reloads, keeping session open', async (t) => {
	const r = await setup(t);
	const first = await r.service.send(r.bot.id, 'hold');
	await until(r.service, 'changed', () =>
		r.sessions
			.get(first.sessionId)
			.updates.some((u) => u.sessionUpdate === 'plan'),
	);
	const child = r.children.get(first.sessionId);
	await r.service.stop(r.bot.id, first.sessionId);
	assert.ok(child.exitCode !== null || child.signalCode !== null);
	assert.ok(r.calls.some((c) => c[0] === 'terminay-run' && c[1] === '--kill'));
	assert.equal(r.sessions.get(first.sessionId).state, 'stopped');
	assert.equal(r.sessions.get(first.sessionId).open, true);
	await r.service.send(r.bot.id, 'normal', first.sessionId);
	await completed(r, first.sessionId);
});
test('5.4 same-session simultaneous messages queue once; stopping unblocks waiting work', async (t) => {
	const r = await setup(t);
	const first = await r.service.send(r.bot.id, 'hold');
	await until(r.service, 'changed', () =>
		r.sessions
			.get(first.sessionId)
			.updates.some((u) => u.sessionUpdate === 'plan'),
	);
	const sends = await Promise.allSettled([
		r.service.send(r.bot.id, 'one', first.sessionId),
		r.service.send(r.bot.id, 'two', first.sessionId),
	]);
	assert.equal(sends.filter((s) => s.status === 'fulfilled').length, 1);
	assert.equal(sends.filter((s) => s.status === 'rejected').length, 1);
	await r.service.stop(r.bot.id, first.sessionId);
	await completed(r, first.sessionId);
});
test('5.3 timeout rejects approval and closes the process before releasing activity', async (t) => {
	const r = await setup(t);
	await r.service.save({ ...r.bot, approvalMode: 'ask', maxTurnMs: 80 });
	const first = await r.service.send(r.bot.id, 'permission');
	await until(
		r.service,
		'changed',
		() => r.sessions.get(first.sessionId).state === 'timed-out',
	);
	assert.equal(r.sessions.get(first.sessionId).permission, null);
	assert.equal(r.sessions.get(first.sessionId).open, false);
	await until(r.service, 'changed', () => r.activity.at(-1)?.[1] === 0);
});
test('5.2 model launch fallback is used only if ACP config is absent; no-load Stop ends session', async (t) => {
	const r = await setup(t, { env: { FAKE_NO_CONFIG: '1', FAKE_NO_LOAD: '1' } });
	await r.service.save({ ...r.bot, modelId: 'selected' });
	const first = await r.service.send(r.bot.id, 'hold');
	await until(r.service, 'changed', () =>
		r.sessions
			.get(first.sessionId)
			.updates.some((u) => u.sessionUpdate === 'plan'),
	);
	assert.ok(r.calls.some((c) => c[0] === 'launch' && c[2] === 'selected'));
	await r.service.stop(r.bot.id, first.sessionId);
	assert.equal(r.sessions.get(first.sessionId).open, false);
	assert.throws(
		() => r.service.continue(r.bot.id, first.sessionId),
		/cannot load/,
	);
});
test('5.4 a session started with another sign-in cannot continue', async (t) => {
	const r = await setup(t);
	const first = await r.service.send(r.bot.id, 'normal');
	await completed(r, first.sessionId);
	await r.service.end(r.bot.id, first.sessionId);
	await r.service.save({
		...r.bot,
		signIn: { kind: 'none' },
	});
	assert.throws(
		() => r.service.continue(r.bot.id, first.sessionId),
		/different sign-in/,
	);
});
test('5.3 cancel acknowledgement cannot leave a tool child running', async (t) => {
	const r = await setup(t);
	const first = await r.service.send(r.bot.id, 'hold leave-child');
	await until(r.service, 'changed', () =>
		r.sessions
			.get(first.sessionId)
			.updates.some((u) => u.toolCallId === 'child'),
	);
	const pid = r.sessions
		.get(first.sessionId)
		.updates.find((u) => u.toolCallId === 'child').rawOutput.pid;
	process.kill(pid, 0);
	await r.service.stop(r.bot.id, first.sessionId);
	assert.equal(await processEnded(pid), true);
});
test('5.3 an ignored cancel is killed after the 10-second deadline', {
	timeout: 20000,
}, async (t) => {
	const r = await setup(t, {
		env: { FAKE_IGNORE_CANCEL: '1', FAKE_IGNORE_EOF: '1' },
	});
	const first = await r.service.send(r.bot.id, 'hold');
	await until(r.service, 'changed', () =>
		r.sessions
			.get(first.sessionId)
			.updates.some((u) => u.sessionUpdate === 'plan'),
	);
	const start = Date.now();
	await r.service.stop(r.bot.id, first.sessionId);
	assert.ok(Date.now() - start >= 9900);
	assert.equal(r.sessions.get(first.sessionId).state, 'stopped');
});
test('5.4 a suspended conversation on an adapter without load starts a new session with a notice', async (t) => {
	const r = await setup(t, { env: { FAKE_NO_LOAD: '1' } });
	const first = await r.service.send(r.bot.id, 'normal');
	await completed(r, first.sessionId);
	const trigger = await r.service.send(r.bot.id, 'normal', undefined, {
		kind: 'trigger',
		triggerId: 't',
		triggerName: 'T',
		fireTime: 1,
	});
	await completed(r, trigger.sessionId);
	const next = await r.service.send(r.bot.id, 'normal', first.sessionId);
	assert.notEqual(next.sessionId, first.sessionId);
	assert.match(r.sessions.get(first.sessionId).reason, /starts a new session/);
	await completed(r, next.sessionId);
});
test('5.4 two devices sending without a session id share the current chat; New chat ends it before new inputs are snapshotted', async (t) => {
	const r = await setup(t);
	const first = await r.service.send(r.bot.id, 'normal');
	await completed(r, first.sessionId);
	const second = await r.service.send(r.bot.id, 'normal');
	await completed(r, second.sessionId);
	assert.equal(second.sessionId, first.sessionId);
	await r.service.save({ ...r.bot, instructions: 'new context' });
	await r.service.newChat(r.bot.id);
	assert.equal(r.sessions.get(first.sessionId).open, false);
	const next = await r.service.send(r.bot.id, 'normal');
	assert.notEqual(next.sessionId, first.sessionId);
	assert.equal(
		r.sessions.get(next.sessionId).snapshot.instructions,
		'new context',
	);
	await completed(r, next.sessionId);
});
test('5.4 continuing a trigger session queues a chat turn while preserving the trigger origin in history', async (t) => {
	const r = await setup(t);
	const trigger = await r.service.send(r.bot.id, 'normal', undefined, {
		kind: 'trigger',
		triggerId: 't',
		triggerName: 'Tick',
		fireTime: 1,
	});
	await completed(r, trigger.sessionId);
	// Completion is committed before the group closes. Wait for the queue's lease to leave.
	await until(r.service, 'changed', () => r.activity.at(-1)?.[1] === 0);
	r.service.continue(r.bot.id, trigger.sessionId);
	const next = await r.service.send(r.bot.id, 'normal');
	assert.equal(next.sessionId, trigger.sessionId);
	await completed(r, next.sessionId);
	assert.equal(r.sessions.get(next.sessionId).origin.kind, 'trigger');
	assert.equal(r.sessions.get(next.sessionId).open, true);
});
test('5.1 bot records remain editable without an engine, and 5.6 records reconcile without launching processes', async (t) => {
	const options = { engineAvailable: false };
	const r = await setup(t, options);
	const { service, bots, sessions } = r;
	assert.equal(bots.list().length, 1);
	await service.save({ ...r.bot, name: 'Offline Bird' });
	assert.equal(bots.get(r.bot.id).name, 'Offline Bird');
	await assert.rejects(service.send(r.bot.id, 'normal'), /reconciliation/);
	const previous = sessions.create(
		r.bot.id,
		{ kind: 'chat' },
		{
			agentId: 'fake.agent',
			modelId: null,
			signIn: { kind: 'none' },
			approvalMode: 'ask',
			instructions: '',
			context: '',
			maxTurnMs: 1800000,
		},
	);
	sessions.patch(previous.id, {
		state: 'needs-you',
		permission: { id: 'pending', options: [], toolCall: null },
		queuedMessage: { id: 'a'.repeat(24), text: 'queued', status: 'queued' },
	});
	await service.reconcile();
	assert.equal(sessions.get(previous.id).state, 'interrupted');
	assert.equal(sessions.get(previous.id).permission, null);
	assert.equal(sessions.get(previous.id).queuedMessage.status, 'not-sent');
	options.engineAvailable = true;
	const next = await service.send(r.bot.id, 'normal');
	await completed(r, next.sessionId);
});
test('5.1 saving a profile preserves environment limits, idle stop and socket configuration', async (t) => {
	const r = await setup(t);
	r.environment.register({
		...r.environment.definition(r.bot.id),
		limits: { cpus: 3, memoryBytes: 8 * 1024 ** 3, pids: 100 },
		idleStopMs: null,
		shareEngineSocket: true,
	});
	await r.service.save({ ...r.bot, description: 'updated' });
	const env = r.environment.definition(r.bot.id);
	assert.equal(env.limits.cpus, 3);
	assert.equal(env.idleStopMs, null);
	assert.equal(env.shareEngineSocket, true);
});
