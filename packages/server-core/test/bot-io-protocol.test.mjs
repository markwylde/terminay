import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BotIoClient } from '../../client-core/dist/index.js';
import { BOT_IO_OPERATIONS as op } from '../../protocol/dist/index.js';
import { BotFilesService, BotIoProtocol } from '../dist/botService/index.js';
import { botId, fakeDriver } from './fixtures/bot-driver.mjs';

async function fixture(t) {
	const driver = fakeDriver();
	driver.resources.set('image:terminay-bot:local', {});
	driver.stream = () =>
		spawn(
			process.execPath,
			[
				fileURLToPath(
					new URL('./fixtures/bot-files-helper.mjs', import.meta.url),
				),
			],
			{ stdio: ['pipe', 'pipe', 'pipe'] },
		);
	const files = new BotFilesService('server', {
		engine: async () => driver,
		protectedPaths: () => ['.codex/auth.json'],
	});
	const controller = new AbortController();
	const context = {
		connectionId: 'connection',
		clientId: 'client',
		authScope: 'write',
		signal: new AbortController().signal,
	};
	const io = new BotIoProtocol({
		authority: (c) => ({
			...c,
			signal: controller.signal,
			assertCurrent: () => {
				if (context.authScope !== 'write') throw Error('authority revoked');
			},
		}),
		files,
		shells: {},
		desktops: { closeConnection: () => {} },
	});
	const operations = io.operations();
	const request = (
		operation,
		payload,
		body = new Uint8Array(),
		ctx = context,
	) => ({ context: ctx, body, envelope: { operation, payload } });
	const transport = {
		query: (operation, payload) =>
			operations.queries[operation](request(operation, payload)),
		queryWithBody: async (operation, payload) =>
			operations.queries[operation](request(operation, payload)),
		command: async (operation, payload) => {
			const r = await operations.commands[operation](
				request(operation, payload),
			);
			return r.result;
		},
		commandWithBody: async (operation, payload, body) => {
			const r = await operations.commands[operation](
				request(operation, payload, body),
			);
			return r.result;
		},
	};
	t.after(async () => {
		controller.abort();
		await io.close();
		await files.close();
	});
	return {
		io,
		context,
		controller,
		operations,
		request,
		transport,
		client: new BotIoClient(transport),
	};
}
test('4.9 Files facade traverses canonical operations with binary credit chunks, uploads and cancellation', async (t) => {
	const f = await fixture(t),
		view = await f.client.files(botId);
	assert.equal((await view.list('.')).entries[0].name, 'hello');
	let bytes = 0;
	for await (const b of view.read('large')) bytes += b.length;
	assert.equal(bytes, 5 * 1024 * 1024);
	async function* chunks() {
		yield Buffer.from('new-content');
	}
	await view.write('new-file', 11, chunks());
	let text = '';
	for await (const b of view.read('new-file'))
		text += Buffer.from(b).toString();
	assert.equal(text, 'new-content');
	let changed;
	const next = new Promise((r) => (changed = r));
	const stop = await view.watch(['.'], changed);
	await next;
	stop();
	await view.close();
});
test('every I/O request revalidates authority, connection, bot and generation; revocation tears down files', async (t) => {
	const f = await fixture(t),
		view = await f.client.files(botId),
		p = { ...view.handle, path: '.' };
	for (const context of [
		{ ...f.context, authScope: 'read' },
		{ ...f.context, claims: { projectId: 'project' } },
		{ ...f.context, clientId: 'system:mcp' },
	])
		await assert.rejects(
			f.operations.queries[op.filesList](
				f.request(op.filesList, p, new Uint8Array(), context),
			),
			/authority/,
		);
	for (const patch of [{ connectionId: 'another' }, { clientId: 'another' }])
		await assert.rejects(
			f.operations.queries[op.filesList](
				f.request(op.filesList, p, new Uint8Array(), {
					...f.context,
					...patch,
				}),
			),
			/binding/,
		);
	await assert.rejects(
		f.transport.query(op.filesList, { ...p, generation: p.generation + 1 }),
		/binding/,
	);
	await assert.rejects(
		f.transport.query(op.filesList, { ...p, botId: 'def123abc456' }),
		/binding/,
	);
	f.controller.abort();
	await assert.rejects(view.list('.'));
});
