import assert from 'node:assert/strict';
import test from 'node:test';
import { createGiteaForgeSource, createTeaTokenStore } from '../dist/index.js';

const ORIGIN = 'https://git.example.net';
const login = (token, url = ORIGIN) =>
	`logins:\n  - url: ${url}\n    token: ${token}\n    user: me\n`;
const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

/**
 * A fake tea config file. Its watches behave like fs.watch on a file: a watch
 * can't be set on a missing file, and any write fires every live watch.
 */
function fakeTeaFile(initial) {
	const state = {
		text: initial,
		reads: 0,
		watches: 0,
		open: new Set(),
		failWatch: false,
		gate: undefined,
	};
	return {
		state,
		readFile: async () => {
			state.reads += 1;
			const text = state.text;
			if (state.gate !== undefined) await state.gate;
			if (text === undefined) throw enoent();
			return text;
		},
		watch: (_path, onChange) => {
			if (state.failWatch || state.text === undefined) throw enoent();
			state.watches += 1;
			const watcher = { onChange, close: () => state.open.delete(watcher) };
			state.open.add(watcher);
			return watcher;
		},
		/** Delete (undefined), edit, or rename a new file over this one. */
		write(text) {
			state.text = text;
			for (const watcher of [...state.open]) watcher.onChange();
		},
		/** Every live watcher reports an error. */
		fail() {
			for (const watcher of [...state.open])
				watcher.onChange(new Error('EPERM'));
		},
	};
}

function storeFor(file) {
	return createTeaTokenStore({
		path: '/tea.yml',
		readFile: file.readFile,
		watch: file.watch,
	});
}

test('a tea config created after start is read on the next lookup', async () => {
	const file = fakeTeaFile(undefined);
	const store = storeFor(file);
	assert.deepEqual(await store.origins(), []);
	assert.equal(await store.token(ORIGIN), undefined);

	file.state.text = login('fresh'); // `tea login`; nothing watches a missing file
	assert.deepEqual(await store.origins(), [ORIGIN]);
	assert.equal(await store.token(ORIGIN), 'fresh');
	assert.equal(await store.user(ORIGIN), 'me');
	assert.equal(file.state.open.size, 1);

	const reads = file.state.reads;
	await store.token(ORIGIN);
	assert.equal(file.state.reads, reads, 'a watched, successful read is kept');
});

test('a deleted, re-created, edited and renamed-over tea config is followed', async () => {
	const file = fakeTeaFile(login('first'));
	const store = storeFor(file);
	assert.equal(await store.token(ORIGIN), 'first');
	assert.equal(file.state.open.size, 1);

	file.write(undefined);
	assert.equal(
		file.state.open.size,
		0,
		'the watch on the deleted file is closed',
	);
	assert.equal(await store.token(ORIGIN), undefined);

	file.state.text = login('second');
	assert.equal(await store.token(ORIGIN), 'second');
	assert.equal(
		file.state.open.size,
		1,
		'a fresh watch guards the re-created file',
	);

	file.write(login('third'));
	assert.equal(await store.token(ORIGIN), 'third');

	file.write(login('fourth'));
	assert.equal(await store.token(ORIGIN), 'fourth');
	assert.equal(file.state.open.size, 1);
	assert.equal(file.state.watches, 4);
});

test('without a live watch the tea config is never kept', async () => {
	const unwatchable = fakeTeaFile(login('one'));
	unwatchable.state.failWatch = true;
	const store = storeFor(unwatchable);
	assert.equal(await store.token(ORIGIN), 'one');
	unwatchable.state.text = login('two');
	assert.equal(await store.token(ORIGIN), 'two');

	const erroring = fakeTeaFile(login('one'));
	const other = storeFor(erroring);
	assert.equal(await other.token(ORIGIN), 'one');
	erroring.state.text = login('after-error');
	erroring.fail();
	assert.equal(erroring.state.open.size, 0, 'an errored watch is dropped');
	assert.equal(await other.token(ORIGIN), 'after-error');
	assert.equal(erroring.state.open.size, 1);
});

test('a change during a read is not lost', async () => {
	const file = fakeTeaFile(login('before'));
	const store = storeFor(file);
	let release;
	file.state.gate = new Promise((resolve) => {
		release = resolve;
	});
	const inFlight = store.token(ORIGIN);
	await Promise.resolve();
	file.write(login('during'));
	file.state.gate = undefined;
	release();
	assert.equal(await inFlight, 'before');
	assert.equal(await store.token(ORIGIN), 'during');
});

test('a rejected tea token stays unused until the file changes', async () => {
	const file = fakeTeaFile(login('A'));
	const store = storeFor(file);
	assert.equal(await store.token(ORIGIN), 'A');
	store.reject(ORIGIN);
	assert.equal(await store.token(ORIGIN), undefined);
	assert.equal(await store.token(ORIGIN), undefined);

	const unwatched = createTeaTokenStore({
		path: '/tea.yml',
		readFile: async () => login('A'),
	});
	assert.equal(await unwatched.token(ORIGIN), 'A');
	unwatched.reject(ORIGIN);
	assert.equal(
		await unwatched.token(ORIGIN),
		undefined,
		're-reading an unchanged file never re-offers it',
	);

	file.write(login('B'));
	assert.equal(await store.token(ORIGIN), 'B');
});

test('Check again lists a tea account whose config appeared after start', async () => {
	const file = fakeTeaFile(undefined);
	const calls = [];
	const fetch = async (url, init) => {
		calls.push(init?.headers?.authorization);
		const path = new URL(url).pathname.replace(/^\/api\/v1/u, '');
		const body = path === '/user' ? { login: 'me' } : [];
		return {
			status: 200,
			ok: true,
			headers: { get: () => null },
			json: async () => body,
		};
	};
	const source = createGiteaForgeSource({
		fetch,
		probe: { isGitea: async (origin) => origin === ORIGIN },
		tea: storeFor(file),
		credentials: {
			token: async () => undefined,
			reject: async () => {},
			onAvailable: () => ({ dispose() {} }),
		},
	});
	const signal = new AbortController().signal;
	assert.deepEqual(await source.accounts(signal), []);

	file.state.text = login('late');
	const accounts = await source.accounts(signal);
	assert.deepEqual(
		accounts.map((account) => [
			account.origin,
			account.login,
			account.credentialSource,
			account.state,
		]),
		[[ORIGIN, 'me', 'cli-config', 'ready']],
	);
	assert.ok(
		calls.length > 0 &&
			calls.every((authorization) => authorization === 'token late'),
	);
});
