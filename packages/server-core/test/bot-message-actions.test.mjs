import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	describeBotAction,
	describeRedactedBotAction,
} from '../dist/botService/actionWording.js';
import {
	BOT_MAX_ACTIONS,
	BotMessageStore,
} from '../dist/botService/messages.js';

const bot = 'abc123def456';
const exec = 'a'.repeat(24);
const other = 'b'.repeat(24);
const terminal = { kind: 'terminal', projectId: 'project-1', sessionId: 's-1' };

function setup(t) {
	const root = mkdtempSync(join(tmpdir(), 'bot-actions-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return { root, store: new BotMessageStore(root) };
}
const typed = (extra = {}) => ({
	text: 'Typed into the terminal “api”',
	tool: 'write_terminal',
	outcome: 'done',
	target: terminal,
	...extra,
});

test('an action is a bot row with activity and survives reload', (t) => {
	const { root, store } = setup(t);
	const row = store.recordActivity(bot, exec, typed());
	assert.equal(row.author, 'bot');
	assert.equal(row.executionId, exec);
	assert.deepEqual(row.activity, {
		tool: 'write_terminal',
		outcome: 'done',
		target: terminal,
		count: 1,
	});
	const reloaded = new BotMessageStore(root);
	assert.deepEqual(reloaded.get(bot, row.id).activity, row.activity);
	assert.equal(
		reloaded.events(bot, reloaded.eventCursor(bot, 0)).items.at(-1).type,
		'action.recorded',
	);
});

test('identical consecutive actions fold in place; anything different does not', (t) => {
	const { store } = setup(t);
	const first = store.recordActivity(bot, exec, typed());
	for (let i = 0; i < 4; i++) store.recordActivity(bot, exec, typed());
	const folded = store.get(bot, first.id);
	assert.equal(folded.activity.count, 5);
	assert.equal(folded.revision, 5);
	assert.equal(folded.sequence, first.sequence);
	assert.equal(store.count(bot), 1);
	// Different text (another command), target, outcome, execution: new rows.
	store.recordActivity(
		bot,
		exec,
		typed({ text: 'Ran `npm test` in api', tool: 'run_command' }),
	);
	store.recordActivity(
		bot,
		exec,
		typed({ text: 'Ran `npm run build` in api', tool: 'run_command' }),
	);
	store.recordActivity(
		bot,
		exec,
		typed({ target: { ...terminal, sessionId: 's-2' } }),
	);
	store.recordActivity(
		bot,
		exec,
		typed({
			target: { ...terminal, sessionId: 's-2' },
			outcome: 'failed',
			reason: 'x: y',
		}),
	);
	store.recordActivity(
		bot,
		other,
		typed({
			target: { ...terminal, sessionId: 's-2' },
			outcome: 'failed',
			reason: 'x: y',
		}),
	);
	assert.equal(store.count(bot), 6);
	// A message between two identical actions stops folding.
	store.recordActivity(bot, exec, typed());
	store.post(bot, 'bot', 'Done', exec, 'k1');
	store.recordActivity(bot, exec, typed());
	assert.equal(store.count(bot), 9);
});

test('actions cannot be edited or deleted, and clear removes them', (t) => {
	const { store } = setup(t);
	const row = store.recordActivity(bot, exec, typed());
	assert.throws(
		() => store.edit(bot, row.id, 1, 'changed'),
		/cannot be edited/,
	);
	assert.throws(() => store.edit(bot, row.id, 1, null), /cannot be edited/);
	assert.equal(store.get(bot, row.id).text, row.text);
	store.clear(bot);
	assert.equal(store.count(bot), 0);
});

test('actions never become unacknowledged posts', (t) => {
	const { store } = setup(t);
	store.recordActivity(bot, exec, typed());
	assert.equal(store.unacknowledged(bot), undefined);
	store.post(bot, 'bot', 'One post', exec, 'k1');
	store.recordActivity(
		bot,
		exec,
		typed({ text: 'Opened a terminal', tool: 'open_terminal' }),
	);
	store.recordActivity(bot, exec, typed());
	const posts = store.unacknowledged(bot);
	assert.equal(posts.count, 1);
	assert.equal(posts.body, 'One post');
});

test('list can leave actions out, and binds that choice into its cursor', (t) => {
	const { store } = setup(t);
	for (let i = 0; i < 12; i++) {
		store.post(bot, 'bot', `Post ${i}`, exec, `k${i}`);
		store.recordActivity(
			bot,
			exec,
			typed({ text: `Opened ${i}`, tool: 'open_terminal' }),
		);
	}
	const all = store.list(bot, { limit: 25 });
	assert.equal(all.total, 24);
	assert.ok(all.items.some((m) => m.activity?.tool === 'open_terminal'));
	const posts = store.list(bot, { limit: 5, actions: false });
	assert.equal(posts.total, 12);
	assert.ok(posts.items.every((m) => m.activity === undefined));
	assert.throws(() => store.list(bot, { cursor: posts.nextCursor }), /query/);
	assert.equal(
		store.list(bot, { cursor: posts.nextCursor, limit: 5, actions: false })
			.items.length,
		5,
	);
});

test('text and reason are cut on UTF-8 boundaries', (t) => {
	const { store } = setup(t);
	const row = store.recordActivity(bot, exec, {
		text: '😀'.repeat(300),
		tool: 'run_command',
		outcome: 'failed',
		reason: 'é'.repeat(300),
	});
	assert.ok(Buffer.byteLength(row.text) <= 512);
	assert.ok(Buffer.byteLength(row.activity.reason) <= 200);
	assert.ok(!row.text.includes('�'));
	assert.ok(!row.activity.reason.includes('�'));
	assert.throws(
		() => store.recordActivity(bot, exec, { ...typed(), tool: 'Bad Tool' }),
		/Invalid/,
	);
	assert.throws(
		() =>
			store.recordActivity(bot, exec, { ...typed(), target: { kind: 'nope' } }),
		/Invalid/,
	);
});

test('the oldest actions go past the cap, never a message, and posting stays allowed', (t) => {
	const { root, store } = setup(t);
	store.post(bot, 'user', 'Keep me', null, 'keep');
	store.recordActivity(bot, exec, typed({ text: 'first action' }));
	// Seed the cap directly: thousands of durable writes add no coverage.
	const path = join(root, bot, 'messages.json');
	const state = JSON.parse(readFileSync(path, 'utf8'));
	const template = state.rows.at(-1);
	for (let n = 1; n < BOT_MAX_ACTIONS; n++) {
		state.sequence += 1;
		state.rows.push({
			...template,
			id: n.toString(16).padStart(24, '0'),
			text: `action ${n}`,
			sequence: state.sequence,
			change: state.sequence,
		});
	}
	writeFileSync(path, JSON.stringify(state));
	const loaded = new BotMessageStore(root);
	assert.equal(loaded.count(bot), BOT_MAX_ACTIONS + 1);
	loaded.recordActivity(bot, exec, typed({ text: 'newest action' }));
	assert.equal(loaded.count(bot), BOT_MAX_ACTIONS + 1);
	const texts = loaded.list(bot, { search: 'first action' });
	assert.equal(texts.total, 0);
	assert.equal(loaded.list(bot, { search: 'Keep me' }).total, 1);
	assert.ok(loaded.post(bot, 'user', 'Still posting', null, 'later'));
});

test('stored activity on a user row is refused at load', (t) => {
	const { root, store } = setup(t);
	store.post(bot, 'user', 'Hello', null, 'k');
	const path = join(root, bot, 'messages.json');
	const state = JSON.parse(readFileSync(path, 'utf8'));
	state.rows[0].activity = { tool: 'open_terminal', outcome: 'done', count: 1 };
	writeFileSync(path, JSON.stringify(state));
	// An invalid snapshot is never loaded; the store falls back to a valid one.
	const loaded = new BotMessageStore(root);
	assert.ok(loaded.list(bot).items.every((m) => m.activity === undefined));
});

test('wording: past tense when done, "Couldn\'t" when failed, quoting only what was asked', () => {
	assert.equal(
		describeBotAction('create_project', { name: 'api' }, 'done'),
		'Created the project “api”',
	);
	assert.equal(
		describeBotAction('create_project', { name: 'api' }, 'failed'),
		"Couldn't create the project “api”",
	);
	assert.equal(
		describeBotAction('run_command', { command: 'npm test' }, 'done', {
			terminal: 'api',
		}),
		'Ran `npm test` in the terminal “api”',
	);
	const long = describeBotAction(
		'run_command',
		{ command: 'x'.repeat(200) },
		'done',
	);
	assert.ok(long.includes(`${'x'.repeat(79)}…`));
	assert.ok(!long.includes('x'.repeat(80)));
	assert.equal(
		describeBotAction('write_terminal', { data: 'secret output' }, 'done', {
			terminal: 'api',
		}),
		'Typed into the terminal “api”',
	);
	assert.equal(
		describeBotAction(
			'update_settings',
			{ settings: { theme: 'dark-secret' } },
			'done',
		),
		'Changed the setting theme',
	);
	assert.equal(
		describeBotAction(
			'triggers_create',
			{ draft: { name: 'Nightly' } },
			'done',
		),
		'Created the trigger “Nightly”',
	);
	assert.equal(
		describeBotAction('mystery_tool', {}, 'done'),
		'Used mystery_tool',
	);
});

test('a secret crossing the quoting cut is redacted whole, before it is shortened', async () => {
	const secret = `sk-${'q'.repeat(40)}`;
	const redact = async (value) => value.replaceAll(secret, '[redacted]');
	// The secret starts before the 80-character command cut and ends after it,
	// and likewise across the 60-character terminal-name cut.
	const command = `${'x'.repeat(60)} ${secret} tail`;
	const { text, reason } = await describeRedactedBotAction(
		{
			tool: 'run_command',
			params: { command },
			names: { terminal: `${'t'.repeat(40)}${secret}` },
			outcome: 'failed',
			reason: `internal: ${secret}`,
		},
		redact,
	);
	assert.ok(!text.includes('sk-q'), text);
	assert.ok(text.includes('[redacted]'), text);
	assert.equal(reason, 'internal: [redacted]');
	await assert.rejects(
		describeRedactedBotAction(
			{
				tool: 'create_project',
				params: { name: 'a', root: 'b' },
				outcome: 'done',
			},
			async () => 'collapsed',
		),
		/shape/,
	);
});
