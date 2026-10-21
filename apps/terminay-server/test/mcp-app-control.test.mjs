import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	AUTOMATION_SPACE_PROJECT_ID,
	createInitialWorkspace,
	createWorkspaceOperationRegistry,
	DEFAULT_MCP_PERMISSIONS,
	MCP_PRINCIPAL,
	McpApprovalService,
	mcpPrincipalCommandRequest,
	nodeRootFolderStorage,
	RootFolderBrowser,
	WORKSPACE_VIEW_EVENTS,
	WORKSPACE_VIEW_OPERATIONS,
	WorkspaceStore,
	WorkspaceViewRelay,
} from '@terminay/server-core';
import {
	CONTROL_OPERATIONS,
	CONTROL_PERMISSION_GROUPS,
	CONTROL_TOOL_OPERATIONS,
	createAppControlAdapter,
	createMcpPermissionGate,
	createServerControlDispatcher,
	createTerminalControlAdapter,
	ProjectHandleCodec,
	WindowHandleCodec,
	WORKSPACE_REACH_OPERATIONS,
} from '../dist/index.js';

/**
 * App-level MCP control (ADR-0072): which reach may call which tool, the
 * permission group of every operation, and the project and workspace window
 * tools end to end over the server's real workspace operations.
 */

const KEY = new Uint8Array(32).fill(3);

/** The mcp-permissions delta's group table, including tools that later tasks
 * add: every operation that exists must be listed here, in its group. */
const SPEC_GROUPS = {
	terminalsRead: [
		'list_terminals',
		'read_terminal',
		'search_terminal',
		'get_terminal_status',
		'get_layout',
		'wait_for_idle',
		'wait_for_command',
		'wait_for_attention',
	],
	terminalsManage: [
		'open_terminal',
		'close_terminal',
		'write_terminal',
		'run_command',
		'focus_terminal',
		'rename_terminal',
		'update_terminal',
		'move_terminal_to_project',
		'split_terminal',
		'focus_tab',
		'move_tab',
		'resize_pane',
		'arrange_tabs',
		'focus_project',
		'focus_home',
		'select_folder',
		'create_folder',
		'rename_folder',
		'delete_folder',
		'reorder_folders',
		'move_tab_to_folder',
		'open_file',
		'close_tab',
		'list_macros',
		'run_macro',
		'cancel_macro',
	],
	automationsRead: [
		'list_automations',
		'get_automation',
		'list_automation_runs',
	],
	automationsManage: [
		'create_automation',
		'update_automation',
		'delete_automation',
		'set_automation_enabled',
		'run_automation',
		'stop_automation_run',
		'remove_automation_run',
		'prune_automation_runs',
		'dismiss_missed_runs',
	],
	projectsWindows: [
		'list_projects',
		'create_project',
		'update_project',
		'move_project',
		'close_project',
		'list_workspace_windows',
		'open_workspace_window',
		'rename_workspace_window',
		'close_workspace_window',
	],
	settingsRead: ['get_settings', 'list_shell_profiles'],
	settingsChange: [
		'update_settings',
		'save_shell_profile',
		'delete_shell_profile',
		'reorder_shell_profiles',
		'set_default_shell_profile',
	],
	appWindows: ['show_window', 'close_window', 'list_windows'],
	notifications: [
		'send_notification',
		'list_notifications',
		'dismiss_notification',
	],
	connectedServerTools: ['call_connected_tool'],
};

/** The tools the mcp-app-control delta reserves for workspace reach,
 * including those later tasks add. */
const SPEC_WORKSPACE_ONLY = [
	'create_project',
	'move_project',
	'close_project',
	'list_workspace_windows',
	'open_workspace_window',
	'rename_workspace_window',
	'close_workspace_window',
	'get_settings',
	'update_settings',
	'save_shell_profile',
	'delete_shell_profile',
	'reorder_shell_profiles',
	'set_default_shell_profile',
	'move_terminal_to_project',
	'focus_home',
];

function context(overrides = {}) {
	return {
		terminalSessionId: 'caller',
		projectId: 'project-a',
		scope: 'write',
		connectionId: 'local',
		requestId: 'r',
		signal: new AbortController().signal,
		...overrides,
	};
}
const workspaceTerminal = (overrides = {}) =>
	context({
		terminalSessionId: 'home-terminal',
		projectId: AUTOMATION_SPACE_PROJECT_ID,
		reach: 'workspace',
		...overrides,
	});
const projectChat = (overrides = {}) =>
	context({
		terminalSessionId: 'chat:c1',
		chat: { chatId: 'c1' },
		...overrides,
	});

test('every operation has the permission group the mcp-permissions delta gives it', () => {
	const expected = new Map();
	for (const [group, ops] of Object.entries(SPEC_GROUPS))
		for (const op of ops) expected.set(op, group);
	for (const op of CONTROL_OPERATIONS) {
		if (op === 'get_mcp_capabilities' || op === 'list_connected_tools') {
			assert.equal(CONTROL_PERMISSION_GROUPS[op], undefined, op);
			continue;
		}
		assert.ok(expected.has(op), `${op} has no group in the spec table`);
		assert.equal(CONTROL_PERMISSION_GROUPS[op], expected.get(op), op);
	}
	assert.deepEqual(
		Object.keys(CONTROL_PERMISSION_GROUPS).sort(),
		[...CONTROL_OPERATIONS].sort(),
	);
});

test('workspace-only operations are exactly the spec list, as far as they exist', () => {
	const existing = new Set(CONTROL_OPERATIONS);
	assert.deepEqual(
		[...WORKSPACE_REACH_OPERATIONS].sort(),
		SPEC_WORKSPACE_ONLY.filter((op) => existing.has(op)).sort(),
	);
	for (const op of ['list_projects', 'update_project'])
		assert.equal(WORKSPACE_REACH_OPERATIONS.has(op), false, op);
});

function gated() {
	const policies = Object.fromEntries(
		Object.keys(DEFAULT_MCP_PERMISSIONS).map((group) => [group, 'ask']),
	);
	const approvals = new McpApprovalService({ policies });
	const ran = [];
	const handler = (op) => (params) => {
		ran.push([op, params]);
		return { ran: op };
	};
	const dispatch = createServerControlDispatcher({
		permissions: createMcpPermissionGate({
			approvals,
			describe: async () => ({
				agent: 'An agent',
				terminalTitle: 't',
				summary: 's',
				details: [],
			}),
		}),
		handlers: Object.fromEntries(
			[
				'listProjects',
				'createProject',
				'updateProject',
				'moveProject',
				'closeProject',
				'listWorkspaceWindows',
				'openWorkspaceWindow',
				'renameWorkspaceWindow',
				'closeWorkspaceWindow',
			].map((name) => [name, handler(name)]),
		),
	});
	return { approvals, ran, dispatch };
}

test('under Ask, every workspace-only operation fails out_of_scope for project reach and asks nothing', async () => {
	for (const caller of [context(), projectChat()]) {
		const { approvals, ran, dispatch } = gated();
		for (const op of WORKSPACE_REACH_OPERATIONS) {
			const outcome = await dispatch(
				{ id: op, version: 1, op, params: {} },
				caller,
			);
			assert.equal(outcome.ok, false, op);
			assert.equal(outcome.error.code, 'out_of_scope', op);
		}
		// Changing its own root is out of reach too, whatever else it sends.
		for (const params of [
			{ root: '/elsewhere' },
			{ name: 'x', shell_profile: null },
			{ name: 'x', surprise: 1 },
		]) {
			const outcome = await dispatch(
				{ id: 'u', version: 1, op: 'update_project', params },
				caller,
			);
			assert.equal(outcome.error.code, 'out_of_scope', JSON.stringify(params));
		}
		assert.deepEqual(approvals.list(), []);
		assert.deepEqual(ran, []);
	}
});

test('project reach may rename, re-icon and recolour, which asks under Ask like workspace reach', async () => {
	const { approvals, dispatch } = gated();
	const pending = dispatch(
		{
			id: 'u',
			version: 1,
			op: 'update_project',
			params: { name: 'API', icon: 'x', color: '#fff' },
		},
		context(),
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(approvals.list().length, 1);
	assert.equal(approvals.list()[0].group, 'projectsWindows');
	approvals.decide(approvals.list()[0].id, 'once');
	assert.deepEqual(await pending, { ran: 'updateProject' });
	// Workspace reach is never refused for reach, so it asks too.
	const workspace = dispatch(
		{ id: 'c', version: 1, op: 'create_project', params: { root: '~' } },
		workspaceTerminal(),
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(approvals.list()[0].operation, 'create_project');
	approvals.decide(approvals.list()[0].id, 'decline');
	assert.equal((await workspace).error.code, 'permission_declined');
});

test('capability reporting marks workspace-only tools unavailable to project reach', async () => {
	const dispatch = createTerminalControlAdapter({
		adapter: {
			getMcpCapabilities: () => ({
				tools: CONTROL_TOOL_OPERATIONS.map((tool) => ({
					tool,
					available: true,
					permission: 'allow',
				})),
			}),
			updateTerminal: () => ({}),
			moveTerminalToProject: () => ({}),
		},
		appControl: {},
		settings: {},
		macros: {},
		workspaceView: {},
	});
	const report = async (caller) =>
		Object.fromEntries(
			(
				await dispatch(
					{ id: 'c', version: 1, op: 'get_mcp_capabilities', params: {} },
					caller,
				)
			).tools.map((entry) => [entry.tool, entry.available]),
		);
	for (const caller of [context(), projectChat()]) {
		const tools = await report(caller);
		for (const tool of [
			'create_project',
			'open_workspace_window',
			'update_settings',
			'focus_home',
			'move_terminal_to_project',
		])
			if (tool in tools) assert.equal(tools[tool], false, tool);
		for (const tool of [
			'update_project',
			'list_projects',
			'list_shell_profiles',
		])
			if (tool in tools) assert.equal(tools[tool], true, tool);
	}
	const workspace = await report(workspaceTerminal());
	for (const tool of WORKSPACE_REACH_OPERATIONS)
		assert.equal(workspace[tool], true, tool);
	// Without an app-control binding, none of them is available.
	const unbound = createTerminalControlAdapter({
		adapter: {
			getMcpCapabilities: () => ({
				tools: [{ tool: 'list_projects', available: true }],
			}),
		},
	});
	const result = await unbound(
		{ id: 'c', version: 1, op: 'get_mcp_capabilities', params: {} },
		workspaceTerminal(),
	);
	assert.deepEqual(result.tools, [{ tool: 'list_projects', available: false }]);
});

// --- the adapter, over the server's own workspace operations ---

async function fixture({ withClient = true, rebinds = true } = {}) {
	const base = await realpath(
		await mkdtemp(join(tmpdir(), 'terminay-app-control-')),
	);
	const home = join(base, 'home');
	await mkdir(join(home, 'code', 'api'), { recursive: true });
	await writeFile(join(home, 'notes.txt'), 'a file, not a folder');
	const listings = [];
	const storage = {
		...nodeRootFolderStorage,
		readDirectory: async (path) => {
			listings.push(path);
			return nodeRootFolderStorage.readDirectory(path);
		},
	};
	const rootFolders = new RootFolderBrowser({
		homeDirectory: async () => home,
		storage,
	});
	const workspace = new WorkspaceStore(createInitialWorkspace('server-a'));
	const closedSessions = [];
	const rebound = [];
	const registry = createWorkspaceOperationRegistry(workspace, {
		defaultProjectRoot: async () => home,
		rootFolders,
		closeTerminalSessions: (ids) => {
			closedSessions.push(...ids);
		},
		// The host rebinds a project's file services to a new root.
		...(rebinds
			? {
					prepareProjectRootUpdate: async (projectId, root) => ({
						canonicalRoot: root,
						commit: () => {
							rebound.push({ projectId, root });
						},
					}),
				}
			: {}),
	});
	const principals = [];
	let serial = 0;
	const host = (command) => {
		const applied = registry.applyHostCommand(`h${++serial}`, command);
		if (!applied.ok) throw new Error(`refused ${command.type}`);
	};
	const firstView = workspace.state.viewOrder[0];
	for (const [projectId, name] of [
		['project-a', 'Alpha'],
		['project-b', 'Beta'],
	])
		host({
			type: 'project.create',
			projectId,
			viewId: firstView,
			root: `/work/${projectId}`,
			name,
		});
	registry.ensureAutomationSpace('/work/automations');
	const addTerminal = (sessionId, projectId) =>
		host({
			type: 'terminal.createPanel',
			sessionId,
			projectId,
			panelId: `p:${sessionId}`,
			title: sessionId,
			createdAt: 1,
		});
	addTerminal('caller', 'project-a');
	addTerminal('worker', 'project-b');
	addTerminal('home-terminal', AUTOMATION_SPACE_PROJECT_ID);

	// The agent's client, at the relay's wire.
	const requests = [];
	let answer = (request) =>
		request.op === 'layout'
			? { ok: true, result: { layout: { projectId: 'project-a' } } }
			: {
					ok: true,
					result:
						request.op === 'presentView'
							? { presented: true }
							: { layout: { projectId: request.params.projectId } },
				};
	const relay = new WorkspaceViewRelay({
		eventJournal: {
			revision: 0,
			cursor: '0',
			append() {
				throw new Error('view requests are never retained');
			},
			publishTransient(_event, payload) {
				assert.equal(_event, WORKSPACE_VIEW_EVENTS.request);
				requests.push(payload);
				queueMicrotask(() => {
					relay.operations().commands[WORKSPACE_VIEW_OPERATIONS.respond]({
						envelope: {
							payload: { requestId: payload.requestId, ...answer(payload) },
						},
						body: new Uint8Array(),
						context: {
							connectionId: payload.toConnectionId,
							clientId: payload.clientId,
							authScope: 'full',
						},
					});
				});
				return { revision: 0, cursor: '0' };
			},
		},
	});
	relay.operations().commands[WORKSPACE_VIEW_OPERATIONS.attach]({
		envelope: { payload: {} },
		body: new Uint8Array(),
		context: {
			connectionId: 'window-conn',
			clientId: 'window',
			authScope: 'full',
		},
	});
	const opened = [];
	let busy = async () => 0;
	const projectHandles = new ProjectHandleCodec('server-a', KEY);
	const windowHandles = new WindowHandleCodec('server-a', KEY);
	const adapter = createAppControlAdapter({
		state: () => workspace.state,
		command: async (operation, payload, signal) => {
			const request = mcpPrincipalCommandRequest(operation, payload, signal);
			principals.push(request.context.clientId);
			const outcome = await registry.operations.commands[operation](request);
			return outcome?.result ?? outcome;
		},
		projectHandles,
		windowHandles,
		canonicalFolder: (root) => rootFolders.canonicalDirectory(root),
		openFirstTerminal: async (projectId) => {
			const sessionId = `first-${opened.length + 1}`;
			addTerminal(sessionId, projectId);
			opened.push({
				sessionId,
				projectId,
				root: workspace.state.projects[projectId].root,
			});
			return sessionId;
		},
		busyTerminals: (projectId, signal) => busy(projectId, signal),
		liveTerminals: (projectId) =>
			Object.values(workspace.state.terminalSessions).filter(
				(session) => session.projectId === projectId,
			).length,
		...(withClient
			? {
					view: {
						relay,
						targetFor: () => ({
							clientId: 'window',
							connectionId: 'window-conn',
						}),
					},
				}
			: {}),
	});
	const signal = new AbortController().signal;
	return {
		home,
		workspace,
		adapter,
		requests,
		opened,
		listings,
		principals,
		closedSessions,
		rebound,
		signal,
		projectHandles,
		windowHandles,
		firstView,
		handle: (projectId) => projectHandles.handleFor(projectId),
		setBusy: (next) => {
			busy = next;
		},
		setAnswer: (next) => {
			answer = next;
		},
		cleanup: () => rm(base, { recursive: true, force: true }),
	};
}

async function rejectsWith(promise, code) {
	await assert.rejects(promise, (error) => {
		assert.equal(error.code, code, error.message);
		return true;
	});
}

test('list_projects: project reach sees only its own project; workspace reach sees all and the automation space', async () => {
	const f = await fixture();
	try {
		const own = await f.adapter.listProjects({}, context(), f.signal);
		assert.deepEqual(
			own.projects.map((row) => row.name),
			['Alpha'],
		);
		assert.equal(own.projects[0].project, f.handle('project-a'));
		assert.equal(
			own.projects[0].window,
			f.windowHandles.handleFor(f.firstView),
		);
		assert.equal(own.projects[0].position, 0);
		assert.equal(own.projects[0].root, '/work/project-a');
		const all = await f.adapter.listProjects({}, workspaceTerminal(), f.signal);
		assert.deepEqual(
			all.projects.map((row) => row.name),
			['Alpha', 'Beta', all.projects[2].name],
		);
		const space = all.projects[2];
		assert.equal(space.automation_space, true);
		assert.equal(space.window, undefined);
		assert.equal(space.project, f.handle(AUTOMATION_SPACE_PROJECT_ID));
		// No view id or project id crosses into the agent's context.
		const listed = JSON.stringify(all);
		for (const id of [
			'"project-a"',
			'"project-b"',
			AUTOMATION_SPACE_PROJECT_ID,
			f.firstView,
		])
			assert.equal(listed.includes(id), false, id);
	} finally {
		await f.cleanup();
	}
});

test("create_project with ~ starts it with no root folder in the home directory and shows it on the agent's client", async () => {
	const f = await fixture();
	try {
		const created = await f.adapter.createProject(
			{ root: '~' },
			workspaceTerminal(),
			f.signal,
		);
		const projectId = f.projectHandles.resolve(
			created.project,
			f.workspace.state,
		);
		const project = f.workspace.state.projects[projectId];
		assert.equal(project.rootOrigin, 'none');
		assert.equal(
			project.start,
			undefined,
			'never left awaiting a start choice',
		);
		assert.equal(created.root_folder, false);
		assert.equal(created.terminal, 'first-1');
		assert.deepEqual(f.opened, [{ sessionId: 'first-1', projectId, root: '' }]);
		assert.equal(created.shown, true);
		assert.deepEqual(f.requests.at(-1).params, { projectId });
		assert.equal(f.requests.at(-1).op, 'showProject');
		// It went into the window the agent's client shows.
		assert.equal(project.viewId, f.firstView);
		assert.ok(
			f.principals.every((principal) => principal === MCP_PRINCIPAL.clientId),
		);
	} finally {
		await f.cleanup();
	}
});

test('create_project with ~/… or an absolute folder makes it the root and names the project after it', async () => {
	const f = await fixture();
	try {
		for (const root of ['~/code/api', join(f.home, 'code', 'api')]) {
			const created = await f.adapter.createProject(
				{ root },
				workspaceTerminal(),
				f.signal,
			);
			const project =
				f.workspace.state.projects[
					f.projectHandles.resolve(created.project, f.workspace.state)
				];
			assert.equal(project.root, join(f.home, 'code', 'api'));
			assert.equal(project.rootOrigin, 'explicit');
			assert.equal(project.name, 'api');
			assert.equal(created.root, join(f.home, 'code', 'api'));
		}
		assert.ok(
			f.workspace.state.recentProjectFolders.some(
				(entry) => entry.path === join(f.home, 'code', 'api'),
			),
		);
		// A name given is kept.
		const named = await f.adapter.createProject(
			{ root: '~/code/api', name: 'Service' },
			workspaceTerminal(),
			f.signal,
		);
		assert.equal(named.name, 'Service');
	} finally {
		await f.cleanup();
	}
});

test('create_project refuses a missing folder, a file, and a relative path, and creates nothing or lists nothing', async () => {
	const { parseCreateProject } = await import('../dist/index.js');
	const f = await fixture();
	try {
		const before = Object.keys(f.workspace.state.projects).sort();
		await rejectsWith(
			f.adapter.createProject(
				{ root: '~/missing' },
				workspaceTerminal(),
				f.signal,
			),
			'not_found',
		);
		await rejectsWith(
			f.adapter.createProject(
				{ root: '~/notes.txt' },
				workspaceTerminal(),
				f.signal,
			),
			'bad_request',
		);
		assert.deepEqual(Object.keys(f.workspace.state.projects).sort(), before);
		assert.equal(Object.keys(f.workspace.state.terminalSessions).length, 3);
		assert.deepEqual(f.opened, []);
		const relative = parseCreateProject({ root: 'code/api' });
		assert.equal(relative.ok, false);
		assert.equal(relative.error.code, 'bad_request');
		// No directory was ever listed for the agent.
		assert.deepEqual(f.listings, []);
	} finally {
		await f.cleanup();
	}
});

test("create_project with no agent's client still creates it, in the first window, and says it was not shown", async () => {
	const f = await fixture({ withClient: false });
	try {
		const created = await f.adapter.createProject(
			{ root: '~' },
			workspaceTerminal(),
			f.signal,
		);
		assert.equal(created.shown, false);
		assert.match(created.reason, /renderer_unavailable/u);
		assert.equal(created.window, f.windowHandles.handleFor(f.firstView));
		assert.equal(created.terminal, 'first-1');
	} finally {
		await f.cleanup();
	}
});

test('update_project: project reach renames only its own project; workspace reach changes the root through validation', async () => {
	const f = await fixture();
	try {
		const renamed = await f.adapter.updateProject(
			{ name: 'API service', icon: 'rocket', color: '#123456' },
			context(),
			f.signal,
		);
		assert.equal(renamed.name, 'API service');
		const alpha = f.workspace.state.projects['project-a'];
		assert.deepEqual(
			[alpha.name, alpha.icon, alpha.color, alpha.root],
			['API service', 'rocket', '#123456', '/work/project-a'],
		);
		await rejectsWith(
			f.adapter.updateProject(
				{ project: f.handle('project-b'), name: 'Mine' },
				context(),
				f.signal,
			),
			'not_found',
		);
		assert.equal(f.workspace.state.projects['project-b'].name, 'Beta');
		await rejectsWith(
			f.adapter.updateProject({ root: '~/code/api' }, context(), f.signal),
			'out_of_scope',
		);
		// Workspace reach: a root that fails validation changes nothing.
		await rejectsWith(
			f.adapter.updateProject(
				{ project: f.handle('project-b'), name: 'B', root: '~/missing' },
				workspaceTerminal(),
				f.signal,
			),
			'not_found',
		);
		assert.equal(f.workspace.state.projects['project-b'].name, 'Beta');
		const rooted = await f.adapter.updateProject(
			{ project: f.handle('project-b'), root: '~/code/api', name: 'B' },
			workspaceTerminal(),
			f.signal,
		);
		assert.equal(rooted.root, join(f.home, 'code', 'api'));
		assert.equal(rooted.name, 'B');
		assert.deepEqual(f.rebound, [
			{ projectId: 'project-b', root: join(f.home, 'code', 'api') },
		]);
	} finally {
		await f.cleanup();
	}
	// A server with no root rebinding takes the root with the project's update.
	const plain = await fixture({ rebinds: false });
	try {
		const rooted = await plain.adapter.updateProject(
			{ project: plain.handle('project-b'), root: '~/code/api' },
			workspaceTerminal(),
			plain.signal,
		);
		assert.equal(rooted.root, join(plain.home, 'code', 'api'));
		assert.deepEqual(plain.rebound, []);
	} finally {
		await plain.cleanup();
	}
});

test('close_project refuses busy terminals unless forced, and closes through the server command', async () => {
	const f = await fixture();
	try {
		f.setBusy(async (projectId) => (projectId === 'project-b' ? 2 : 0));
		await assert.rejects(
			f.adapter.closeProject(
				{ project: f.handle('project-b'), force: false },
				workspaceTerminal(),
				f.signal,
			),
			(error) => error.code === 'busy' && /^2 terminals/u.test(error.message),
		);
		assert.ok(f.workspace.state.projects['project-b']);
		// A sample that cannot complete counts its live terminals busy.
		f.setBusy(async () => {
			throw new Error('sample timed out');
		});
		await rejectsWith(
			f.adapter.closeProject(
				{ project: f.handle('project-b'), force: false },
				workspaceTerminal(),
				f.signal,
			),
			'busy',
		);
		const closed = await f.adapter.closeProject(
			{ project: f.handle('project-b'), force: true },
			workspaceTerminal(),
			f.signal,
		);
		assert.equal(closed.closed, true);
		assert.equal(f.workspace.state.projects['project-b'], undefined);
		assert.deepEqual(f.closedSessions, ['worker']);
	} finally {
		await f.cleanup();
	}
});

test('the automation space is never renamed, moved or closed', async () => {
	const f = await fixture();
	try {
		const space = f.handle(AUTOMATION_SPACE_PROJECT_ID);
		const before = JSON.stringify(
			f.workspace.state.projects[AUTOMATION_SPACE_PROJECT_ID],
		);
		await rejectsWith(
			f.adapter.closeProject(
				{ project: space, force: true },
				workspaceTerminal(),
				f.signal,
			),
			'bad_request',
		);
		await rejectsWith(
			f.adapter.updateProject(
				{ project: space, name: 'Mine' },
				workspaceTerminal(),
				f.signal,
			),
			'bad_request',
		);
		await rejectsWith(
			f.adapter.moveProject(
				{ project: space, position: 0 },
				workspaceTerminal(),
				f.signal,
			),
			'bad_request',
		);
		assert.equal(
			JSON.stringify(f.workspace.state.projects[AUTOMATION_SPACE_PROJECT_ID]),
			before,
		);
	} finally {
		await f.cleanup();
	}
});

test('move_project carries a project to another window with its terminals, which keep running', async () => {
	const f = await fixture();
	try {
		const opened = await f.adapter.openWorkspaceWindow(
			{ name: 'Second', projects: [] },
			workspaceTerminal(),
			f.signal,
		);
		const moved = await f.adapter.moveProject(
			{ project: f.handle('project-b'), window: opened.window },
			workspaceTerminal(),
			f.signal,
		);
		assert.equal(moved.window, opened.window);
		assert.equal(moved.position, 0);
		const viewId = f.windowHandles.resolve(opened.window, f.workspace.state);
		assert.equal(f.workspace.state.projects['project-b'].viewId, viewId);
		assert.deepEqual(f.workspace.state.views[viewId].projectIds, ['project-b']);
		assert.equal(
			f.workspace.state.terminalSessions.worker.projectId,
			'project-b',
		);
		assert.deepEqual(f.closedSessions, []);
		// Within its window, by position.
		const reordered = await f.adapter.moveProject(
			{ project: f.handle('project-a'), position: 5 },
			workspaceTerminal(),
			f.signal,
		);
		assert.equal(reordered.window, f.windowHandles.handleFor(f.firstView));
	} finally {
		await f.cleanup();
	}
});

test("open_workspace_window creates a window holding projects and asks the agent's client to present it", async () => {
	const f = await fixture();
	try {
		const opened = await f.adapter.openWorkspaceWindow(
			{ projects: [f.handle('project-b')] },
			workspaceTerminal(),
			f.signal,
		);
		const viewId = f.windowHandles.resolve(opened.window, f.workspace.state);
		assert.equal(opened.presented, true);
		assert.equal(f.workspace.state.views[viewId].name, 'Beta');
		assert.deepEqual(f.workspace.state.views[viewId].projectIds, ['project-b']);
		assert.deepEqual(f.requests.at(-1), {
			...f.requests.at(-1),
			op: 'presentView',
			params: { viewId },
		});
		const listed = await f.adapter.listWorkspaceWindows(
			{},
			workspaceTerminal(),
			f.signal,
		);
		assert.deepEqual(
			listed.windows.map((window) => window.projects.length),
			[1, 1],
		);
		const renamed = await f.adapter.renameWorkspaceWindow(
			{ window: opened.window, name: 'Backend' },
			workspaceTerminal(),
			f.signal,
		);
		assert.equal(renamed.renamed, true);
		assert.equal(f.workspace.state.views[viewId].name, 'Backend');
		// A bad handle creates nothing.
		const views = f.workspace.state.viewOrder.length;
		await rejectsWith(
			f.adapter.openWorkspaceWindow(
				{ projects: ['prj_AAAAAAAAAAAAAAAAAAAAAA'] },
				workspaceTerminal(),
				f.signal,
			),
			'not_found',
		);
		assert.equal(f.workspace.state.viewOrder.length, views);
	} finally {
		await f.cleanup();
	}
});

test("open_workspace_window with no agent's client still creates the window and reports presented: false", async () => {
	const f = await fixture({ withClient: false });
	try {
		const opened = await f.adapter.openWorkspaceWindow(
			{ name: 'Later', projects: [] },
			workspaceTerminal(),
			f.signal,
		);
		assert.equal(opened.presented, false);
		assert.match(opened.reason, /renderer_unavailable/u);
		assert.ok(f.windowHandles.resolve(opened.window, f.workspace.state));
	} finally {
		await f.cleanup();
	}
});

test('close_workspace_window refuses a window holding a project and the last window', async () => {
	const f = await fixture();
	try {
		const opened = await f.adapter.openWorkspaceWindow(
			{ projects: [f.handle('project-b')] },
			workspaceTerminal(),
			f.signal,
		);
		await assert.rejects(
			f.adapter.closeWorkspaceWindow(
				{ window: opened.window },
				workspaceTerminal(),
				f.signal,
			),
			(error) =>
				error.code === 'conflict' && /holds 1 project/u.test(error.message),
		);
		assert.ok(f.windowHandles.resolve(opened.window, f.workspace.state));
		assert.equal(
			f.workspace.state.projects['project-b'].viewId,
			f.windowHandles.resolve(opened.window, f.workspace.state),
		);
		await f.adapter.moveProject(
			{
				project: f.handle('project-b'),
				window: f.windowHandles.handleFor(f.firstView),
			},
			workspaceTerminal(),
			f.signal,
		);
		const closed = await f.adapter.closeWorkspaceWindow(
			{ window: opened.window },
			workspaceTerminal(),
			f.signal,
		);
		assert.equal(closed.closed, true);
		assert.equal(
			f.windowHandles.resolve(opened.window, f.workspace.state),
			undefined,
		);
		// Emptied, the first window is still the last one.
		for (const projectId of ['project-a', 'project-b'])
			await f.adapter.closeProject(
				{ project: f.handle(projectId), force: true },
				workspaceTerminal(),
				f.signal,
			);
		await assert.rejects(
			f.adapter.closeWorkspaceWindow(
				{ window: f.windowHandles.handleFor(f.firstView) },
				workspaceTerminal(),
				f.signal,
			),
			(error) =>
				error.code === 'conflict' && /last window/u.test(error.message),
		);
		assert.deepEqual(f.workspace.state.viewOrder, [f.firstView]);
	} finally {
		await f.cleanup();
	}
});

test('a window handle from another server resolves to nothing', async () => {
	const f = await fixture();
	try {
		const foreign = new WindowHandleCodec('server-b', KEY).handleFor(
			f.firstView,
		);
		await rejectsWith(
			f.adapter.renameWorkspaceWindow(
				{ window: foreign, name: 'x' },
				workspaceTerminal(),
				f.signal,
			),
			'not_found',
		);
	} finally {
		await f.cleanup();
	}
});
