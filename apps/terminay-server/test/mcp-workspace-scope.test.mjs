import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	AUTOMATION_SPACE_PROJECT_ID,
	AUTOMATION_SPACE_TERMINAL_LIMIT,
	TerminalLaunchResolver,
	TerminalService,
	WorkspaceRepository,
} from '@terminay/server-core';
import {
	CONTROL_OPERATIONS,
	CONTROL_PROTOCOL_VERSION,
	ControlCapabilityStore,
	ProjectHandleCodec,
	createControlEndpoint,
	createServerTerminalControlAdapter,
	createTerminalControlAdapter,
	encodeControlMessage,
	isControlRequest,
} from '../dist/index.js';

const SPACE = AUTOMATION_SPACE_PROJECT_ID;
const AUTOMATION_PLACEMENT = Object.freeze({ projectKind: 'automations' });
const HANDLE_KEY = new Uint8Array(32).fill(7);

function tokens() {
	let n = 0;
	return () => `token-${++n}`;
}

// --- 8.1 capability reach ---------------------------------------------------

test('project terminals never receive workspace reach', () => {
	const store = new ControlCapabilityStore({ tokenFactory: tokens() });
	const lease = store.mint('caller', 'project-a');
	assert.equal('reach' in lease, false);
	assert.deepEqual(store.resolve(lease.token), {
		terminalSessionId: 'caller',
		projectId: 'project-a',
		scope: 'write',
	});
	// The reserved id alone is not a placement: reach comes from canonical kind.
	const byIdOnly = store.mint('spoof', SPACE);
	assert.equal(store.resolve(byIdOnly.token).reach, undefined);
	// A kind that is not the automation space, or the automation kind on any
	// other project, is refused rather than silently widened.
	assert.throws(
		() => store.mint('caller', 'project-a', 'write', AUTOMATION_PLACEMENT),
		/invalid control placement/,
	);
	assert.throws(
		() => store.mint('caller', SPACE, 'write', { projectKind: 'workspace' }),
		/invalid control placement/,
	);
	assert.equal(
		store.metadata().every((entry) => entry.reach === undefined),
		true,
	);
});

test('automation-space terminals receive workspace reach bound to the minting terminal', () => {
	const store = new ControlCapabilityStore({ tokenFactory: tokens() });
	const lease = store.mint('auto-1', SPACE, 'write', AUTOMATION_PLACEMENT);
	assert.equal(lease.reach, 'workspace');
	assert.deepEqual(store.resolve(lease.token), {
		terminalSessionId: 'auto-1',
		projectId: SPACE,
		scope: 'write',
		reach: 'workspace',
	});
	assert.equal(store.onTerminalExit('auto-1'), 1);
	assert.equal(store.resolve(lease.token), null);
});

test('entering or leaving the automation space replaces the token atomically', () => {
	const store = new ControlCapabilityStore({ tokenFactory: tokens() });
	const inSpace = store.mint('t', SPACE, 'write', AUTOMATION_PLACEMENT);
	const inProject = store.moveTerminal('t', 'project-a');
	assert.equal(store.resolve(inSpace.token), null);
	assert.deepEqual(store.resolve(inProject.token), {
		terminalSessionId: 't',
		projectId: 'project-a',
		scope: 'write',
	});
	const back = store.moveTerminal('t', SPACE, 'write', AUTOMATION_PLACEMENT);
	assert.equal(store.resolve(inProject.token), null);
	assert.equal(store.resolve(back.token).reach, 'workspace');
	assert.equal(store.metadata().length, 1);
});

test("no caller-supplied value changes a token's reach on the wire", async () => {
	const store = new ControlCapabilityStore({ tokenFactory: tokens() });
	const project = store.mint('caller', 'project-a');
	const automation = store.mint('auto', SPACE, 'write', AUTOMATION_PLACEMENT);
	const seen = [];
	const directory = await mkdtemp(join(tmpdir(), 'terminay-reach-'));
	const socketPath = join(directory, 'control.sock');
	const endpoint = createControlEndpoint({
		socketPath,
		capabilities: store,
		dispatch: (_request, context) => {
			seen.push(context);
			return {};
		},
	});
	await endpoint.start();
	try {
		const widening = {
			reach: 'workspace',
			scope: 'admin',
			projectId: SPACE,
			project_kind: 'automations',
			terminalSessionId: 'auto',
			cwd: '/automations',
			title: 'Automations',
			env: { TERMINAY_CONTROL_TOKEN: automation.token },
		};
		for (const op of ['list_terminals', 'open_terminal']) {
			const response = await request(socketPath, {
				id: `w-${op}`,
				token: project.token,
				version: CONTROL_PROTOCOL_VERSION,
				op,
				params: widening,
			});
			assert.equal(response.ok, true);
		}
		// Extra envelope fields are refused outright.
		assert.equal(
			isControlRequest({
				id: 'x',
				token: project.token,
				version: 1,
				op: 'list_terminals',
				params: {},
				reach: 'workspace',
			}),
			false,
		);
		assert.equal(seen.length, 2);
		for (const context of seen) {
			assert.equal(context.projectId, 'project-a');
			assert.equal(context.terminalSessionId, 'caller');
			assert.equal(context.scope, 'write');
			assert.equal('reach' in context, false);
		}
		await request(socketPath, {
			id: 'auto',
			token: automation.token,
			version: CONTROL_PROTOCOL_VERSION,
			op: 'list_terminals',
			params: {},
		});
		assert.equal(seen[2].reach, 'workspace');
	} finally {
		await endpoint.stop();
	}
});

test('the launch environment hook mints reach from the canonical project kind', async () => {
	const store = new ControlCapabilityStore({ tokenFactory: tokens() });
	const { repository } = await seededWorkspace();
	const resolver = launchResolver(repository, store);
	const project = await resolver.resolve({
		identity: { serverId: 'server-a', projectId: 'project-a', sessionId: 'p1' },
		cols: 80,
		rows: 24,
	});
	const space = await resolver.resolve({
		identity: { serverId: 'server-a', projectId: SPACE, sessionId: 'a1' },
		cols: 80,
		rows: 24,
	});
	assert.equal(
		store.resolve(project.env.TERMINAY_CONTROL_TOKEN).reach,
		undefined,
	);
	assert.equal(
		store.resolve(space.env.TERMINAY_CONTROL_TOKEN).reach,
		'workspace',
	);
});

// --- 8.2 adapter ------------------------------------------------------------

function ptyFactory() {
	const processes = [];
	return {
		processes,
		spawn(options) {
			const process = {
				pid: 9000 + processes.length,
				options,
				writes: [],
				write(bytes) {
					this.writes.push(Buffer.from(bytes).toString('utf8'));
				},
				resize() {},
				kill() {},
				onData() {
					return () => {};
				},
				onExit() {
					return () => {};
				},
			};
			processes.push(process);
			return process;
		},
	};
}

async function seededWorkspace() {
	let persisted;
	const repository = new WorkspaceRepository(
		{
			async load() {
				return persisted;
			},
			async commit(state) {
				persisted = state;
			},
		},
		'server-a',
	);
	const initial = await repository.load();
	const viewId = initial.viewOrder[0];
	for (const [projectId, name] of [
		['project-a', 'Alpha'],
		['project-b', 'Beta'],
	])
		await repository.apply({
			commandId: `create-${projectId}`,
			command: {
				type: 'project.create',
				projectId,
				viewId,
				root: `/${projectId}`,
				name,
			},
		});
	repository.workspace.ensureAutomationSpace({ root: '/automations' });
	return { repository };
}

function launchResolver(repository, store) {
	return new TerminalLaunchResolver({
		serverId: 'server-a',
		profiles: {
			catalogue: async () => ({
				settingsRevision: 1,
				defaultProfileId: 'system',
				cwdPolicy: 'project',
				entries: [],
				projectReferences: {},
			}),
			resolveProfile: async (id, catalogue) => {
				const profile = {
					id,
					name: id,
					target: { kind: 'executable', executable: '/bin/test-shell' },
					args: [],
					startupMode: 'default',
					environment: {},
					kind: 'system',
					readOnly: true,
					source: 'system',
					availability: { available: true },
				};
				return {
					profile,
					definition: profile,
					settingsRevision: catalogue.settingsRevision,
					target: profile.target,
				};
			},
		},
		workspaceSnapshot: () => repository.state,
		pathAuthority: {
			canonicalDirectory: async (value) => value,
			homeDirectory: async () => '/home',
			isRoot: (value) => value === '/',
		},
		now: () => 1,
		environmentFor: (intent, placement) => {
			const lease = store.mint(
				intent.identity.sessionId,
				intent.identity.projectId,
				'write',
				placement,
			);
			return { TERMINAY_CONTROL_TOKEN: lease.token };
		},
	});
}

async function fixture(adapterOptions = {}) {
	const pty = ptyFactory();
	const ids = [
		'auto-caller',
		'alpha-1',
		'beta-1',
		'opened-1',
		'opened-2',
		'opened-3',
	];
	let extra = 0;
	const terminal = new TerminalService({
		serverId: 'server-a',
		ptyFactory: pty,
		generateSessionId: () => ids.shift() ?? `extra-${++extra}`,
	});
	const { repository } = await seededWorkspace();
	const store = new ControlCapabilityStore({ tokenFactory: tokens() });
	const caller = await terminal.createSession({
		projectId: SPACE,
		cols: 80,
		rows: 24,
	});
	const alpha = await terminal.createSession({
		projectId: 'project-a',
		cols: 80,
		rows: 24,
	});
	const beta = await terminal.createSession({
		projectId: 'project-b',
		cols: 80,
		rows: 24,
	});
	const adapter = createServerTerminalControlAdapter({
		terminal,
		workspace: repository,
		launchResolver: launchResolver(repository, store),
		projectHandleKey: HANDLE_KEY,
		...adapterOptions,
	});
	const dispatch = createTerminalControlAdapter({ adapter });
	const workspaceContext = {
		terminalSessionId: caller.sessionId,
		projectId: SPACE,
		scope: 'write',
		reach: 'workspace',
		connectionId: 'local',
		requestId: 'r',
		signal: new AbortController().signal,
	};
	const projectContext = {
		terminalSessionId: alpha.sessionId,
		projectId: 'project-a',
		scope: 'write',
		connectionId: 'local',
		requestId: 'r',
		signal: new AbortController().signal,
	};
	const call = (
		context,
		op,
		params = {},
		id = `${op}-${Math.random().toString(36).slice(2, 8)}`,
	) => dispatch({ id, version: 1, op, params }, { ...context, requestId: id });
	const handles = new ProjectHandleCodec('server-a', HANDLE_KEY);
	return {
		pty,
		terminal,
		repository,
		store,
		dispatch,
		call,
		workspaceContext,
		projectContext,
		handles,
		caller,
		alpha,
		beta,
	};
}

test("workspace reach lists every project's terminals with opaque handles and titles", async () => {
	const { call, workspaceContext, projectContext, handles } = await fixture();
	const listed = await call(workspaceContext, 'list_terminals');
	const rows = Object.fromEntries(
		listed.terminals.map((row) => [row.terminal, row]),
	);
	assert.deepEqual(Object.keys(rows).sort(), [
		'alpha-1',
		'auto-caller',
		'beta-1',
	]);
	assert.equal(rows['alpha-1'].project, handles.handleFor('project-a'));
	assert.equal(rows['alpha-1'].project_title, 'Alpha');
	assert.equal(rows['beta-1'].project_title, 'Beta');
	assert.equal(rows['auto-caller'].project_title, 'Automations');
	for (const row of listed.terminals) {
		assert.match(row.project, /^prj_[A-Za-z0-9_-]{22}$/);
		assert.equal(
			JSON.stringify(row).includes('project-a'),
			false,
			'raw project ids never appear',
		);
		assert.equal('projectId' in row, false);
	}

	// Project reach is byte-for-byte what it always was: its own project, no project fields.
	const own = await call(projectContext, 'list_terminals');
	assert.equal(
		JSON.stringify(own),
		JSON.stringify({
			terminals: [
				{
					terminal: 'alpha-1',
					status: 'running',
					output_position: 0,
					replay_from: 0,
				},
			],
		}),
	);
});

test("workspace reach addresses any project's terminal on the same server; project reach does not", async () => {
	const { call, pty, repository, workspaceContext, projectContext } =
		await fixture();
	assert.deepEqual(
		await call(workspaceContext, 'write_terminal', {
			terminal: 'beta-1',
			text: 'echo hi',
			submit: true,
		}),
		{ terminal: 'beta-1', bytes: 8, submitted: true },
	);
	assert.deepEqual(pty.processes[2].writes, ['echo hi\r']);
	assert.deepEqual(
		await call(workspaceContext, 'get_terminal_status', {
			terminal: 'alpha-1',
		}),
		{
			terminal: 'alpha-1',
			status: 'running',
			output_position: 0,
			replay_from: 0,
		},
	);
	await repository.apply({
		commandId: 'beta-panel',
		command: {
			type: 'terminal.createPanel',
			sessionId: 'beta-1',
			projectId: 'project-b',
			panelId: 'panel-beta',
			title: 'Beta 1',
			cwd: '/project-b',
			createdAt: 1,
		},
	});
	assert.deepEqual(
		await call(workspaceContext, 'rename_terminal', {
			terminal: 'beta-1',
			name: 'Renamed',
		}),
		{ terminal: 'beta-1', renamed: true, name: 'Renamed' },
	);
	assert.equal(repository.state.panels['panel-beta'].title, 'Renamed');

	const refused = await call(projectContext, 'write_terminal', {
		terminal: 'beta-1',
		text: 'x',
	});
	assert.deepEqual(refused, {
		ok: false,
		error: {
			code: 'terminal_not_found',
			message: 'The requested terminal is unavailable.',
		},
	});
	const refusedSpace = await call(projectContext, 'read_terminal', {
		terminal: 'auto-caller',
	});
	assert.equal(refusedSpace.error.code, 'terminal_not_found');
});

test('workspace reach never crosses servers', async () => {
	const { call, workspaceContext, repository } = await fixture();
	const other = new TerminalService({
		serverId: 'server-b',
		ptyFactory: ptyFactory(),
		generateSessionId: () => 'remote-1',
	});
	await other.createSession({ projectId: 'project-a', cols: 80, rows: 24 });
	const refused = await call(workspaceContext, 'read_terminal', {
		terminal: 'remote-1',
	});
	assert.deepEqual(refused, {
		ok: false,
		error: {
			code: 'terminal_not_found',
			message: 'The requested terminal is unavailable.',
		},
	});
	const listed = await call(workspaceContext, 'list_terminals');
	assert.equal(
		listed.terminals.some((row) => row.terminal === 'remote-1'),
		false,
	);
	// A handle minted for another server resolves to nothing here.
	const foreign = new ProjectHandleCodec('server-b', HANDLE_KEY).handleFor(
		'project-a',
	);
	assert.equal(
		new ProjectHandleCodec('server-a', HANDLE_KEY).resolve(
			foreign,
			repository.state,
		),
		undefined,
	);
	const opened = await call(workspaceContext, 'open_terminal', {
		project: foreign,
	});
	assert.deepEqual(opened, {
		ok: false,
		error: {
			code: 'not_found',
			message: 'The requested project is unavailable.',
		},
	});
});

test('open_terminal defaults to the automation space with workspace reach, or opens in a listed project with project reach', async () => {
	const { call, workspaceContext, store, terminal, repository, pty, handles } =
		await fixture();
	const inSpace = await call(workspaceContext, 'open_terminal', {
		name: 'Agent',
	});
	assert.deepEqual(inSpace, {
		terminal: 'opened-1',
		project: handles.handleFor(SPACE),
		project_title: 'Automations',
		status: 'running',
	});
	assert.equal(terminal.getSession('opened-1').projectId, SPACE);
	assert.equal(repository.state.panels['p:opened-1'].projectId, SPACE);
	assert.equal(
		store.resolve(pty.processes.at(-1).options.env.TERMINAY_CONTROL_TOKEN)
			.reach,
		'workspace',
	);

	const listed = await call(workspaceContext, 'list_terminals');
	const alphaHandle = listed.terminals.find(
		(row) => row.terminal === 'alpha-1',
	).project;
	const inProject = await call(workspaceContext, 'open_terminal', {
		project: alphaHandle,
	});
	assert.deepEqual(inProject, {
		terminal: 'opened-2',
		project: alphaHandle,
		project_title: 'Alpha',
		status: 'running',
	});
	assert.equal(terminal.getSession('opened-2').projectId, 'project-a');
	const projectLease = store.resolve(
		pty.processes.at(-1).options.env.TERMINAY_CONTROL_TOKEN,
	);
	assert.deepEqual(projectLease, {
		terminalSessionId: 'opened-2',
		projectId: 'project-a',
		scope: 'write',
	});

	assert.deepEqual(
		await call(workspaceContext, 'open_terminal', { project: 'project-a' }),
		{
			ok: false,
			error: { code: 'bad_request', message: 'project handle is invalid' },
		},
	);
});

test('a workspace-reach open_terminal tells the run that owns the caller; project reach and failures do not', async () => {
	const opened = [];
	let failing = false;
	const { call, workspaceContext, projectContext, repository } = await fixture({
		recordOpenedTerminal: async (caller, session) => {
			opened.push([caller, session]);
			if (failing) throw new Error('run log unavailable');
		},
	});
	await call(workspaceContext, 'open_terminal', { name: 'Agent' });
	assert.deepEqual(opened, [['auto-caller', 'opened-1']]);
	// A terminal the caller opened reports itself as the next opener.
	await call(
		{ ...workspaceContext, terminalSessionId: 'opened-1' },
		'open_terminal',
		{},
	);
	assert.deepEqual(opened.at(-1), ['opened-1', 'opened-2']);
	// Project reach never names a run.
	await call(projectContext, 'open_terminal', {});
	assert.equal(opened.length, 2);
	// Recording is presentation: the terminal opens even when it fails.
	failing = true;
	const result = await call(workspaceContext, 'open_terminal', {});
	assert.equal(result.status, 'running');
	assert.ok(repository.state.panels[`p:${result.terminal}`]);
});

test('project reach open_terminal is unchanged and refuses a project handle', async () => {
	const { call, projectContext, handles } = await fixture();
	const refused = await call(projectContext, 'open_terminal', {
		project: handles.handleFor('project-b'),
	});
	assert.deepEqual(refused, {
		ok: false,
		error: {
			code: 'bad_request',
			message: 'project is available only to automation terminals',
		},
	});
	const opened = await call(projectContext, 'open_terminal', {});
	assert.equal(
		JSON.stringify(opened),
		JSON.stringify({
			terminal: 'opened-1',
			projectId: 'project-a',
			status: 'running',
		}),
	);
});

test('open_terminal respects the automation-space terminal cap with a bounded error', async () => {
	const { call, workspaceContext, terminal, handles } = await fixture();
	// The caller already holds one live terminal in the space.
	for (let index = 1; index < AUTOMATION_SPACE_TERMINAL_LIMIT; index += 1)
		await terminal.createSession({ projectId: SPACE, cols: 80, rows: 24 });
	const refused = await call(workspaceContext, 'open_terminal', {});
	assert.deepEqual(refused, {
		ok: false,
		error: {
			code: 'limit_exceeded',
			message: `The automation space has reached its limit of ${AUTOMATION_SPACE_TERMINAL_LIMIT} live terminals.`,
		},
	});
	// Opening in a project is not limited by the space's cap.
	const opened = await call(workspaceContext, 'open_terminal', {
		project: handles.handleFor('project-b'),
	});
	assert.equal(opened.status, 'running');
});

// --- 8.3 tool surface -------------------------------------------------------

test('no automation operation is reachable through MCP', async () => {
	const { call, workspaceContext, projectContext, dispatch } = await fixture();
	const automationLike = /automation|schedule|cron|trigger/i;
	assert.equal(
		CONTROL_OPERATIONS.some((op) => automationLike.test(op)),
		false,
	);
	const workspaceTools = (
		await call(workspaceContext, 'get_mcp_capabilities')
	).tools.map((entry) => entry.tool);
	const projectTools = (
		await call(projectContext, 'get_mcp_capabilities')
	).tools.map((entry) => entry.tool);
	// Workspace reach widens which terminals are addressable, never the tool set.
	assert.deepEqual(workspaceTools, projectTools);
	assert.deepEqual([...workspaceTools].sort(), [...CONTROL_OPERATIONS].sort());
	for (const op of [
		'create_automation',
		'run_automation',
		'list_automations',
		'automations.create',
	]) {
		assert.equal(
			isControlRequest({ id: 'a', token: 't', version: 1, op, params: {} }),
			false,
		);
		assert.equal(
			(
				await dispatch(
					{ id: 'a', version: 1, op, params: {} },
					workspaceContext,
				)
			).error.code,
			'unsupported_op',
		);
	}
});

async function request(socketPath, value) {
	const socket = connect(socketPath);
	await new Promise((resolve, reject) => {
		socket.once('connect', resolve);
		socket.once('error', reject);
	});
	try {
		socket.setEncoding('utf8');
		const response = new Promise((resolve) => {
			let buffer = '';
			socket.on('data', (chunk) => {
				buffer += chunk;
				const newline = buffer.indexOf('\n');
				if (newline !== -1) resolve(JSON.parse(buffer.slice(0, newline)));
			});
		});
		socket.write(encodeControlMessage(value));
		return await response;
	} finally {
		socket.destroy();
	}
}
