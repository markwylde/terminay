import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
	createOpenCodeRecordMapper,
	effectiveOpenCodeRoot,
	isOpenCodeForeground,
	OpenCodeStore,
	safeStorePath,
	storePathFor,
} from '../dist/index.js';

const rootId = 'ses_f9c5cf7fdffeDKS2wDIaso3ubN';

function collect(events) {
	const published = [];
	const publish = new Proxy(
		{},
		{
			get: (_t, kind) => (event) => {
				published.push({ kind, ...event });
			},
		},
	);
	const map = createOpenCodeRecordMapper(rootId);
	for (const [type, data] of events) {
		map({ __opencode: 1, type, data: JSON.stringify(data) }, { publish });
	}
	return published;
}

test('OpenCode is recognized by its executable, never a wrapper', () => {
	assert.equal(isOpenCodeForeground('opencode'), true);
	assert.equal(isOpenCodeForeground('OpenCode'), true);
	assert.equal(isOpenCodeForeground('bun'), false);
	assert.equal(isOpenCodeForeground('agent'), false);
});

test('the data root honours XDG relocation', () => {
	assert.equal(
		effectiveOpenCodeRoot({ XDG_DATA_HOME: '/data' }),
		'/data/opencode',
	);
	assert.match(effectiveOpenCodeRoot({}), /\.local\/share\/opencode$/u);
});

test('a store path is derived from the database or its write-ahead log', () => {
	assert.equal(storePathFor('/x/opencode.db'), '/x/opencode.db');
	assert.equal(storePathFor('/x/opencode.db-wal'), '/x/opencode.db');
	assert.equal(storePathFor('/x/opencode.db-shm'), '/x/opencode.db');
	assert.equal(storePathFor('/x/auth.json'), undefined);
});

test('a store outside the data root is refused', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'opencode-root-'));
	try {
		assert.equal(await safeStorePath('/etc/opencode.db', directory), undefined);
		assert.equal(
			await safeStorePath('relative/opencode.db', directory),
			undefined,
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('a session start names the root by its slug until a title exists', () => {
	const events = collect([
		['session.created.1', { info: { id: rootId, slug: 'curious-eagle' } }],
		[
			'session.updated.1',
			{ info: { id: rootId, slug: 'curious-eagle', title: 'Rebase commits' } },
		],
	]);
	assert.deepEqual(
		events.map((event) => event.kind),
		['sessionStarted', 'metadataChanged', 'metadataChanged'],
	);
	assert.equal(events[1].title, 'curious-eagle');
	assert.equal(events[2].title, 'Rebase commits');
});

test('an event for another session is ignored', () => {
	const events = collect([
		['session.created.1', { info: { id: 'ses_other', slug: 'nope' } }],
	]);
	assert.deepEqual(events, []);
});

test('a turn runs from the user message to the assistant completion', () => {
	const events = collect([
		['session.created.1', { info: { id: rootId, slug: 's' } }],
		['message.updated.1', { info: { id: 'msg_1', role: 'user' } }],
		[
			'message.updated.1',
			{ info: { id: 'msg_2', role: 'assistant', finish: 'stop' } },
		],
	]);
	const kinds = events.map((event) => event.kind);
	assert.ok(kinds.includes('turnStarted'));
	assert.equal(events.at(-1).kind, 'done');
	assert.equal(events.at(-1).outcome, 'success');
});

test('a pending tool part waits and its run clears the wait', () => {
	const events = collect([
		['session.created.1', { info: { id: rootId, slug: 's' } }],
		[
			'message.part.updated.1',
			{
				part: {
					type: 'tool',
					tool: 'write',
					callID: 'call-1',
					state: { status: 'pending' },
				},
			},
		],
		[
			'message.part.updated.1',
			{
				part: {
					type: 'tool',
					tool: 'write',
					callID: 'call-1',
					state: { status: 'running' },
				},
			},
		],
		[
			'message.part.updated.1',
			{
				part: {
					type: 'tool',
					tool: 'write',
					callID: 'call-1',
					state: { status: 'completed' },
				},
			},
		],
	]);
	const kinds = events.map((event) => event.kind);
	assert.deepEqual(kinds.slice(-4), [
		'waitStarted',
		'waitFinished',
		'toolStarted',
		'toolFinished',
	]);
	assert.equal(
		events.find((event) => event.kind === 'waitStarted').state,
		'waiting',
	);
});

test('a task tool part is a child, not an ordinary tool', () => {
	const events = collect([
		['session.created.1', { info: { id: rootId, slug: 's' } }],
		[
			'message.part.updated.1',
			{
				part: {
					type: 'tool',
					tool: 'task',
					callID: 'call-9',
					state: { status: 'running', title: 'Explore parser' },
				},
			},
		],
		[
			'message.part.updated.1',
			{
				part: {
					type: 'tool',
					tool: 'task',
					callID: 'call-9',
					state: { status: 'completed' },
				},
			},
		],
	]);
	const started = events.find((event) => event.kind === 'subagentStarted');
	assert.equal(started.subagentId, 'call-9');
	assert.equal(started.title, 'Explore parser');
	assert.equal(started.parentAgentId, rootId);
	assert.equal(events.at(-1).kind, 'subagentDone');
	assert.equal(
		events.some((event) => event.kind === 'done'),
		false,
		'a child never completes its root',
	);
});

test('an assistant fault with no completion blocks the root', () => {
	// Real error names on this store: APIError, ContextOverflowError,
	// UnknownError and MessageAbortedError. Only the first three are faults.
	const events = collect([
		['session.created.1', { info: { id: rootId, slug: 's' } }],
		[
			'message.updated.1',
			{ info: { id: 'm', role: 'assistant', error: { name: 'APIError' } } },
		],
	]);
	const wait = events.at(-1);
	assert.equal(wait.kind, 'waitStarted');
	assert.equal(wait.state, 'blocked');
	assert.equal(wait.inferred, true);
	assert.equal(wait.reason, 'APIError');
});

test('a user abort completes the turn as cancelled rather than blocking it', () => {
	// 77 of the 99 recorded errors on a real store are MessageAbortedError with
	// no completion. Treating those as blocked would paint every stopped turn
	// red.
	for (const name of ['MessageAbortedError', 'MessageCancelledError']) {
		const events = collect([
			['session.created.1', { info: { id: rootId, slug: 's' } }],
			[
				'message.updated.1',
				{ info: { id: 'm', role: 'assistant', error: { name } } },
			],
		]);
		assert.equal(events.at(-1).kind, 'done', name);
		assert.equal(events.at(-1).outcome, 'cancelled', name);
		assert.equal(
			events.some((event) => event.state === 'blocked'),
			false,
			name,
		);
	}
});

test('a context overflow blocks rather than silently completing', () => {
	const events = collect([
		['session.created.1', { info: { id: rootId, slug: 's' } }],
		[
			'message.updated.1',
			{
				info: {
					id: 'm',
					role: 'assistant',
					error: { name: 'ContextOverflowError' },
				},
			},
		],
	]);
	assert.equal(events.at(-1).state, 'blocked');
});

test('an assistant error on a completed turn is a failed completion, not blocked', () => {
	const events = collect([
		['session.created.1', { info: { id: rootId, slug: 's' } }],
		[
			'message.updated.1',
			{
				info: {
					id: 'm',
					role: 'assistant',
					finish: 'error',
					error: { name: 'ProviderError' },
				},
			},
		],
	]);
	assert.equal(events.at(-1).kind, 'done');
	assert.equal(events.at(-1).outcome, 'error');
});

test('conversation payloads never reach a published event', () => {
	const events = collect([
		['session.created.1', { info: { id: rootId, slug: 's' } }],
		[
			'message.part.updated.1',
			{ part: { type: 'text', text: 'SECRET ASSISTANT TEXT' } },
		],
		[
			'message.part.updated.1',
			{ part: { type: 'reasoning', text: 'SECRET REASONING' } },
		],
		[
			'message.part.updated.1',
			{
				part: {
					type: 'tool',
					tool: 'bash',
					callID: 'c1',
					state: {
						status: 'running',
						input: { command: 'SECRET COMMAND' },
						output: 'SECRET OUTPUT',
					},
				},
			},
		],
	]);
	assert.equal(JSON.stringify(events).includes('SECRET'), false);
});

test('a malformed payload is ignored rather than throwing', () => {
	const published = [];
	const publish = new Proxy(
		{},
		{ get: (_t, kind) => (event) => published.push({ kind, ...event }) },
	);
	const map = createOpenCodeRecordMapper(rootId);
	map(
		{ __opencode: 1, type: 'session.created.1', data: 'not json' },
		{ publish },
	);
	map({ nothing: true }, { publish });
	assert.deepEqual(published, []);
});

test('the store reads only lifecycle columns from a real database', () => {
	const directory = mkdtempSync(join(tmpdir(), 'opencode-store-'));
	const path = join(directory, 'opencode.db');
	try {
		const database = new DatabaseSync(path);
		database.exec(`
			CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER);
			CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT, seq INTEGER, type TEXT, data TEXT);
			INSERT INTO session VALUES ('root-a','p',NULL,'slug-a','Title A','/work',1,10);
			INSERT INTO session VALUES ('root-b','p',NULL,'slug-b','Title B','/work',1,20);
			INSERT INTO session VALUES ('child-a','p','root-b','slug-c','Child','/work',2,21);
			INSERT INTO session VALUES ('other','p',NULL,'slug-d','Other','/elsewhere',1,30);
			INSERT INTO event VALUES ('e1','root-b',1,'session.created.1','{}');
			INSERT INTO event VALUES ('e2','root-b',2,'session.updated.1','{}');
		`);
		database.close();

		const store = new OpenCodeStore(path);
		const roots = store.rootsForDirectory('/work');
		assert.deepEqual(
			roots.map((row) => row.id),
			['root-b', 'root-a'],
			'newest first, parentless only',
		);
		assert.equal(
			roots.some((row) => row.id === 'other'),
			false,
			'another directory is never eligible',
		);
		assert.deepEqual(
			store.childrenOf('root-b').map((row) => row.id),
			['child-a'],
		);
		assert.deepEqual(store.childrenOf('root-a'), []);
		assert.deepEqual(
			store.eventsAfter('root-b', -1).map((row) => row.seq),
			[1, 2],
		);
		assert.deepEqual(
			store.eventsAfter('root-b', 1).map((row) => row.seq),
			[2],
		);
		store.close();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('a store is never opened for writing', () => {
	const directory = mkdtempSync(join(tmpdir(), 'opencode-ro-'));
	const path = join(directory, 'opencode.db');
	try {
		const database = new DatabaseSync(path);
		database.exec(
			'CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER)',
		);
		database.close();
		const store = new OpenCodeStore(path);
		assert.deepEqual(store.rootsForDirectory('/work'), []);
		store.close();
		// Opening read-only means a concurrent writer is never blocked.
		const writer = new DatabaseSync(path);
		writer.exec(
			"INSERT INTO session VALUES ('r','p',NULL,'s','T','/work',1,1)",
		);
		writer.close();
		const reopened = new OpenCodeStore(path);
		assert.deepEqual(
			reopened.rootsForDirectory('/work').map((row) => row.id),
			['r'],
		);
		reopened.close();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
