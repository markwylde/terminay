import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	BotSessionStore,
	createBotOperations,
} from '../dist/botService/index.js';

const snapshot = {
	agentId: 'fake',
	modelId: null,
	signIn: { kind: 'none' },
	approvalMode: 'autonomous',
	instructions: '',
	context: '',
	maxTurnMs: 10000,
};
const BOT = 'aaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbb';
const A = 'trigger-a';
const B = 'trigger-b';
const fired = (kind, triggerId, triggerName) => ({
	kind,
	triggerId,
	triggerName,
	fireTime: 1,
});

function setup(t) {
	const root = mkdtempSync(join(tmpdir(), 'bot-trigger-filter-'));
	let now = 1000;
	const sessions = new BotSessionStore(
		join(root, 'sessions'),
		undefined,
		() => now++,
	);
	t.after(() => {
		sessions.close();
		rmSync(root, { recursive: true, force: true });
	});
	const ids = {
		chat: sessions.create(BOT, { kind: 'chat' }, snapshot).id,
		aFired: sessions.create(BOT, fired('trigger', A, 'Greet'), snapshot).id,
		b: sessions.create(BOT, fired('trigger', B, 'Greet'), snapshot).id,
		aRunNow: sessions.create(BOT, fired('run-now', A, 'Greet'), snapshot).id,
		other: sessions.create(OTHER, fired('trigger', 'trigger-o', 'O'), snapshot)
			.id,
	};
	return { sessions, ids };
}

// The store holds no trigger list, so these sessions stand for retained history
// whose triggers may since have been deleted or renamed: matching is by the id
// each session origin recorded. Triggers A and B share a name.
test('the trigger filter lists a trigger’s firings and Run now sessions, newest first', (t) => {
	const { sessions, ids } = setup(t);
	assert.deepEqual(
		sessions.list(BOT, { triggerId: A }).map((s) => s.id),
		[ids.aRunNow, ids.aFired],
	);
	assert.deepEqual(
		sessions.list(BOT, { triggerId: B }).map((s) => s.id),
		[ids.b],
	);
	assert.equal(sessions.list(BOT).length, 4);
});

test('the trigger filter combines with the origin filter', (t) => {
	const { sessions, ids } = setup(t);
	assert.deepEqual(
		sessions.list(BOT, { triggerId: A, origin: 'run-now' }).map((s) => s.id),
		[ids.aRunNow],
	);
	assert.deepEqual(sessions.list(BOT, { triggerId: A, origin: 'chat' }), []);
});

test('an id no session of the bot records returns no sessions', (t) => {
	const { sessions } = setup(t);
	assert.deepEqual(sessions.list(BOT, { triggerId: 'trigger-gone' }), []);
	assert.deepEqual(sessions.list(BOT, { triggerId: 'trigger-o' }), []);
});

test('the bots.sessions query filters by trigger only within the requested bot', async (t) => {
	const { sessions, ids } = setup(t);
	const ops = createBotOperations({
		bots: { get: () => ({}) },
		sessions,
	});
	const query = async (payload) => {
		const response = await ops.queries['bots.sessions']({
			context: { clientId: 'client', authScope: 'write', claims: null },
			envelope: { payload },
		});
		return JSON.parse(Buffer.from(response.body).toString('utf8'));
	};
	assert.deepEqual(
		(await query({ botId: BOT, triggerId: A })).map((s) => s.id),
		[ids.aRunNow, ids.aFired],
	);
	assert.deepEqual(await query({ botId: BOT, triggerId: 'trigger-o' }), []);
	assert.deepEqual(
		(await query({ botId: OTHER, triggerId: 'trigger-o' })).map((s) => s.id),
		[ids.other],
	);
});
