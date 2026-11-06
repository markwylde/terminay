import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runtime, until } from './fixtures/bot-test-runtime.mjs';
import { processEnded } from './fixtures/process-ended.mjs';

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
test('each message starts a fresh provider execution and uses the current profile', async (t) => {
	const r = await setup(t);
	const first = await r.service.send(r.bot.id, 'normal');
	await completed(r, first.sessionId);
	await r.service.save({
		...r.bot,
		instructions: 'new instructions',
		modelId: 'selected',
	});
	const again = await r.service.send(r.bot.id, 'normal', first.sessionId);
	await completed(r, again.sessionId);
	assert.notEqual(again.sessionId, first.sessionId);
	assert.equal(
		r.sessions.get(again.sessionId).runtimeDriver,
		'claude-code-cli',
	);
	assert.equal(r.sessions.get(first.sessionId).snapshot.instructions, '');
	assert.equal(
		r.sessions.get(again.sessionId).snapshot.instructions,
		'new instructions',
	);
	assert.equal(r.sessions.get(first.sessionId).open, false);
	assert.equal(r.sessions.get(again.sessionId).open, false);
	assert.equal(r.service.messages.list(r.bot.id).total, 4);
});
test('a second user message starts while older work runs; stopping ends the old process', async (t) => {
	const r = await setup(t);
	const first = await r.service.send(r.bot.id, 'hold');
	await until(r.service, 'changed', () =>
		r.sessions
			.get(first.sessionId)
			.updates.some((u) => u.sessionUpdate === 'plan'),
	);
	const child = r.children.get(first.sessionId);
	const second = await r.service.send(r.bot.id, 'normal');
	await completed(r, second.sessionId);
	assert.equal(r.sessions.get(first.sessionId).state, 'running');
	await r.service.stop(r.bot.id, first.sessionId);
	assert.ok(child.exitCode !== null || child.signalCode !== null);
	assert.equal(r.sessions.get(first.sessionId).open, false);
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
test('5.2 native model selection and Stop close an execution without conversation loading', async (t) => {
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
		/immutable diagnostics/,
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
		/immutable diagnostics/,
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
test('simultaneous devices create independent executions; explicit retry is idempotent', async (t) => {
	const r = await setup(t);
	const [a, b] = await Promise.all([
		r.service.postUserMessage(r.bot.id, 'normal', 'device-a'),
		r.service.postUserMessage(r.bot.id, 'normal', 'device-b'),
	]);
	assert.notEqual(a.sessionId, b.sessionId);
	await completed(r, a.sessionId);
	await completed(r, b.sessionId);
	const retry = await r.service.postUserMessage(r.bot.id, 'normal', 'device-a');
	assert.equal(retry.sessionId, a.sessionId);
});
test('5.1 bot records remain editable without an engine, and 5.6 records reconcile without launching processes', async (t) => {
	const options = { engineAvailable: false };
	const r = await setup(t, options);
	const { service, bots, sessions } = r;
	assert.equal(bots.list().length, 1);
	await service.save({ ...r.bot, name: 'Offline Bird' });
	assert.equal(bots.get(r.bot.id).name, 'Offline Bird');
	await assert.rejects(
		service.send(r.bot.id, 'normal'),
		/execution could not start/,
	);
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
	});
	await r.service.save({ ...r.bot, description: 'updated' });
	const env = r.environment.definition(r.bot.id);
	assert.equal(env.limits.cpus, 3);
	assert.equal(env.idleStopMs, null);
	assert.equal('shareEngineSocket' in env, false);
});
test('restart marks accepted but undispatched messages failed without replaying actions', async (t) => {
	const r = await setup(t);
	const pending = r.service.messages.post(
		r.bot.id,
		'user',
		'Pending action',
		null,
		'pending-crash',
	);
	const count = r.sessions.list(r.bot.id).length;
	await r.service.reconcile();
	const restored = r.service.messages.get(r.bot.id, pending.id);
	assert.equal(restored.dispatch.state, 'failed');
	assert.equal(r.sessions.list(r.bot.id).length, count);
	const retry = await r.service.postUserMessage(
		r.bot.id,
		'Pending action',
		'pending-crash',
	);
	assert.equal(retry.sessionId, undefined);
	assert.ok(retry.error);
});
test('a correction accepted while a reply is redacted prevents a stale post', async (t) => {
	const r = await setup(t);
	const active = await r.service.send(r.bot.id, 'hold');
	await until(r.service, 'changed', () =>
		r.sessions
			.get(active.sessionId)
			.updates.some((u) => u.sessionUpdate === 'plan'),
	);
	const record = r.sessions.create(
		r.bot.id,
		{ kind: 'chat' },
		r.sessions.get(active.sessionId).snapshot,
	);
	r.service.runtime.register(record.id);
	r.sessions.patch(record.id, { state: 'running' });
	let enter, release;
	const entered = new Promise((resolve) => (enter = resolve)),
		gate = new Promise((resolve) => (release = resolve));
	const original = r.service.redactMessage.bind(r.service);
	r.service.redactMessage = async (id, text) => {
		if (text === 'late result') {
			enter();
			await gate;
		}
		return original(id, text);
	};
	const posting = r.service.postBotMessage(
		active.sessionId,
		'late result',
		'reply',
	);
	await entered;
	await r.service.runtime.call(record.id, 'sessions_post', {
		sessionId: active.sessionId,
		text: 'Destination changed',
		key: 'correction',
	});
	release();
	await assert.rejects(posting, /inbox corrections/);
	assert.equal(
		r.service.messages.list(r.bot.id).items.filter((m) => m.author === 'bot')
			.length,
		0,
	);
});
test('clearing an accepted message during dispatch cannot return a deleted row as a new post', async (t) => {
	const r = await setup(t);
	let enter, release;
	const entered = new Promise((resolve) => (enter = resolve)),
		gate = new Promise((resolve) => (release = resolve));
	r.service.dispatchExecution = async () => {
		enter();
		await gate;
		throw new Error('message was cleared');
	};
	const posting = r.service.postUserMessage(r.bot.id, 'normal', 'clear-race');
	await entered;
	await r.service.clearMessages(r.bot.id);
	release();
	await assert.rejects(posting, /message log changed/);
	assert.equal(r.service.messages.list(r.bot.id).total, 0);
});
const pngBytes = (n) =>
	Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from([n])]);
const settled = (r, id) =>
	until(r.service, 'changed', () =>
		['completed', 'failed', 'stopped'].includes(r.sessions.get(id).state),
	);
test('uploaded images reach only the triggering execution, in the container and as content blocks', async (t) => {
	const execs = [];
	const recordInput = join(mkdtempSync(join(tmpdir(), 'bot-input-')), 'in.jsonl');
	const r = await setup(t, { execs, env: { FAKE_RECORD_INPUT: recordInput } });
	await assert.rejects(
		r.service.uploadUserImage(r.bot.id, 'notes.txt', Buffer.from('hello')),
		/PNG, JPEG, GIF and WebP/,
	);
	await assert.rejects(
		r.service.uploadUserImage(r.bot.id, 'big.png', Buffer.alloc(2 * 1024 * 1024 + 1)),
		/2 MiB/,
	);
	const a = await r.service.uploadUserImage(r.bot.id, 'my shot.png', pngBytes(1));
	const b = await r.service.uploadUserImage(r.bot.id, '../../etc/passwd.png', pngBytes(2));
	const sent = await r.service.postUserMessage(r.bot.id, '', 'image-post', [a.token, b.token]);
	assert.equal(sent.error, undefined, JSON.stringify(sent));
	assert.deepEqual(sent.message.attachments.map((x) => x.name), ['my shot.png', '../../etc/passwd.png']);
	await settled(r, sent.sessionId);
	assert.equal(r.sessions.get(sent.sessionId).state, 'completed');
	const writes = execs.filter((e) => e.args[0] === 'python3' && e.args[2]?.includes('os.replace'));
	assert.deepEqual(writes.map((e) => e.args.slice(3)), [
		[sent.sessionId, '1.png'],
		[sent.sessionId, '2.png'],
	]);
	assert.ok(writes.every((e) => e.options.user === 'bot' && e.container === `terminay-bot-${r.bot.id}`));
	assert.deepEqual(Buffer.from(writes[0].options.input), pngBytes(1));
	const removal = (e) => e.args[2]?.includes('rmtree');
	await until(r.service, 'changed', () => execs.some(removal));
	const removed = execs.filter(removal);
	assert.deepEqual(removed.map((e) => e.args[3]), [sent.sessionId]);
	const { readFileSync } = await import('node:fs');
	const user = JSON.parse(readFileSync(recordInput, 'utf8').trim().split('\n')[0]);
	const blocks = user.message.content;
	assert.equal(blocks.filter((x) => x.type === 'image').length, 2);
	assert.equal(blocks[1].source.data, pngBytes(1).toString('base64'));
	const briefing = JSON.parse(
		blocks[0].text.split('\n').find((line) => line.startsWith('{"executionId":')),
	);
	assert.deepEqual(
		briefing.triggerMessage.attachments.map((x) => x.path),
		[1, 2].map((n) => `/tmp/terminay-attachments/${sent.sessionId}/${n}.png`),
	);
	const retry = await r.service.postUserMessage(r.bot.id, '', 'image-post', [a.token, b.token]);
	assert.equal(retry.message.id, sent.message.id);
	assert.equal(retry.sessionId, sent.sessionId);
	const later = await r.service.send(r.bot.id, 'normal');
	await settled(r, later.sessionId);
	assert.equal(r.sessions.get(later.sessionId).runtime.triggerAttachments, undefined);
	const lines = readFileSync(recordInput, 'utf8').trim().split('\n');
	assert.equal(typeof JSON.parse(lines.at(-1)).message.content, 'string');
});
for (const [ending, options, text] of [
	['stopped', {}, 'hold'],
	['failed', { env: { FAKE_MCP_DISCONNECTED: '1' } }, 'look'],
])
	test(`image copies are removed when an execution is ${ending}`, async (t) => {
		const execs = [];
		const r = await setup(t, { ...options, execs });
		const a = await r.service.uploadUserImage(r.bot.id, 'x.png', pngBytes(5));
		const sent = await r.service.postUserMessage(r.bot.id, text, `end-${ending}`, [a.token]);
		if (ending === 'stopped') {
			await until(r.service, 'changed', () => r.sessions.get(sent.sessionId).state === 'running');
			await r.service.stop(r.bot.id, sent.sessionId);
		}
		await settled(r, sent.sessionId);
		assert.equal(r.sessions.get(sent.sessionId).state, ending);
		const removal = (e) => e.args[2]?.includes('rmtree') && e.args[3] === sent.sessionId;
		await until(r.service, 'changed', () => execs.some(removal));
		assert.ok(execs.some((e) => e.args[2]?.includes('os.replace')));
	});
test('uploads to an unknown or deleted bot are refused', async (t) => {
	const r = await setup(t);
	await assert.rejects(r.service.uploadUserImage('zzzzzzzzzzzz', 'a.png', pngBytes(1)));
	assert.equal(r.service.messages.count(r.bot.id), 0);
});
test('an execution whose snapshotted image disappeared fails explicitly and keeps the message', async (t) => {
	const r = await setup(t);
	const a = await r.service.uploadUserImage(r.bot.id, 'gone.png', pngBytes(3));
	const original = r.service.messages.attachment.bind(r.service.messages);
	r.service.messages.attachment = () => {
		throw new Error('Attachment not found');
	};
	t.after(() => (r.service.messages.attachment = original));
	const sent = await r.service.postUserMessage(r.bot.id, 'look', 'gone-post', [a.token]);
	await settled(r, sent.sessionId);
	const record = r.sessions.get(sent.sessionId);
	assert.equal(record.state, 'failed');
	assert.match(record.reason, /no longer available; send it again/);
	assert.equal(r.service.messages.get(r.bot.id, sent.message.id).attachments.length, 1);
});

