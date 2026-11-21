import assert from 'node:assert/strict';
import test from 'node:test';
import { ClientError } from '@terminay/client-core';
import {
	createLatestEditGuard,
	enqueueByKey,
	PROJECT_SAVE_ATTEMPTS,
	projectSaveErrorMessage,
	withFreshRevision,
	writeProjectEdit,
} from './useProjectEditor.ts';

const stale = () => new ClientError('conflict', 'workspace revision is stale');

function fakeServer(initialRoot: string) {
	const state = { revision: 1, root: initialRoot, name: 'Project' };
	const snapshot = () => ({
		revision: state.revision,
		projects: { p: { root: state.root } },
	});
	const store = {
		snapshot: snapshot(),
		async refresh() {
			store.snapshot = snapshot();
			return store.snapshot;
		},
	};
	const commit = (expected: number | undefined) => {
		if (expected !== undefined && expected !== state.revision) throw stale();
		state.revision += 1;
	};
	const client = {
		async setProjectShellProfile() {},
		async updateProjectRoot(request: {
			root: string;
			expectedRevision?: number;
		}) {
			commit(request.expectedRevision);
			state.root = request.root;
			return { root: request.root };
		},
		async updateProject(
			request: { name: string; root: string },
			options: { expectedRevision?: number },
		) {
			commit(options.expectedRevision);
			state.name = request.name;
			state.root = request.root;
		},
	};
	return { state, store, client };
}

const edit = (
	server: ReturnType<typeof fakeServer>,
	root: string,
	rootChanged: boolean,
	title = 'Renamed',
) =>
	writeProjectEdit({
		// biome-ignore lint/suspicious/noExplicitAny: a structural test double.
		client: server.client as any,
		// biome-ignore lint/suspicious/noExplicitAny: a structural test double.
		store: server.store as any,
		projectId: 'p',
		root,
		rootChanged,
		title,
		color: '#000000',
		emoji: '',
	});

test('a failed save tells the person why', () => {
	assert.equal(
		projectSaveErrorMessage(stale()),
		'Unable to save project: workspace revision is stale',
	);
});

test('a finished edit does not take focus from an editor opened after it', () => {
	const startEdit = createLatestEditGuard();
	const first = startEdit();
	assert.equal(first(), true);
	const second = startEdit();
	assert.equal(first(), false);
	assert.equal(second(), true);
});

test('a rename from an older draft keeps the newer committed root', async () => {
	const server = fakeServer('/newer');
	await edit(server, '/older', false);
	assert.equal(server.state.root, '/newer');
	assert.equal(server.state.name, 'Renamed');
});

test("a retry keeps another client's root committed after the first attempt", async () => {
	const server = fakeServer('/first');
	const update = server.client.updateProject;
	let raced = false;
	server.client.updateProject = async (request, options) => {
		if (!raced) {
			raced = true;
			server.state.root = '/other-client';
			server.state.revision += 1;
		}
		return update(request, options);
	};
	await edit(server, '/first', false);
	assert.equal(server.state.root, '/other-client');
	assert.equal(server.state.name, 'Renamed');
});

test('overlapping saves of one project apply in order and end on the last root', async () => {
	const server = fakeServer('/start');
	const queues = new Map<string, Promise<unknown>>();
	await Promise.all([
		enqueueByKey(queues, 'p', () => edit(server, '/one', true)),
		enqueueByKey(queues, 'p', () => edit(server, '/two', true)),
	]);
	assert.equal(server.state.root, '/two');
});

test('presentation writes do not repeat a root move after another client changes it', async () => {
	const server = fakeServer('/start');
	const update = server.client.updateProject;
	let raced = false;
	server.client.updateProject = async (request, options) => {
		if (!raced) {
			raced = true;
			server.state.root = '/other-client';
			server.state.revision += 1;
		}
		return update(request, options);
	};
	assert.equal(await edit(server, '/my-change', true), '/other-client');
	assert.equal(server.state.root, '/other-client');
	assert.equal(server.state.name, 'Renamed');
});

test('a failed save rejects for its caller and the next save still runs', async () => {
	const queues = new Map<string, Promise<unknown>>();
	const failed = enqueueByKey(queues, 'p', async () => {
		throw new Error('refused');
	});
	const next = enqueueByKey(queues, 'p', async () => 'ran');
	await assert.rejects(failed, /refused/u);
	assert.equal(await next, 'ran');
});

test('a stale revision is retried and recovers', async () => {
	let calls = 0;
	const value = await withFreshRevision(
		() => calls,
		async () => {},
		async () => {
			calls += 1;
			if (calls < PROJECT_SAVE_ATTEMPTS) throw stale();
			return 'saved';
		},
	);
	assert.equal(value, 'saved');
	assert.equal(calls, PROJECT_SAVE_ATTEMPTS);
});

test('stale retries stop at the attempt limit', async () => {
	let calls = 0;
	await assert.rejects(
		withFreshRevision(
			() => 1,
			async () => {},
			async () => {
				calls += 1;
				throw stale();
			},
		),
		/stale/u,
	);
	assert.equal(calls, PROJECT_SAVE_ATTEMPTS);
});

test('another conflict is not retried', async () => {
	let calls = 0;
	await assert.rejects(
		withFreshRevision(
			() => 1,
			async () => {},
			async () => {
				calls += 1;
				throw new ClientError('conflict', 'project is awaiting a start choice');
			},
		),
		/awaiting/u,
	);
	assert.equal(calls, 1);
});

test('a failed refresh ends the save', async () => {
	let calls = 0;
	await assert.rejects(
		withFreshRevision(
			() => 1,
			async () => {
				throw new Error('refresh failed');
			},
			async () => {
				calls += 1;
				throw stale();
			},
		),
		/refresh failed/u,
	);
	assert.equal(calls, 1);
});
