import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BotMessageStore } from '../dist/botService/messages.js';

const bot = 'abc123def456',
	other = 'abc123def457',
	exec = 'a'.repeat(24);

function setup(t) {
	const root = mkdtempSync(join(tmpdir(), 'bot-threads-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return { root, store: new BotMessageStore(root) };
}
const types = (store, cursor) =>
	store.events(bot, cursor, 25).items.map((e) => [e.type, e.subjectId]);

test('a reply is stored in its root thread and stays out of the main stream', (t) => {
	const { store } = setup(t);
	const root = store.post(bot, 'bot', 'Deployed', exec, 'root');
	const plain = store.post(bot, 'user', 'Something else', null, 'plain');
	const cursor = store.eventCursor(bot);
	const reply = store.post(bot, 'user', 'Use staging', null, 'r1', [], [], root.id);
	assert.equal(reply.threadId, root.id);
	assert.deepEqual(types(store, cursor), [
		['message.posted', reply.id],
		['message.thread', root.id],
	]);
	const main = store.list(bot);
	assert.deepEqual(
		main.items.map((m) => m.id),
		[plain.id, root.id],
	);
	assert.equal(main.total, 2);
	const summary = main.items.find((m) => m.id === root.id).thread;
	assert.equal(summary.replyCount, 1);
	assert.equal(summary.lastReplySequence, reply.sequence);
	assert.equal(summary.lastBotReplySequence, null);
	assert.deepEqual(summary.authors, ['user']);
	assert.equal(main.items.find((m) => m.id === plain.id).thread, undefined);
	assert.equal(store.get(bot, root.id).thread.replyCount, 1);
	assert.equal(store.detail(bot, root.id).message.thread.replyCount, 1);
	assert.equal(store.get(bot, reply.id).thread, undefined);
});

test('a reply to a reply joins the root thread; unknown, deleted and foreign roots are refused', (t) => {
	const { store } = setup(t);
	const root = store.post(bot, 'user', 'Root', null, 'root');
	const reply = store.post(bot, 'bot', 'One', exec, 'one', [], [], root.id);
	const nested = store.post(bot, 'user', 'Two', null, 'two', [], [], reply.id);
	assert.equal(nested.threadId, root.id);
	const gone = store.post(bot, 'user', 'Gone', null, 'gone');
	store.edit(bot, gone.id, 1, null);
	const foreign = store.post(other, 'user', 'Elsewhere', null, 'x');
	const before = store.count(bot);
	for (const target of [gone.id, 'f'.repeat(24), foreign.id])
		assert.throws(
			() => store.post(bot, 'user', 'Nope', null, `k-${target}`, [], [], target),
			/Thread not found/,
		);
	assert.throws(
		() => store.post(bot, 'user', 'Bad', null, 'bad', [], [], '../x'),
		/Invalid/,
	);
	assert.equal(store.count(bot), before);
});

test('replay is checked before the thread is resolved', (t) => {
	const { store } = setup(t);
	const root = store.post(bot, 'user', 'Root', null, 'root');
	const first = store.post(bot, 'bot', 'First', exec, 'first', [], [], root.id);
	const reply = store.post(bot, 'user', 'On first', null, 'k', [], [], first.id);
	store.edit(bot, first.id, 1, null);
	// The reply it named is gone; the retry still returns the original.
	assert.equal(
		store.post(bot, 'user', 'On first', null, 'k', [], [], first.id).id,
		reply.id,
	);
	assert.throws(
		() => store.post(bot, 'user', 'On first', null, 'k', [], [], root.id),
		/different content/,
	);
	assert.throws(
		() => store.post(bot, 'user', 'On first', null, 'k'),
		/different content/,
	);
	assert.equal(store.list(bot, { threadId: root.id }).total, 1);
});

test('a retried reply whose upload tokens were consumed returns the original', (t) => {
	const { store } = setup(t);
	const root = store.post(bot, 'bot', 'Root', exec, 'root');
	const png = Buffer.from('89504e470d0a1a0a0000', 'hex');
	const { token } = store.stage(bot, 'shot.png', png);
	const reply = store.post(bot, 'user', '', null, 'img', [], [token], root.id);
	assert.equal(reply.attachments.length, 1);
	assert.equal(
		store.post(bot, 'user', '', null, 'img', [], [token], root.id).id,
		reply.id,
	);
});

test('thread lists page with scope-bound cursors and search spans replies', (t) => {
	const { store } = setup(t);
	const m = store.post(bot, 'user', 'M', null, 'm'),
		n = store.post(bot, 'user', 'N', null, 'n');
	const replies = [];
	for (let i = 0; i < 5; i++)
		replies.push(store.post(bot, 'bot', `Reply ${i}`, exec, `r${i}`, [], [], m.id));
	store.post(bot, 'user', 'Use staging please', null, 's', [], [], n.id);
	const page = store.list(bot, { threadId: m.id, limit: 2 });
	assert.deepEqual(
		page.items.map((r) => r.id),
		[replies[4].id, replies[3].id],
	);
	assert.equal(page.total, 5);
	assert.ok(page.items.every((r) => r.threadId === m.id));
	const rest = store.list(bot, { threadId: m.id, cursor: page.nextCursor, limit: 10 });
	assert.deepEqual(
		rest.items.map((r) => r.id),
		[replies[2].id, replies[1].id, replies[0].id],
	);
	assert.throws(() => store.list(bot, { threadId: n.id, cursor: page.nextCursor }), /another query/);
	assert.throws(() => store.list(bot, { cursor: page.nextCursor }), /another query/);
	const main = store.list(bot, { limit: 1 });
	assert.throws(() => store.list(bot, { threadId: m.id, cursor: main.nextCursor }), /another query/);
	const found = store.list(bot, { search: 'staging' });
	assert.equal(found.items.length, 1);
	assert.equal(found.items[0].threadId, n.id);
	assert.equal(store.list(bot, { search: 'staging', threadId: m.id }).items.length, 0);
	assert.throws(() => store.list(bot, { threadId: replies[0].id }), /Thread not found/);
});

test('summaries track the latest bot reply and are never persisted', (t) => {
	const { root, store } = setup(t);
	const m = store.post(bot, 'user', 'M', null, 'm');
	const botReply = store.post(bot, 'bot', 'Bot', exec, 'b', [], [], m.id);
	const userReply = store.post(bot, 'user', 'User', null, 'u', [], [], m.id);
	let summary = store.get(bot, m.id).thread;
	assert.equal(summary.lastReplySequence, userReply.sequence);
	assert.equal(summary.lastBotReplySequence, botReply.sequence);
	assert.deepEqual(summary.authors, ['user', 'bot']);
	store.edit(bot, botReply.id, 1, null);
	summary = store.get(bot, m.id).thread;
	assert.equal(summary.replyCount, 1);
	assert.equal(summary.lastBotReplySequence, null);
	store.edit(bot, m.id, 1, 'M edited');
	store.setDispatch(bot, m.id, { state: 'started', executionId: exec });
	const persisted = readFileSync(join(root, bot, 'messages.json'), 'utf8');
	assert.ok(!persisted.includes('"thread"'));
	assert.ok(!persisted.includes('replyCount'));
	const reloaded = new BotMessageStore(root).get(bot, m.id);
	assert.equal(reloaded.revision, 2);
	assert.equal(reloaded.text, 'M edited');
	assert.equal(reloaded.thread.replyCount, 1);
});

test('deleting a reply keeps the thread; deleting a root deletes it with its attachments', (t) => {
	const { root, store } = setup(t);
	const m = store.post(bot, 'user', 'M', null, 'm');
	const image = store.putAttachment(bot, 'a.png', Buffer.from('89504e470d0a1a0a01', 'hex'));
	const a = store.post(bot, 'bot', 'A', exec, 'a', [image], [], m.id);
	const b = store.post(bot, 'bot', 'B', exec, 'b', [], [], m.id);
	const c = store.post(bot, 'user', 'C', null, 'c', [], [], m.id);
	let cursor = store.eventCursor(bot);
	store.edit(bot, b.id, 1, null);
	assert.deepEqual(types(store, cursor), [
		['message.deleted', b.id],
		['message.thread', m.id],
	]);
	assert.equal(store.get(bot, m.id).thread.replyCount, 2);
	cursor = store.eventCursor(bot);
	store.edit(bot, m.id, 1, null);
	const deleted = types(store, cursor);
	assert.deepEqual(deleted.at(-1), ['message.deleted', m.id]);
	assert.deepEqual(
		deleted.slice(0, -1).map(([type, subject]) => `${type}:${subject}`).sort(),
		[`message.deleted:${a.id}`, `message.deleted:${c.id}`].sort(),
	);
	assert.equal(store.count(bot), 0);
	assert.throws(() => store.get(bot, a.id), /not found/);
	assert.equal(existsSync(join(root, bot, 'attachments', image.id)), false);
});

test('a bot reply raises the notification and deleting its thread removes it', (t) => {
	const { store } = setup(t);
	const m = store.post(bot, 'user', 'M', null, 'm');
	store.post(bot, 'bot', 'Done in thread', exec, 'r', [], [], m.id);
	const held = store.unacknowledged(bot);
	assert.equal(held.count, 1);
	assert.equal(held.body, 'Done in thread');
	store.edit(bot, m.id, 1, null);
	assert.equal(store.unacknowledged(bot), undefined);
});

test('clear removes threads', (t) => {
	const { store } = setup(t);
	const m = store.post(bot, 'user', 'M', null, 'm');
	store.post(bot, 'bot', 'R', exec, 'r', [], [], m.id);
	store.clear(bot);
	assert.equal(store.count(bot), 0);
	assert.throws(() => store.list(bot, { threadId: m.id }), /Thread not found/);
});
