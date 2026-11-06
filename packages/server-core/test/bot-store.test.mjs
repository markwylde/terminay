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
		{ maxTurnMs: 0 },
	])
		assert.throws(() => store.save({ ...bot, ...draft }));
	store.save({ ...bot, modelId: 'selected' });
	assert.equal(
		store.save({ ...bot, agentId: 'other.agent', modelId: 'selected' }).modelId,
		null,
	);
	assert.equal(JSON.parse(readFileSync(path, 'utf8')).revision, 3);
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
