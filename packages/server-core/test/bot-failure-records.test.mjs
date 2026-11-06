import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BotSessionStore } from '../dist/botService/index.js';
import { botId, fakeClock } from './fixtures/bot-driver.mjs';

const snapshot = {
	agentId: 'fake.agent',
	modelId: null,
	signIn: { kind: 'none' },
	approvalMode: 'autonomous',
	instructions: '',
	context: '',
	maxTurnMs: 1800000,
};
function setup(t) {
	const root = mkdtempSync(join(tmpdir(), 'bots-failure-records-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return { root, store: new BotSessionStore(root, fakeClock()) };
}
export const failureOrigin = {
	kind: 'failure',
	failures: [
		{
			kind: 'condition',
			sessionId: null,
			firingId: null,
			triggerId: 'a'.repeat(24),
			triggerName: 'Greet new PRs',
			at: 1,
			reason: 'poll.sh exited 1',
		},
	],
	overflow: 3,
};

test('failure origins and causes round-trip; older records load without a cause', (t) => {
	const { root, store } = setup(t);
	const s = store.create(botId, failureOrigin, snapshot);
	store.patch(s.id, { state: 'failed', reason: 'x', cause: 'processes' });
	const old = store.create(botId, { kind: 'chat' }, snapshot);
	store.patch(old.id, { state: 'failed', reason: 'y' });
	const reloaded = new BotSessionStore(root);
	assert.deepEqual(reloaded.get(s.id).origin, failureOrigin);
	assert.equal(reloaded.get(s.id).cause, 'processes');
	assert.equal(reloaded.get(old.id).cause ?? null, null);
});

test('a record with an invalid failure ref is refused as unreadable state', (t) => {
	const { root, store } = setup(t);
	const s = store.create(
		botId,
		{ kind: 'failure', failures: [{ kind: 'nonsense', at: 1, reason: '' }], overflow: 0 },
		snapshot,
	);
	store.patch(s.id, { state: 'failed' });
	assert.throws(() => new BotSessionStore(root), { code: 'state_unreadable' });
});

test('an invalid cause falls back to the previous committed record (ADR-0088)', (t) => {
	const { root, store } = setup(t);
	const s = store.create(botId, { kind: 'chat' }, snapshot);
	store.patch(s.id, { state: 'running' });
	store.patch(s.id, { state: 'failed', cause: 'gremlins' });
	const record = new BotSessionStore(root).get(s.id);
	assert.equal(record.state, 'running');
	assert.equal(record.cause ?? null, null);
});
