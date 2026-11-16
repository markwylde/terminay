import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { saveDownload } from './nativeActions.ts';

type Action = { type: string; [key: string]: unknown };
const TOKEN = 'T'.repeat(32);
const MiB = 1024 * 1024;

function installHost(answer: (action: Action) => unknown) {
	const actions: Action[] = [];
	(globalThis as Record<string, unknown>).window = {
		btoa: globalThis.btoa,
		terminayHost: {
			getContext: async () => ({
				sourceId: 'source',
				windowId: 'window',
				profileId: 'profile',
				serverId: 'server',
			}),
			requestAction: async (request: { action: Action }) => {
				actions.push(request.action);
				return answer(request.action);
			},
		},
	};
	return actions;
}

function source(chunks: Uint8Array[], failAfter?: number) {
	const state = { started: false, returned: false };
	const factory = () => ({
		[Symbol.asyncIterator]() {
			state.started = true;
			let i = 0;
			return {
				async next() {
					if (failAfter !== undefined && i === failAfter) throw new Error('helper went away');
					return i < chunks.length
						? { done: false as const, value: chunks[i++] }
						: { done: true as const, value: undefined };
				},
				async return() {
					state.returned = true;
					return { done: true as const, value: undefined };
				},
			};
		},
	});
	return { factory, state };
}

const opened = (action: Action) =>
	action.type === 'file.save.open' ? { canceled: false, token: TOKEN } : undefined;

afterEach(() => {
	delete (globalThis as Record<string, unknown>).window;
});

test('Desktop opens the save first, writes awaited chunks of at most 1 MiB, then commits', async () => {
	const actions = installHost(opened);
	const big = new Uint8Array(MiB + 3).fill(7);
	const { factory } = source([new Uint8Array([1, 2]), big]);
	assert.equal(await saveDownload({ filename: 'a/b.txt', chunks: factory }), true);
	assert.deepEqual(
		actions.map((action) => action.type),
		['file.save.open', 'file.save.write', 'file.save.write', 'file.save.write', 'file.save.close'],
	);
	assert.equal(actions[0].filename, 'a_b.txt');
	const sizes = actions
		.filter((action) => action.type === 'file.save.write')
		.map((action) => Buffer.from(action.bytesBase64 as string, 'base64').byteLength);
	assert.deepEqual(sizes, [2, MiB, 3]);
	assert.deepEqual(actions.at(-1), { type: 'file.save.close', token: TOKEN, commit: true });
});

test('a dotfile keeps its name and an empty file commits with no writes', async () => {
	const actions = installHost(opened);
	assert.equal(await saveDownload({ filename: '.env', chunks: source([]).factory }), true);
	assert.equal(actions[0].filename, '.env');
	assert.deepEqual(
		actions.map((action) => action.type),
		['file.save.open', 'file.save.close'],
	);
});

test('a cancelled dialog never starts the source', async () => {
	const actions = installHost(() => ({ canceled: true }));
	const { factory, state } = source([new Uint8Array([1])]);
	assert.equal(await saveDownload({ filename: 'a.txt', chunks: factory }), false);
	assert.equal(state.started, false);
	assert.deepEqual(actions.map((action) => action.type), ['file.save.open']);
});

test('a source failure abandons the save and rethrows the original error', async () => {
	const actions = installHost(opened);
	const { factory, state } = source([new Uint8Array([1]), new Uint8Array([2])], 1);
	await assert.rejects(saveDownload({ filename: 'a.txt', chunks: factory }), /helper went away/u);
	assert.equal(state.returned, true);
	assert.deepEqual(actions.at(-1), { type: 'file.save.close', token: TOKEN, commit: false });
});

test('a host write failure abandons the save, and a failing abort does not mask it', async () => {
	const actions = installHost((action) => {
		if (action.type === 'file.save.open') return { canceled: false, token: TOKEN };
		if (action.type === 'file.save.write')
			throw new Error(
				"Error invoking remote method 'server-ui-host:request-action': Error: The file could not be saved.",
			);
		if (action.type === 'file.save.close') throw new Error('This save has ended.');
		return undefined;
	});
	const { factory, state } = source([new Uint8Array([1])]);
	await assert.rejects(
		saveDownload({ filename: 'a.txt', chunks: factory }),
		(error: Error) => error.message === 'The file could not be saved.',
	);
	assert.equal(state.returned, true);
	assert.deepEqual(actions.at(-1), { type: 'file.save.close', token: TOKEN, commit: false });
});

test('a browser host uses its own download flow', async () => {
	const clicked: { download: string; href: string }[] = [];
	(globalThis as Record<string, unknown>).window = { setTimeout: () => 0 };
	(globalThis as Record<string, unknown>).document = {
		createElement: () => {
			const anchor = {
				href: '',
				download: '',
				rel: '',
				click: () => clicked.push({ download: anchor.download, href: anchor.href }),
				remove: () => undefined,
			};
			return anchor;
		},
		body: { append: () => undefined },
	};
	try {
		assert.equal(
			await saveDownload({ filename: 'project.tar', chunks: source([new Uint8Array([1])]).factory }),
			true,
		);
		assert.equal(clicked.length, 1);
		assert.equal(clicked[0].download, 'project.tar');
		assert.match(clicked[0].href, /^blob:/u);
	} finally {
		delete (globalThis as Record<string, unknown>).document;
	}
});
