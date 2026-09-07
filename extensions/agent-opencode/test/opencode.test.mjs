import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
	createOpenCodeRecordMapper,
	effectiveOpenCodeRoot,
	isOpenCodeForeground,
	OpenCodeStore,
	openCodeContinues,
	openCodeProvider,
	openCodeWorkingDirectories,
	ROOT_SELECTION,
	safeStorePath,
	selectOpenCodeRoot,
	storePathFor,
	terminalDeviceKey,
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

test('a pending tool part is not a permission wait', () => {
	// `pending` is the state every tool part is first written in, before its
	// input has streamed in. The store records no approval request of any kind,
	// so nothing here may be reported as waiting.
	const events = collect([
		['session.created.1', { info: { id: rootId, slug: 's' } }],
		[
			'message.part.updated.1',
			{
				part: {
					type: 'tool',
					tool: 'write',
					callID: 'call-1',
					state: { status: 'pending', input: {}, raw: '' },
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
	assert.deepEqual(events.map((event) => event.kind).slice(-2), [
		'toolStarted',
		'toolFinished',
	]);
	assert.equal(
		events.some((event) => /^wait/u.test(event.kind)),
		false,
	);
});

test('a child label that arrives late republishes the start', () => {
	const events = collect([
		['session.created.1', { info: { id: rootId, slug: 's' } }],
		[
			'message.part.updated.1',
			{
				part: {
					type: 'tool',
					tool: 'task',
					callID: 'call-8',
					state: { status: 'running', input: {} },
				},
			},
		],
		[
			'message.part.updated.1',
			{
				part: {
					type: 'tool',
					tool: 'task',
					callID: 'call-8',
					state: {
						status: 'running',
						input: { description: 'Audit the parser' },
					},
				},
			},
		],
	]);
	const started = events.filter((event) => event.kind === 'subagentStarted');
	assert.equal(started.length, 2);
	assert.equal(started[0].title, undefined);
	assert.equal(started[1].subagentId, 'call-8');
	assert.equal(started[1].title, 'Audit the parser');
});

test('a child with no description falls back to a bounded prompt line', () => {
	const events = collect([
		['session.created.1', { info: { id: rootId, slug: 's' } }],
		[
			'message.part.updated.1',
			{
				part: {
					type: 'tool',
					tool: 'task',
					callID: 'call-7',
					state: {
						status: 'running',
						input: { prompt: `${'x'.repeat(400)}\nsecond line` },
					},
				},
			},
		],
	]);
	const started = events.find((event) => event.kind === 'subagentStarted');
	// Only a bounded first line is ever projected: a child's prompt is
	// conversation content and never reaches the label whole.
	assert.equal(started.title.length, 80);
	assert.equal(started.title.endsWith('\u2026'), true);
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

function openCodeObserveTerminal(storePath, dataHome, cwd, arguments_) {
	const storeHandle = { id: 'store' };
	const controller = new AbortController();
	let binding;
	return {
		foreground: { executableName: 'opencode', arguments: arguments_ },
		capabilities: new Set([
			'process-observation',
			'filesystem-observation',
			'agent-journal',
		]),
		signal: controller.signal,
		async bindSession(request) {
			binding = request;
			return {
				providerSessionId: request.providerSessionId,
				mappingVersion: request.mappingVersion,
			};
		},
		get binding() {
			return binding;
		},
		observation: {
			processes: {
				async descendants() {
					return [
						{
							handle: { id: 'opencode' },
							executableName: 'opencode',
							cwd,
						},
					];
				},
				async openFiles() {
					return [{ handle: storeHandle, path: storePath, access: 'writable' }];
				},
				async environment() {
					return { XDG_DATA_HOME: dataHome };
				},
			},
			files: {
				async canonicalFile(handle) {
					return handle === storeHandle ? handle : undefined;
				},
			},
		},
		abort() {
			controller.abort();
		},
	};
}

test('opencode --continue binds the writable store for this cwd', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'opencode-continue-'));
	const dataHome = directory;
	const dataRoot = join(dataHome, 'opencode');
	mkdirSync(dataRoot);
	const path = join(dataRoot, 'opencode.db');
	try {
		const database = new DatabaseSync(path);
		database.exec(`
			CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER);
			CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT, seq INTEGER, type TEXT, data TEXT);
			INSERT INTO session VALUES ('${rootId}','p',NULL,'curious-eagle','','/work',1,10);
		`);
		database.close();
		const terminal = openCodeObserveTerminal(path, dataHome, '/work', [
			'--continue',
		]);
		const observed = await openCodeProvider.observe(terminal);
		terminal.abort();
		assert.equal(observed.state, 'bound');
		assert.equal(observed.binding.providerSessionId, rootId);
		await observed.source.dispose();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test('opencode --session <id> binds that root on the writable store', async () => {
	const directory = mkdtempSync(join(tmpdir(), 'opencode-session-'));
	const dataHome = directory;
	const dataRoot = join(dataHome, 'opencode');
	mkdirSync(dataRoot);
	const path = join(dataRoot, 'opencode.db');
	try {
		const database = new DatabaseSync(path);
		database.exec(`
			CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER);
			CREATE TABLE event (id TEXT PRIMARY KEY, aggregate_id TEXT, seq INTEGER, type TEXT, data TEXT);
			INSERT INTO session VALUES ('ses_old','p',NULL,'old','Old','/work',1,10);
			INSERT INTO session VALUES ('${rootId}','p',NULL,'curious-eagle','','/work',1,5);
		`);
		database.close();
		const terminal = openCodeObserveTerminal(path, dataHome, '/work', [
			'--session',
			rootId,
		]);
		const observed = await openCodeProvider.observe(terminal);
		terminal.abort();
		assert.equal(observed.state, 'bound');
		assert.equal(observed.binding.providerSessionId, rootId);
		await observed.source.dispose();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

const NOW = 1_800_000_000_000;
const row = (id, created, updated) => ({
	id,
	directory: '/work',
	timeCreated: created,
	timeUpdated: updated,
});

test('two CLIs started in one directory never resolve to one session', () => {
	// The first terminal started at NOW - 600s and made its session a moment
	// later; the second started at NOW - 2s and has not written its own row
	// yet, because OpenCode only stores a session when its first prompt is
	// submitted. "Newest in the directory" hands the second terminal the
	// first's session, which is the bug this rule exists to prevent.
	const first = row('ses_first', NOW - 599_000, NOW - 30_000);
	assert.equal(
		selectOpenCodeRoot([first], {
			startedAt: NOW - 600_000,
			now: NOW,
		})?.id,
		'ses_first',
		'the terminal that made the session keeps it',
	);
	assert.equal(
		selectOpenCodeRoot([first], { startedAt: NOW - 2_000, now: NOW }),
		undefined,
		"a second terminal must not adopt the first terminal's session",
	);
	// A moment later the second terminal's own session appears and is taken.
	const second = row('ses_second', NOW - 1_000, NOW - 1_000);
	assert.equal(
		selectOpenCodeRoot([second, first], {
			startedAt: NOW - 2_000,
			now: NOW,
		})?.id,
		'ses_second',
	);
	// And the first terminal is unmoved by the second's arrival: it keeps the
	// earliest root it could have created, not the newest in the directory.
	assert.equal(
		selectOpenCodeRoot([second, first], {
			startedAt: NOW - 600_000,
			now: NOW,
		})?.id,
		'ses_first',
	);
});

test('a reopened session rebinds the root that terminal last had', () => {
	const first = row('ses_first', NOW - 600_000, NOW - 300_000);
	const second = row('ses_second', NOW - 200_000, NOW - 100_000);
	const options = {
		startedAt: NOW - ROOT_SELECTION.newSessionGraceMs - 1_000,
		now: NOW,
	};
	// Nothing was created after this process started, so it reopened something.
	// Without a memory the newest root in the directory wins, which is the
	// other terminal's session.
	assert.equal(selectOpenCodeRoot([second, first], options)?.id, 'ses_second');
	assert.equal(
		selectOpenCodeRoot([second, first], {
			...options,
			remembered: 'ses_first',
		})?.id,
		'ses_first',
	);
	// A remembered root that is no longer in the directory is not forced.
	assert.equal(
		selectOpenCodeRoot([second], { ...options, remembered: 'ses_first' })?.id,
		'ses_second',
	);
	// `--continue` is OpenCode's own "newest session here", so the CLI's rule
	// wins over the memory when the arguments prove it.
	assert.equal(
		selectOpenCodeRoot([second, first], {
			...options,
			remembered: 'ses_first',
			continuing: true,
		})?.id,
		'ses_second',
	);
	// An explicitly named session always wins.
	assert.equal(
		selectOpenCodeRoot([second, first], {
			...options,
			remembered: 'ses_second',
			requested: 'ses_first',
		})?.id,
		'ses_first',
	);
});

test('root selection falls back when a process start cannot be proven', () => {
	const first = row('ses_first', NOW - 600_000, NOW - 300_000);
	const second = row('ses_second', NOW - 200_000, NOW - 100_000);
	assert.equal(
		selectOpenCodeRoot([second, first], { now: NOW })?.id,
		'ses_second',
	);
});

test('a directory with an unproven process start is never time-filtered', () => {
	const directories = openCodeWorkingDirectories([
		{
			executableName: 'opencode',
			cwd: '/work',
			startedAt: new Date(NOW - 10_000).toISOString(),
		},
		{ executableName: 'opencode', cwd: '/work' },
		{ executableName: 'bash', cwd: '/elsewhere' },
	]);
	assert.deepEqual([...directories.keys()], ['/work']);
	assert.equal(directories.get('/work'), undefined);
	assert.equal(
		openCodeWorkingDirectories([
			{
				executableName: 'opencode',
				cwd: '/work',
				startedAt: new Date(NOW - 10_000).toISOString(),
			},
			{
				executableName: 'opencode',
				cwd: '/work',
				startedAt: new Date(NOW - 5_000).toISOString(),
			},
		]).get('/work'),
		NOW - 10_000,
		'the earliest proven start in a directory is the one used',
	);
});

test('the terminal device is read from the CLI open files', () => {
	assert.equal(
		terminalDeviceKey([
			{ path: '/dev/pts/3' },
			{ path: '/dev/pts/3' },
			{ path: '/home/user/.local/share/opencode/opencode.db' },
		]),
		'/dev/pts/3',
	);
	assert.equal(terminalDeviceKey([{ path: '/dev/ttys028' }]), '/dev/ttys028');
	assert.equal(terminalDeviceKey([{ path: '/tmp/opencode.db' }]), undefined);
});

test('--continue is recognized on the CLI arguments', () => {
	assert.equal(openCodeContinues(['--continue']), true);
	assert.equal(openCodeContinues(['-c']), true);
	assert.equal(openCodeContinues(['--session', 'ses_x']), false);
	assert.equal(openCodeContinues(undefined), false);
});
