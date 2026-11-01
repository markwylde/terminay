import assert from 'node:assert/strict';
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	BOT_RUNNER_LIMIT,
	BOT_TRANSCRIPT_LIMIT,
	BotSessionStore,
} from '../dist/botService/index.js';
import { botId, fakeClock } from './fixtures/bot-driver.mjs';
export const snapshot = {
	agentId: 'fake.agent',
	modelId: null,
	signIn: { kind: 'none' },
	approvalMode: 'autonomous',
	instructions: '',
	context: '',
	maxTurnMs: 1800000,
};
function setup(t, now) {
	const root = mkdtempSync(join(tmpdir(), 'bots-sessions-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const clock = fakeClock();
	return { root, clock, store: new BotSessionStore(root, clock, now) };
}
test('5.5 uncounted segment from a crash is preserved; only committed updates recover', (t) => {
	const { root, store } = setup(t);
	const s = store.create(botId, { kind: 'chat' }, snapshot);
	store.append(s.id, { text: 'committed' });
	store.patch(s.id, { state: 'running' });
	store.append(s.id, { text: 'not committed' });
	writeFileSync(
		join(root, s.id, 'segment-1.json'),
		JSON.stringify([{ text: 'crashed before metadata' }]),
	);
	const recovered = new BotSessionStore(root);
	assert.deepEqual(recovered.get(s.id).updates, [{ text: 'committed' }]);
	assert.equal(recovered.get(s.id).recoveryMayHaveLostUpdates, true);
	assert.ok(
		readdirSync(join(root, s.id)).some((n) =>
			n.startsWith('segment-1.json.corrupt-'),
		),
	);
});
test('5.5 damping deadline, 256 updates, permission/status and turn boundaries commit without repeating timers', (t) => {
	const { root, clock, store } = setup(t);
	const s = store.create(botId, { kind: 'chat' }, snapshot);
	store.append(s.id, { text: 'one' });
	clock.tick(1999);
	assert.equal(
		JSON.parse(readFileSync(join(root, s.id, 'session.json'))).segments,
		0,
	);
	store.append(s.id, { text: 'two' });
	assert.equal(clock.timers.size, 1);
	clock.tick(1);
	assert.equal(
		JSON.parse(readFileSync(join(root, s.id, 'session.json'))).segments,
		1,
	);
	assert.equal(clock.timers.size, 0);
	for (let n = 0; n < 256; n++) store.append(s.id, { n });
	assert.equal(store.get(s.id).segments, 2);
	assert.equal(clock.timers.size, 0);
	store.append(s.id, { text: 'permission' });
	store.patch(s.id, {
		state: 'needs-you',
		permission: { id: 'p', options: [], toolCall: null },
	});
	assert.equal(store.get(s.id).segments, 3);
	store.append(s.id, { text: 'turn ended' });
	store.commit(s.id);
	assert.equal(new BotSessionStore(root).get(s.id).segments, 4);
});
test('5.5 transcript never exceeds 8 MiB and runner retains at most its last 256 KiB', (t) => {
	const { store } = setup(t);
	const s = store.create(botId, { kind: 'chat' }, snapshot);
	for (let n = 0; n < 300; n++) store.append(s.id, { text: 'x'.repeat(32768) });
	store.runner(s.id, `prefix${'x'.repeat(BOT_RUNNER_LIMIT)}`);
	store.commit(s.id);
	const r = store.get(s.id);
	assert.ok(r.transcriptBytes <= BOT_TRANSCRIPT_LIMIT);
	assert.equal(r.truncated, true);
	assert.deepEqual(r.updates.at(-1), { kind: 'truncated' });
	assert.equal(Buffer.byteLength(r.runnerOutput), BOT_RUNNER_LIMIT);
	assert.ok(!r.runnerOutput.includes('prefix'));
});
test('5.5 retention keeps newest 200 or all from last 30 days, whichever is more', (t) => {
	let now = 0;
	const { root, store } = setup(t, () => now);
	const ids = [];
	for (let n = 0; n < 202; n++) {
		now = n;
		const s = store.create(botId, { kind: 'chat' }, snapshot);
		store.patch(s.id, { open: false, state: 'completed', endedAt: now });
		ids.push(s.id);
	}
	now = 31 * 24 * 60 * 60_000;
	const fresh = store.create(botId, { kind: 'chat' }, snapshot);
	store.patch(fresh.id, { open: false, state: 'completed' });
	store.retain(botId);
	assert.equal(store.list(botId).length, 200);
	assert.throws(() => store.get(ids[0]));
	assert.ok(store.get(fresh.id));
	assert.equal(new BotSessionStore(root).list(botId).length, 200);
});
