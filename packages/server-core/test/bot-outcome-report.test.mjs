import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	BOT_RUNTIME_TOOLS,
	BotExecutionRuntime,
} from '../dist/botService/runtime.js';
import { BotMessageStore } from '../dist/botService/messages.js';
import { BotSessionStore } from '../dist/botService/sessions.js';
import { BotError } from '../dist/botService/store.js';

const bot = 'abc123def456';
const TRIGGER = 't'.repeat(24);
const snapshot = {
	agentId: 'fake',
	modelId: null,
	signIn: { kind: 'none' },
	approvalMode: 'autonomous',
	instructions: '',
	context: '',
	maxTurnMs: 10000,
};

/** The runtime with real message and session stores and a small trigger model. */
function setup(t) {
	const root = mkdtempSync(join(tmpdir(), 'bot-outcome-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const messages = new BotMessageStore(join(root, 'messages'));
	const sessions = new BotSessionStore(join(root, 'sessions'));
	t.after(() => sessions.close());
	const state = {
		revision: 7,
		triggers: [{ id: TRIGGER, name: 'Tickets', onNeedsHuman: 'pause' }],
	};
	const triggers = {
		list: (botId) => ({
			revision: state.revision,
			triggers: botId === bot ? state.triggers : [],
		}),
		block(_bot, id, reason, action, sessionId) {
			const t = state.triggers.find((x) => x.id === id);
			const fresh = !t.blocker;
			t.blocker = {
				...(t.blocker ?? { id: 'b'.repeat(24), sessionId }),
				reason,
				action,
			};
			state.revision++;
			if (fresh)
				messages.post(
					bot,
					'bot',
					`${reason}\n${action}`,
					sessionId,
					`blocker:${t.blocker.id}`,
				);
			return fresh;
		},
		unblock(_bot, id) {
			delete state.triggers.find((x) => x.id === id).blocker;
			state.revision++;
		},
	};
	let runtime;
	const service = {
		messages,
		sessions,
		triggers,
		now: () => Date.now(),
		queue: { promote: () => true, active: () => [] },
		redactMessage: async (_bot, text) =>
			text.replaceAll('hunter2', '[redacted]'),
		postBotMessage: async (id, text, key) => {
			runtime.assert(id);
			return messages.post(sessions.get(id).botId, 'bot', text, id, key);
		},
	};
	runtime = new BotExecutionRuntime(
		service,
		async () => {
			throw Error('no engine access');
		},
		'server',
	);
	const create = (origin) => {
		const message = messages.post(
			bot,
			'user',
			'go',
			null,
			Math.random().toString(),
		);
		const record = sessions.create(
			bot,
			origin ?? { kind: 'chat', messageId: message.id },
			snapshot,
		);
		runtime.register(record.id);
		sessions.patch(record.id, { state: 'running' });
		return sessions.get(record.id);
	};
	const fromTrigger = () =>
		create({
			kind: 'trigger',
			triggerId: TRIGGER,
			triggerName: 'Tickets',
			fireTime: Date.now(),
		});
	const posts = () =>
		messages.list(bot, { limit: 25 }).items.filter((m) => m.author === 'bot');
	return { runtime, sessions, state, create, fromTrigger, posts };
}

test('outcome_report is listed with a bounded schema', () => {
	const tool = BOT_RUNTIME_TOOLS.find((t) => t.name === 'outcome_report');
	assert.ok(tool);
	assert.deepEqual(tool.inputSchema.required, ['disposition', 'reason', 'key']);
	assert.deepEqual(tool.inputSchema.properties.disposition.enum, [
		'outside-control',
		'needs-human',
		'fixed',
	]);
	assert.equal(tool.inputSchema.additionalProperties, false);
});

test('outside-control is stored redacted on the execution and posts nothing', async (t) => {
	const r = setup(t);
	const me = r.fromTrigger();
	const result = await r.runtime.call(me.id, 'outcome_report', {
		disposition: 'outside-control',
		reason: 'host engine overloaded; password hunter2 unrelated',
		key: 'one',
	});
	assert.equal(result.posted, false);
	const outcome = r.sessions.get(me.id).outcome;
	assert.equal(outcome.disposition, 'outside-control');
	assert.equal(
		outcome.reason,
		'host engine overloaded; password [redacted] unrelated',
	);
	assert.equal(outcome.triggerId, TRIGGER);
	assert.equal(r.posts().length, 0);
	assert.equal(r.state.triggers[0].blocker, undefined);
});

test('needs-human on a trigger records one blocker and one post; a repeat updates without posting', async (t) => {
	const r = setup(t);
	const a = r.fromTrigger();
	const first = await r.runtime.call(a.id, 'outcome_report', {
		disposition: 'needs-human',
		reason: 'Portal login refused',
		action: 'Add the support portal password to the bot’s secrets',
		revision: 7,
		key: 'k',
	});
	assert.equal(first.posted, true);
	assert.equal(first.waitingForUser, true);
	// The same key replays the receipt.
	assert.deepEqual(
		await r.runtime.call(a.id, 'outcome_report', {
			disposition: 'needs-human',
			reason: 'x',
			action: 'y',
			revision: 0,
			key: 'k',
		}),
		first,
	);
	const b = r.fromTrigger();
	const second = await r.runtime.call(b.id, 'outcome_report', {
		disposition: 'needs-human',
		reason: 'Still refused',
		action: 'Add the password',
		revision: first.revision,
		key: 'k',
	});
	assert.equal(second.posted, false);
	assert.equal(r.posts().length, 1);
	assert.equal(r.state.triggers[0].blocker.reason, 'Still refused');
});

test('two executions reporting needs-human together give one blocker and one post', async (t) => {
	const r = setup(t);
	const a = r.fromTrigger(),
		b = r.fromTrigger();
	const report = (id) =>
		r.runtime.call(id, 'outcome_report', {
			disposition: 'needs-human',
			reason: 'Login refused',
			action: 'Add the password',
			revision: 7,
			key: 'same',
		});
	const results = await Promise.allSettled([report(a.id), report(b.id)]);
	// The second is applied after the first, so its observed revision is stale.
	assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
	assert.match(
		results.find((x) => x.status === 'rejected').reason.message,
		/revision changed/,
	);
	assert.equal(r.posts().length, 1);
});

test('needs-human needs an action, bounded reasons, and a revision when it changes a trigger', async (t) => {
	const r = setup(t);
	const me = r.fromTrigger();
	await assert.rejects(
		r.runtime.call(me.id, 'outcome_report', {
			disposition: 'needs-human',
			reason: 'x',
			revision: 7,
			key: 'a',
		}),
		/needs an action/,
	);
	await assert.rejects(
		r.runtime.call(me.id, 'outcome_report', {
			disposition: 'fixed',
			reason: 'é'.repeat(300),
			revision: 7,
			key: 'b',
		}),
		/invalid reason/,
	);
	await assert.rejects(
		r.runtime.call(me.id, 'outcome_report', {
			disposition: 'fixed',
			reason: 'done',
			key: 'c',
		}),
		/revision is required/,
	);
	await assert.rejects(
		r.runtime.call(me.id, 'outcome_report', {
			disposition: 'maybe',
			reason: 'done',
			key: 'd',
		}),
		/disposition/,
	);
});

test('a stale revision is refused and the blocker stays; the current one clears it', async (t) => {
	const r = setup(t);
	r.state.triggers[0].blocker = {
		id: 'b'.repeat(24),
		reason: 'r',
		action: 'a',
	};
	const chat = r.create();
	await assert.rejects(
		r.runtime.call(chat.id, 'outcome_report', {
			disposition: 'fixed',
			reason: 'Password added',
			triggerId: TRIGGER,
			revision: 6,
			key: 'a',
		}),
		(e) => e instanceof BotError && e.code === 'conflict',
	);
	assert.ok(r.state.triggers[0].blocker);
	const fixed = await r.runtime.call(chat.id, 'outcome_report', {
		disposition: 'fixed',
		reason: 'Password added',
		triggerId: TRIGGER,
		revision: 7,
		key: 'b',
	});
	assert.equal(fixed.waitingForUser, false);
	assert.equal(r.state.triggers[0].blocker, undefined);
});

test('another bot’s trigger is not found and changes nothing', async (t) => {
	const r = setup(t);
	const chat = r.create();
	await assert.rejects(
		r.runtime.call(chat.id, 'outcome_report', {
			disposition: 'fixed',
			reason: 'x',
			triggerId: 'o'.repeat(24),
			revision: 7,
			key: 'a',
		}),
		/not found/,
	);
	assert.equal(r.sessions.get(chat.id).outcome ?? null, null);
});

test('a chat execution that needs a human posts once and records no blocker', async (t) => {
	const r = setup(t);
	const chat = r.create();
	const one = await r.runtime.call(chat.id, 'outcome_report', {
		disposition: 'needs-human',
		reason: 'No access to the calendar',
		action: 'Share the calendar with the bot',
		key: 'a',
	});
	assert.equal(one.posted, true);
	const two = await r.runtime.call(chat.id, 'outcome_report', {
		disposition: 'needs-human',
		reason: 'Still no access',
		action: 'Share it',
		key: 'b',
	});
	assert.equal(two.posted, false);
	assert.equal(r.posts().length, 1);
	assert.equal(r.state.triggers[0].blocker, undefined);
	assert.equal(r.sessions.get(chat.id).outcome.reason, 'Still no access');
});

test('an ended execution cannot report', async (t) => {
	const r = setup(t);
	const me = r.fromTrigger();
	r.sessions.patch(me.id, {
		state: 'completed',
		open: false,
		endedAt: Date.now(),
	});
	await assert.rejects(
		r.runtime.call(me.id, 'outcome_report', {
			disposition: 'outside-control',
			reason: 'x',
			key: 'a',
		}),
		/no longer active/,
	);
});

test('briefings list temporary failures with attempts, outcomes and triggers waiting for the user', async (t) => {
	const r = setup(t);
	const failed = r.fromTrigger();
	r.sessions.patch(failed.id, {
		state: 'failed',
		open: false,
		endedAt: Date.now(),
		reason:
			'The terminay_bot adapter check timed out. The host may be overloaded.',
		dispatchedAt: null,
		startupFailure: {
			stage: 'adapter-check',
			temporary: true,
			code: 'adapter-timeout',
		},
		attempts: Array.from({ length: 4 }, (_, i) => ({
			stage: 'adapter-check',
			temporary: true,
			code: 'adapter-timeout',
			at: Date.now() - i,
			cause: 'timed out',
		})),
		outcome: {
			disposition: 'outside-control',
			reason: 'host overloaded',
			action: null,
			triggerId: TRIGGER,
			at: Date.now(),
		},
	});
	r.state.triggers[0].blocker = {
		id: 'b'.repeat(24),
		reason: 'Login refused',
		action: 'Add the password',
	};
	const me = r.create();
	const briefing = r.runtime.briefing(me.id);
	const context = JSON.parse(briefing.split('\n').at(-1));
	const [f] = context.recentFailures;
	assert.equal(f.startupStage, 'adapter-check');
	assert.equal(f.temporary, true);
	assert.equal(f.attempts, 4);
	assert.equal(f.outcome.disposition, 'outside-control');
	assert.deepEqual(context.waitingTriggers, [
		{
			id: TRIGGER,
			name: 'Tickets',
			paused: true,
			reason: 'Login refused',
			action: 'Add the password',
		},
	]);
	assert.match(briefing, /marked temporary/);
	assert.match(briefing, /outcome_report/);
	const detail = await r.runtime.call(me.id, 'sessions_get', {
		sessionId: failed.id,
	});
	assert.equal(detail.startupFailure.code, 'adapter-timeout');
	assert.equal(detail.attempts, 4);
});
