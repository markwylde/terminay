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
import { BotStore } from '../dist/botService/index.js';

test('5.1 profiles survive restart, names are unique and revisions conflict without touching an engine', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bots-store-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, 'bots.json');
	const store = new BotStore(path);
	const bot = store.save({
		name: 'Bird',
		agentId: 'fake.agent',
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
	});
	assert.equal(bot.modelId, null);
	assert.equal(bot.approvalMode, 'autonomous');
	assert.deepEqual(new BotStore(path).list(), [bot]);
	assert.throws(
		() => store.save({ name: 'Bird', agentId: 'fake.agent' }),
		/already exists/,
	);
	assert.throws(
		() => store.save({ ...bot, name: 'Other' }, 0),
		/revision changed/,
	);
	for (const draft of [
		{ name: 'x'.repeat(41) },
		{ description: 'x'.repeat(201) },
		{ instructions: '🦜'.repeat(8193) },
		{ avatar: 'two' },
		{ signIn: { kind: 'token', environmentVariable: 'bad-name' } },
	])
		assert.throws(() => store.save({ ...bot, ...draft }));
	store.save({ ...bot, modelId: 'selected' });
	assert.equal(
		store.save({ ...bot, agentId: 'other.agent', modelId: 'selected' }).modelId,
		null,
	);
	assert.equal(JSON.parse(readFileSync(path, 'utf8')).revision, 3);
});
test('a stored turn limit is ignored on load and dropped on save', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bots-turn-limit-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, 'bots.json');
	const store = new BotStore(path);
	const bot = store.save({ name: 'Bird', agentId: 'fake.agent' });
	const stored = JSON.parse(readFileSync(path, 'utf8'));
	stored.bots[0].maxTurnMs = 1_800_000;
	writeFileSync(path, JSON.stringify(stored));
	const loaded = new BotStore(path);
	assert.equal('maxTurnMs' in loaded.get(bot.id), false);
	const saved = loaded.save({ ...loaded.get(bot.id), maxTurnMs: 5 });
	assert.equal('maxTurnMs' in saved, false);
	assert.equal(
		'maxTurnMs' in JSON.parse(readFileSync(path, 'utf8')).bots[0],
		false,
	);
});
test('5.1 corrupt canonical file is preserved and a previous committed copy restored', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bots-corrupt-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, 'bots.json');
	const store = new BotStore(path);
	const bot = store.save({ name: 'Bird', agentId: 'fake.agent' });
	store.save({ ...bot, name: 'Sway' });
	writeFileSync(path, '\0'.repeat(100));
	assert.equal(new BotStore(path).get(bot.id).name, 'Bird');
	assert.equal(
		readdirSync(root).filter((n) => n.includes('.corrupt-')).length,
		1,
	);
	const broken = join(root, 'unrecoverable.json');
	writeFileSync(broken, 'broken');
	assert.throws(
		() => new BotStore(broken),
		(e) => e.code === 'state_unreadable',
	);
	assert.equal(readFileSync(broken, 'utf8'), 'broken');
});

test('source upgrade preserves profiles and schedules and refuses future canonical versions', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bots-upgrade-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, 'bots.json');
	const first = new BotStore(path);
	const bot = first.save({ name: 'Upgrade', agentId: 'fake.agent' });
	const legacy = JSON.parse(readFileSync(path, 'utf8'));
	legacy.version = 1;
	delete legacy.bots[0].enabled;
	writeFileSync(path, JSON.stringify(legacy));
	const upgraded = new BotStore(path);
	assert.equal(upgraded.get(bot.id).enabled, true);
	assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, 2);
	assert.equal(
		JSON.parse(readFileSync(path + '.before-sources-v1', 'utf8')).version,
		1,
	);
	assert.deepEqual(new BotStore(path).list(), upgraded.list());
	const future = { ...JSON.parse(readFileSync(path, 'utf8')), version: 999 };
	const raw = JSON.stringify(future);
	writeFileSync(path, raw);
	assert.throws(() => new BotStore(path), /version/);
	assert.equal(readFileSync(path, 'utf8'), raw);
});

test('Investigate failures defaults on, round-trips an explicit value and rejects a non-boolean', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bots-store-investigate-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, 'bots.json');
	const store = new BotStore(path);
	const bot = store.save({ name: 'Bird', agentId: 'fake.agent' });
	assert.equal(bot.investigateFailures, true);
	store.save({ ...store.get(bot.id), investigateFailures: false });
	assert.equal(new BotStore(path).get(bot.id).investigateFailures, false);
	// A profile written before the setting existed reads as on.
	const raw = JSON.parse(readFileSync(path, 'utf8'));
	for (const b of raw.bots) delete b.investigateFailures;
	writeFileSync(path, JSON.stringify(raw));
	assert.equal(new BotStore(path).get(bot.id).investigateFailures, true);
	assert.throws(() =>
		store.save({ ...store.get(bot.id), investigateFailures: 'yes' }),
	);
});

test('Inspect other bots defaults off, round-trips an explicit value and rejects a non-boolean', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bots-store-inspect-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, 'bots.json');
	const store = new BotStore(path);
	const bot = store.save({ name: 'Bird', agentId: 'fake.agent' });
	assert.equal(bot.inspectOtherBots, false);
	store.save({ ...store.get(bot.id), inspectOtherBots: true });
	assert.equal(new BotStore(path).get(bot.id).inspectOtherBots, true);
	const raw = JSON.parse(readFileSync(path, 'utf8'));
	for (const b of raw.bots) delete b.inspectOtherBots;
	writeFileSync(path, JSON.stringify(raw));
	assert.equal(new BotStore(path).get(bot.id).inspectOtherBots, false);
	assert.throws(() =>
		store.save({ ...store.get(bot.id), inspectOtherBots: 'yes' }),
	);
});

test('Terminay MCP access defaults off, round-trips an explicit value and rejects a non-boolean', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bots-store-mcp-access-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, 'bots.json');
	const store = new BotStore(path);
	const bot = store.save({ name: 'Bird', agentId: 'fake.agent' });
	assert.equal(bot.terminayMcpAccess, false);
	store.save({ ...store.get(bot.id), terminayMcpAccess: true });
	assert.equal(new BotStore(path).get(bot.id).terminayMcpAccess, true);
	// A profile written before the setting existed reads as off.
	const raw = JSON.parse(readFileSync(path, 'utf8'));
	for (const b of raw.bots) delete b.terminayMcpAccess;
	writeFileSync(path, JSON.stringify(raw));
	assert.equal(new BotStore(path).get(bot.id).terminayMcpAccess, false);
	assert.throws(() =>
		store.save({ ...store.get(bot.id), terminayMcpAccess: 'yes' }),
	);
});

test('Avatar style defaults to critter for new and existing bots, round-trips character and rejects unknown styles', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bots-store-avatar-style-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const path = join(root, 'bots.json');
	const store = new BotStore(path);
	const bot = store.save({ name: 'Bird', agentId: 'fake.agent' });
	assert.equal(bot.avatarStyle, 'critter');
	store.save({
		...store.get(bot.id),
		avatarStyle: 'character',
		avatar: '🦜',
		colour: '#f5a97c',
	});
	const savedChar = new BotStore(path).get(bot.id);
	assert.equal(savedChar.avatarStyle, 'character');
	assert.equal(savedChar.avatar, '🦜');
	assert.equal(savedChar.colour, '#f5a97c');
	// Switching back to critter tolerates an empty avatar string.
	const backToCritter = store.save({
		...store.get(bot.id),
		avatarStyle: 'critter',
		avatar: '',
	});
	assert.equal(backToCritter.avatarStyle, 'critter');
	assert.equal(backToCritter.avatar, 'B');
	// A profile saved before avatarStyle existed reads as critter.
	const raw = JSON.parse(readFileSync(path, 'utf8'));
	for (const b of raw.bots) {
		delete b.avatarStyle;
		b.avatar = 'C';
	}
	writeFileSync(path, JSON.stringify(raw));
	assert.equal(new BotStore(path).get(bot.id).avatarStyle, 'critter');
	assert.throws(() =>
		store.save({ ...store.get(bot.id), avatarStyle: 'mecha' }),
	);
});
