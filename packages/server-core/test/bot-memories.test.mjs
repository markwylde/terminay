import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BotMemories, BotStore } from '../dist/botService/index.js';
import { memoryHelper } from './fixtures/bot-test-runtime.mjs';

test('5.7 helper CRUD/watch/pins work while stopped; pinned context is newest first, bounded and writes no instruction file', async (t) => {
	const root = mkdtempSync(join(tmpdir(), 'bots-memory-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const store = new BotStore(join(root, 'bots.json'));
	const bot = store.save({
		name: 'Bird',
		agentId: 'fake.agent',
		instructions: 'instructions',
	});
	const helper = memoryHelper();
	const memories = new BotMemories(helper, store);
	helper.files.set('old.md', { text: '# Old\nolder', at: 1 });
	helper.files.set('new.md', { text: `# New\n${'🦜'.repeat(10000)}`, at: 2 });
	memories.pin(bot.id, 'old.md', true);
	memories.pin(bot.id, 'new.md', true);
	const context = await memories.context(store.get(bot.id));
	const block = context.split(
		'Memories are Markdown notes in /home/bot/memories.\n',
	)[1];
	assert.ok(Buffer.byteLength(block) <= 16384);
	assert.match(block, /new.md/);
	assert.ok(!block.includes('old.md'));
	assert.ok(!context.endsWith('\uFFFD'));
	assert.equal((await memories.list(bot.id, 'Old'))[0].title, 'Old');
	let changed = 0;
	const close = await memories.watch(bot.id, () => changed++);
	await memories.write(bot.id, 'made.md', '# Made');
	assert.equal(changed, 1);
	assert.equal(await memories.read(bot.id, 'made.md'), '# Made');
	await memories.remove(bot.id, 'old.md');
	assert.ok(!store.get(bot.id).pinnedMemories.includes('old.md'));
	close();
	close();
	assert.equal(helper.references, 0);
	assert.deepEqual(helper.writes, ['memories/made.md']);
	assert.ok(helper.writes.every((p) => p.startsWith('memories/')));
	await assert.rejects(memories.read(bot.id, '../auth.json'));
	assert.throws(() => memories.pin(bot.id, '../../etc.md', true));
});
