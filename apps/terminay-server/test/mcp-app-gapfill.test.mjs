import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import {
	AUTOMATION_SPACE_PROJECT_ID,
	AutomationRepository,
	AutomationRunLog,
	createAutomationMcpOperations,
	createInitialWorkspace,
	createMacroOperationRegistry,
	createNotificationOperationRegistry,
	createWorkspaceOperationRegistry,
	DEFAULT_MCP_PERMISSIONS,
	MacroRepository,
	McpApprovalService,
	mcpPrincipalCommandRequest,
	mcpPrincipalQueryRequest,
	NotificationManager,
	OrderedEventJournal,
	TerminalService,
	unavailableAutomationRunController,
	WorkspaceStore,
} from '@terminay/server-core';
import {
	automationControlError,
	createMacroControlAdapter,
	createMcpPermissionGate,
	createNotificationControlAdapter,
	createServerTerminalControlAdapter,
	createTerminalControlAdapter,
	createTerminalMetadataAdapter,
	createWorkspaceViewAdapter,
	ProjectHandleCodec,
} from '../dist/index.js';

/**
 * The tools that fill the gaps in the existing groups (ADR-0072): terminal
 * metadata and project moves, folder housekeeping, Home, automation run
 * housekeeping, notifications by reach, and macros.
 */

const KEY = new Uint8Array(32).fill(9);

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
const chat = (overrides = {}) =>
	context({
		terminalSessionId: 'chat:c1',
		chat: { chatId: 'c1' },
		...overrides,
	});

function notFound() {
	return Object.assign(new Error('The requested terminal is unavailable.'), {
		code: 'terminal_not_found',
	});
}

/** A workspace with two projects and the automation space, each with a terminal. */
function workspaceFixture() {
	const workspace = new WorkspaceStore(createInitialWorkspace('server-a'));
	const rehomed = [];
	const closed = [];
	const registry = createWorkspaceOperationRegistry(workspace, {
		closeTerminalSessions: (ids) => {
			closed.push(...ids);
		},
		rehomeTerminalSession: (move) => {
			rehomed.push(move);
		},
	});
	let serial = 0;
	const host = (command) => {
		const applied = registry.applyHostCommand(`h${++serial}`, command);
		if (!applied.ok)
			throw new Error(applied.error?.message ?? `refused ${command.type}`);
	};
	const view = workspace.state.viewOrder[0];
	for (const [projectId, name] of [
		['project-a', 'Alpha'],
		['project-b', 'Beta'],
	])
		host({
			type: 'project.create',
			projectId,
			viewId: view,
			root: `/work/${projectId}`,
			name,
			color: '#123456',
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
	const projectHandles = new ProjectHandleCodec('server-a', KEY);
	/** As the host resolves a terminal: only one in the caller's reach. */
	const resolveTerminal = (caller, reference) => {
		const session = workspace.state.terminalSessions[reference];
		if (
			session === undefined ||
			(caller.reach !== 'workspace' && session.projectId !== caller.projectId)
		)
			throw notFound();
		return { sessionId: session.id, projectId: session.projectId };
	};
	return {
		workspace,
		registry,
		host,
		rehomed,
		closed,
		projectHandles,
		resolveTerminal,
		handle: (projectId) => projectHandles.handleFor(projectId),
		apply: (command) => host(command),
	};
}

function terminalDispatch(f) {
	return createTerminalControlAdapter({
		adapter: createTerminalMetadataAdapter({
			state: () => f.workspace.state,
			apply: (command) => f.apply(command),
			resolveTerminal: f.resolveTerminal,
			projectHandles: f.projectHandles,
		}),
	});
}

// --- 4.1 update_terminal and open_terminal's shell profile ---

test('update_terminal applies icon, colour, note and activity tracking as the tab editor does', async () => {
	const f = workspaceFixture();
	const dispatch = terminalDispatch(f);
	const result = await dispatch(
		{
			id: 'u',
			version: 1,
			op: 'update_terminal',
			params: {
				terminal: 'caller',
				icon: ' 🚀 ',
				note: 'Runs the API build',
				color: '#ff0000',
				activity_tracking: false,
			},
		},
		context(),
	);
	assert.equal(result.updated, true);
	const panel = f.workspace.state.panels['p:caller'];
	assert.equal(panel.emoji, '🚀');
	assert.equal(panel.note, 'Runs the API build');
	assert.equal(panel.color, '#ff0000');
	assert.equal(panel.inheritsProjectColor, false);
	assert.equal(panel.activityIndicatorsEnabled, false);
	// An empty colour follows the project's again; a null note goes.
	await dispatch(
		{
			id: 'u2',
			version: 1,
			op: 'update_terminal',
			params: { terminal: 'caller', color: '', note: null },
		},
		context(),
	);
	const after = f.workspace.state.panels['p:caller'];
	assert.equal(after.color, '#123456');
	assert.equal(after.inheritsProjectColor, true);
	assert.equal('note' in after, false);
	// Another project's terminal is not addressable from a project terminal.
	const refused = await dispatch(
		{
			id: 'u3',
			version: 1,
			op: 'update_terminal',
			params: { terminal: 'worker', icon: 'x' },
		},
		context(),
	);
	assert.equal(refused.error.code, 'terminal_not_found');
	assert.equal(f.workspace.state.panels['p:worker'].emoji, undefined);
	const empty = await dispatch(
		{
			id: 'u4',
			version: 1,
			op: 'update_terminal',
			params: { terminal: 'caller' },
		},
		context(),
	);
	assert.equal(empty.error.code, 'bad_request');
});

function createPtyFactory() {
	return {
		spawn() {
			return {
				pid: 9100,
				write() {},
				resize() {},
				kill() {},
				onData: () => () => undefined,
				onExit: () => () => undefined,
			};
		},
	};
}

test('open_terminal with an unknown shell profile fails and creates no terminal; a known one launches with it', async () => {
	// The refused open allocates an identity too, and never uses it.
	const ids = ['caller', 'refused', 'opened'];
	const terminal = new TerminalService({
		serverId: 'server-a',
		ptyFactory: createPtyFactory(),
		generateSessionId: () => ids.shift(),
	});
	await terminal.createSession({ projectId: 'project-a', cols: 80, rows: 24 });
	const intents = [];
	const launchResolver = {
		async resolve(intent) {
			intents.push(intent);
			// As the resolver refuses a profile the catalogue does not hold.
			if (intent.explicitProfileId === 'no-such-profile')
				throw new Error('shell profile does not exist');
			return {
				identity: intent.identity,
				workspaceRevision: 1,
				settingsRevision: 1,
				profile: {
					id: intent.explicitProfileId ?? 'system',
					revision: 1,
					name: 'Bash',
					targetSummary: '/bin/bash',
				},
				shellPath: '/bin/bash',
				args: [],
				cwd: '/work/project-a',
				env: { TERM: 'xterm-256color' },
				cols: intent.cols,
				rows: intent.rows,
				createdAt: 1,
			};
		},
	};
	const dispatch = createTerminalControlAdapter({
		adapter: createServerTerminalControlAdapter({ terminal, launchResolver }),
	});
	const before = terminal.listSessions().length;
	const refused = await dispatch(
		{
			id: 'o',
			version: 1,
			op: 'open_terminal',
			params: { shell_profile: 'no-such-profile' },
		},
		context(),
	);
	assert.equal(refused.ok, false);
	assert.equal(terminal.listSessions().length, before);
	assert.equal(intents.at(-1).explicitProfileId, 'no-such-profile');
	const opened = await dispatch(
		{
			id: 'o2',
			version: 1,
			op: 'open_terminal',
			params: { shell_profile: 'bash-profile' },
		},
		context(),
	);
	assert.equal(opened.terminal, 'opened');
	assert.equal(intents.at(-1).explicitProfileId, 'bash-profile');
	assert.equal(terminal.listSessions().length, before + 1);
	const invalid = await dispatch(
		{
			id: 'o3',
			version: 1,
			op: 'open_terminal',
			params: { shell_profile: '../x' },
		},
		context(),
	);
	assert.equal(invalid.error.code, 'bad_request');
});

// --- 4.2 move_terminal_to_project ---

test('move_terminal_to_project re-homes a running terminal through the server move, keeping its PTY', async () => {
	const f = workspaceFixture();
	const dispatch = terminalDispatch(f);
	assert.equal(f.resolveTerminal(context(), 'caller').projectId, 'project-a');
	const moved = await dispatch(
		{
			id: 'm',
			version: 1,
			op: 'move_terminal_to_project',
			params: { terminal: 'caller', project: f.handle('project-b') },
		},
		workspaceTerminal(),
	);
	assert.deepEqual(moved, {
		terminal: 'caller',
		project: f.handle('project-b'),
		moved: true,
	});
	assert.equal(
		f.workspace.state.terminalSessions.caller.projectId,
		'project-b',
	);
	assert.equal(f.workspace.state.panels['p:caller'].projectId, 'project-b');
	// The terminal itself followed, and nothing was closed: the PTY is kept.
	assert.deepEqual(f.rehomed, [
		{
			sessionId: 'caller',
			sourceProjectId: 'project-a',
			targetProjectId: 'project-b',
		},
	]);
	assert.deepEqual(f.closed, []);
	// The old identity no longer resolves: its old project cannot address it.
	assert.throws(() => f.resolveTerminal(context(), 'caller'), /unavailable/);
	assert.equal(
		f.resolveTerminal(context({ projectId: 'project-b' }), moved.terminal)
			.projectId,
		'project-b',
	);
});

test('move_terminal_to_project is refused for project reach and for the automation space', async () => {
	const f = workspaceFixture();
	const policies = Object.fromEntries(
		Object.keys(DEFAULT_MCP_PERMISSIONS).map((group) => [group, 'ask']),
	);
	const approvals = new McpApprovalService({ policies });
	const dispatch = createTerminalControlAdapter({
		adapter: createTerminalMetadataAdapter({
			state: () => f.workspace.state,
			apply: (command) => f.apply(command),
			resolveTerminal: f.resolveTerminal,
			projectHandles: f.projectHandles,
		}),
		permissions: createMcpPermissionGate({
			approvals,
			describe: async () => ({
				agent: 'a',
				terminalTitle: 't',
				summary: 's',
				details: [],
			}),
		}),
	});
	const projectReach = await dispatch(
		{
			id: 'm',
			version: 1,
			op: 'move_terminal_to_project',
			params: { terminal: 'caller', project: f.handle('project-b') },
		},
		context(),
	);
	assert.equal(projectReach.error.code, 'out_of_scope');
	assert.deepEqual(approvals.list(), []);
	const open = createTerminalControlAdapter({
		adapter: createTerminalMetadataAdapter({
			state: () => f.workspace.state,
			apply: (command) => f.apply(command),
			resolveTerminal: f.resolveTerminal,
			projectHandles: f.projectHandles,
		}),
	});
	for (const params of [
		{ terminal: 'caller', project: f.handle(AUTOMATION_SPACE_PROJECT_ID) },
		{ terminal: 'home-terminal', project: f.handle('project-a') },
	]) {
		const outcome = await open(
			{ id: 'm', version: 1, op: 'move_terminal_to_project', params },
			workspaceTerminal(),
		);
		assert.equal(outcome.error.code, 'bad_request', JSON.stringify(params));
	}
	assert.equal(
		f.workspace.state.terminalSessions.caller.projectId,
		'project-a',
	);
	assert.equal(
		f.workspace.state.terminalSessions['home-terminal'].projectId,
		AUTOMATION_SPACE_PROJECT_ID,
	);
	assert.deepEqual(f.rehomed, []);
});

// --- 4.3 and 4.4: folders and Home ---

function viewFixture({ withClient = true } = {}) {
	const f = workspaceFixture();
	const requests = [];
	const adapter = createWorkspaceViewAdapter({
		relay: {
			request: async (target, op, params) => {
				requests.push({ target, op, params });
				return op === 'showHome' ? { section: params.section ?? 'home' } : {};
			},
		},
		targetFor: () =>
			withClient ? { clientId: 'window', connectionId: 'conn' } : undefined,
		state: () => f.workspace.state,
		apply: (command) => f.apply(command),
		projectHandles: f.projectHandles,
	});
	const dispatch = createTerminalControlAdapter({
		adapter: {},
		workspaceView: adapter,
	});
	const call = (op, params, caller) =>
		dispatch({ id: op, version: 1, op, params }, caller);
	const folders = (projectId) =>
		f.workspace.state.projects[projectId].folderIds;
	const folder = (projectId, name) =>
		folders(projectId).find(
			(id) => f.workspace.state.folders[id].name === name,
		);
	return { ...f, requests, call, folders, folder };
}

test('delete_folder removes an empty plain folder, and refuses General, a non-empty folder, and a worktree folder', async () => {
	const f = viewFixture();
	f.host({ type: 'folder.create', projectId: 'project-a', name: 'Scratch' });
	f.host({ type: 'folder.create', projectId: 'project-a', name: 'Busy' });
	f.host({
		type: 'folder.create',
		projectId: 'project-a',
		name: 'feature',
		worktree: { repositoryId: 'repo-1', path: '/work/project-a-feature' },
	});
	f.host({
		type: 'panel.moveToFolder',
		panelId: 'p:caller',
		folderId: f.folder('project-a', 'Busy'),
	});
	const general = f.folder('project-a', 'General');
	const refusals = [
		[general, 'bad_request', /General/],
		[f.folder('project-a', 'Busy'), 'conflict', /still holds 1 tab/],
		[f.folder('project-a', 'feature'), 'bad_request', /worktree/],
	];
	for (const [folder, code, message] of refusals) {
		const outcome = await f.call('delete_folder', { folder }, context());
		assert.equal(outcome.error.code, code, folder);
		assert.match(outcome.error.message, message);
		assert.ok(f.workspace.state.folders[folder], folder);
	}
	const scratch = f.folder('project-a', 'Scratch');
	assert.deepEqual(
		await f.call('delete_folder', { folder: scratch }, context()),
		{
			folder: scratch,
			deleted: true,
		},
	);
	assert.equal(f.workspace.state.folders[scratch], undefined);
	// Another project's folder is not found from a project terminal.
	const other = await f.call(
		'delete_folder',
		{ folder: f.folder('project-b', 'General') },
		context(),
	);
	assert.equal(other.error.code, 'not_found');
});

test("reorder_folders sets one project's order, and refuses a list with another project's folder", async () => {
	const f = viewFixture();
	f.host({ type: 'folder.create', projectId: 'project-a', name: 'One' });
	f.host({ type: 'folder.create', projectId: 'project-a', name: 'Two' });
	const order = [...f.folders('project-a')].reverse();
	assert.deepEqual(
		await f.call('reorder_folders', { folders: order }, context()),
		{
			folders: order,
			reordered: true,
		},
	);
	assert.deepEqual(f.folders('project-a'), order);
	const mixed = [...order.slice(1), f.folder('project-b', 'General')];
	for (const caller of [context(), workspaceTerminal()]) {
		const outcome = await f.call('reorder_folders', { folders: mixed }, caller);
		assert.equal(outcome.error.code, 'not_found');
	}
	const partial = await f.call(
		'reorder_folders',
		{ folders: order.slice(1) },
		context(),
	);
	assert.equal(partial.error.code, 'bad_request');
	assert.deepEqual(f.folders('project-a'), order);
});

test("focus_home and focus_project for the automation space show Home on the agent's client", async () => {
	const f = viewFixture();
	assert.deepEqual(
		await f.call(
			'focus_home',
			{ section: 'tabs' },
			chat({ reach: 'workspace' }),
		),
		{
			home: true,
			section: 'tabs',
		},
	);
	assert.deepEqual(
		await f.call(
			'focus_project',
			{ project: f.handle(AUTOMATION_SPACE_PROJECT_ID) },
			workspaceTerminal(),
		),
		{
			project: f.handle(AUTOMATION_SPACE_PROJECT_ID),
			focused: true,
			home: true,
			section: 'automations',
		},
	);
	assert.deepEqual(
		f.requests.map((request) => [
			request.op,
			request.params,
			request.target.clientId,
		]),
		[
			['showHome', { section: 'tabs' }, 'window'],
			['showHome', { section: 'automations' }, 'window'],
		],
	);
	// Project reach can neither show Home nor name the automation space.
	assert.equal(
		(await f.call('focus_home', {}, context())).error.code,
		'out_of_scope',
	);
	assert.equal(
		(
			await f.call(
				'focus_project',
				{ project: f.handle(AUTOMATION_SPACE_PROJECT_ID) },
				context(),
			)
		).error.code,
		'bad_request',
	);
	assert.equal(f.requests.length, 2);
	const noClient = viewFixture({ withClient: false });
	assert.equal(
		(await noClient.call('focus_home', {}, workspaceTerminal())).error.code,
		'renderer_unavailable',
	);
});

// --- 4.5 automation run housekeeping ---

function memoryBackend() {
	let persisted;
	return {
		async load() {
			return persisted === undefined ? undefined : structuredClone(persisted);
		},
		async commit(state) {
			persisted = structuredClone(state);
		},
	};
}

async function automationFixture() {
	const repository = new AutomationRepository(memoryBackend());
	const runLog = new AutomationRunLog(memoryBackend());
	await repository.load();
	await runLog.load();
	await repository.upsert({
		id: 'nightly',
		name: 'Nightly',
		trigger: { kind: 'schedule', cron: '0 2 * * *' },
		action: { kind: 'runCommand', command: 'echo hi' },
	});
	const day = 86_400_000;
	const now = Date.now();
	const run = (runId, status, startedAt) =>
		runLog.record({
			runId,
			automationId: 'nightly',
			triggerKind: 'schedule',
			firedAt: startedAt,
			startedBy: 'trigger',
			status,
			...(status === 'finished'
				? { outcome: 'succeeded', finishedAt: startedAt + 1 }
				: {}),
			startedAt,
			suppressedEvents: 0,
		});
	await run('old', 'finished', now - 10 * day);
	await run('recent', 'finished', now - day / 2);
	await run('in-progress', 'running', now - 20 * day);
	await runLog.recordMissed('nightly', 2, now - day);
	const audit = [];
	const operations = createAutomationMcpOperations({
		repository,
		runLog,
		controller: unavailableAutomationRunController,
		onAudit: (record) => audit.push(record),
	});
	const actor = (caller) => ({ terminalSessionId: caller.terminalSessionId });
	// As the Desktop host does, a service refusal becomes a public error.
	const mapped =
		(work) =>
		async (...args) => {
			try {
				return await work(...args);
			} catch (error) {
				const control = automationControlError(error);
				if (control === undefined) throw error;
				return { ok: false, error: control };
			}
		};
	// As the Desktop host binds them.
	const dispatch = createTerminalControlAdapter({
		adapter: {},
		automations: {
			removeAutomationRun: mapped((params, caller) =>
				operations.removeRun(params.runId, actor(caller)),
			),
			pruneAutomationRuns: mapped((params, caller) =>
				operations.pruneRuns(
					params.automationId,
					params.olderThanDays,
					actor(caller),
				),
			),
			dismissMissedRuns: mapped((params, caller) =>
				operations.dismissMissed(params.automationId, actor(caller)),
			),
		},
	});
	const call = (op, params, caller = context()) =>
		dispatch({ id: op, version: 1, op, params }, caller);
	return { runLog, audit, call, operations };
}

test('prune_automation_runs keeps a run in progress, and the audit names the MCP principal', async () => {
	const f = await automationFixture();
	assert.deepEqual(
		await f.call('prune_automation_runs', {
			automation_id: 'nightly',
			older_than_days: 0,
		}),
		{ automation_id: 'nightly', removed: 2 },
	);
	assert.deepEqual(
		f.runLog.list('nightly').map((entry) => entry.runId),
		['in-progress'],
	);
	assert.deepEqual(f.audit.at(-1), {
		type: 'runs',
		operation: 'mcp.prune_automation_runs',
		automationId: 'nightly',
		removed: 2,
		actor: { clientId: 'mcp', connectionId: 'mcp:caller' },
	});
	const bad = await f.call('prune_automation_runs', {
		automation_id: 'nightly',
		older_than_days: -1,
	});
	assert.equal(bad.error.code, 'bad_request');
});

test('remove_automation_run deletes a finished run, refuses one in progress, and dismiss_missed_runs runs nothing', async () => {
	const f = await automationFixture();
	assert.deepEqual(await f.call('remove_automation_run', { run_id: 'old' }), {
		run_id: 'old',
		removed: 1,
	});
	assert.equal(f.audit.at(-1).operation, 'mcp.remove_automation_run');
	assert.equal(f.audit.at(-1).actor.clientId, 'mcp');
	const running = await f.call('remove_automation_run', {
		run_id: 'in-progress',
	});
	assert.equal(running.error.code, 'bad_request');
	assert.ok(f.runLog.get('in-progress'));
	assert.equal(
		(await f.call('remove_automation_run', { run_id: 'nope' })).error.code,
		'not_found',
	);
	assert.equal(f.runLog.listMissed().length, 1);
	assert.deepEqual(
		await f.call('dismiss_missed_runs', { automation_id: 'nightly' }),
		{
			dismissed: true,
		},
	);
	assert.equal(f.runLog.listMissed().length, 0);
	assert.equal(f.runLog.list('nightly').length, 2);
	// The approval prompt says what would go.
	assert.match(
		(
			await f.operations.describe({
				kind: 'pruneRuns',
				automationId: 'nightly',
				olderThanDays: 3,
			})
		).summary,
		/older than 3 days/,
	);
});

// --- 4.6 notifications by reach ---

async function notificationFixture() {
	const manager = new NotificationManager({ settleMs: 0 });
	const acknowledged = [];
	const registry = createNotificationOperationRegistry({
		manager,
		eventJournal: new OrderedEventJournal(),
		acknowledgeTerminal: (owner) => {
			acknowledged.push(owner);
			manager.setActivity(owner, undefined);
		},
	});
	const sessions = [
		{ projectId: 'project-a', sessionId: 'caller' },
		{ projectId: 'project-a', sessionId: 'sibling' },
		{ projectId: 'project-b', sessionId: 'worker' },
	];
	manager.setActivity(sessions[1], 'agent-finished');
	manager.setActivity(sessions[2], 'agent-finished');
	await delay(5);
	const adapter = createNotificationControlAdapter({
		notifications: manager,
		// A user's dismissal, through the notifications' own operation.
		dismiss: async (record) =>
			(
				await registry.operations.commands['notifications.dismiss'](
					mcpPrincipalCommandRequest('notifications.dismiss', {
						id: record.id,
						projectId: record.projectId,
						sessionId: record.sessionId,
					}),
				)
			).dismissed,
		reaches: (caller, owner) =>
			sessions.some(
				(session) =>
					session.sessionId === owner.sessionId &&
					session.projectId === owner.projectId,
			) &&
			(caller.reach === 'workspace' || owner.projectId === caller.projectId),
	});
	const dispatch = createTerminalControlAdapter({
		adapter: {},
		notifications: adapter,
	});
	const call = (op, params, caller) =>
		dispatch({ id: op, version: 1, op, params }, caller);
	return { manager, acknowledged, call };
}

test('list_notifications lists only notifications of terminals the caller reaches', async () => {
	const f = await notificationFixture();
	const own = await f.call('list_notifications', {}, context());
	assert.deepEqual(
		own.notifications.map((row) => [row.terminal, row.kind]),
		[['sibling', 'agent-finished']],
	);
	const all = await f.call(
		'list_notifications',
		{},
		chat({ reach: 'workspace' }),
	);
	assert.deepEqual(all.notifications.map((row) => row.terminal).sort(), [
		'sibling',
		'worker',
	]);
});

test("a project caller cannot dismiss another project's notification; dismissing an activity one acknowledges its terminal", async () => {
	const f = await notificationFixture();
	const all = await f.call(
		'list_notifications',
		{},
		chat({ reach: 'workspace' }),
	);
	const handleOf = (terminal) =>
		all.notifications.find((row) => row.terminal === terminal).notification;
	const refused = await f.call(
		'dismiss_notification',
		{ notification: handleOf('worker') },
		context(),
	);
	assert.equal(refused.error.code, 'not_found');
	assert.deepEqual(f.acknowledged, []);
	assert.ok(f.manager.snapshot().notifications[handleOf('worker')]);
	// A chat, which has no terminal, dismisses by reach.
	assert.deepEqual(
		await f.call(
			'dismiss_notification',
			{ notification: handleOf('worker') },
			chat({ reach: 'workspace' }),
		),
		{ notification: handleOf('worker'), dismissed: true },
	);
	assert.deepEqual(f.acknowledged, [
		{ projectId: 'project-b', sessionId: 'worker' },
	]);
	assert.equal(
		f.manager.snapshot().notifications[handleOf('worker')],
		undefined,
	);
	// A project terminal dismisses its own project's activity notification.
	await f.call(
		'dismiss_notification',
		{ notification: handleOf('sibling') },
		context(),
	);
	assert.deepEqual(f.acknowledged.at(-1), {
		projectId: 'project-a',
		sessionId: 'sibling',
	});
	// What a terminal sent it can still dismiss before it is ever shown.
	const sent = f.manager.send(
		{ projectId: 'project-a', sessionId: 'caller' },
		{ body: 'hi' },
	);
	assert.deepEqual(
		await f.call('dismiss_notification', { notification: sent.id }, context()),
		{
			notification: sent.id,
			dismissed: true,
		},
	);
});

// --- 4.7 macros ---

async function macroFixture() {
	let persisted;
	const repository = new MacroRepository({
		load: async () =>
			persisted === undefined ? undefined : structuredClone(persisted),
		commit: async (state) => {
			persisted = structuredClone(state);
		},
	});
	const writes = [];
	const registry = createMacroOperationRegistry({
		serverId: 'server-a',
		repository,
		eventJournal: new OrderedEventJournal(),
		environmentFor: (_request, target) => ({
			target,
			write: (_candidate, bytes) => {
				writes.push({ target, text: new TextDecoder().decode(bytes) });
			},
		}),
	});
	await repository.upsert({
		id: 'deploy',
		title: 'Deploy',
		fields: [
			{
				id: 'f1',
				name: 'env',
				label: 'Environment',
				type: 'select',
				required: true,
				options: [
					{ label: 'Staging', value: 'staging' },
					{ label: 'Production', value: 'production' },
				],
				defaultValue: '',
			},
			{
				id: 'f2',
				name: 'count',
				label: 'Count',
				type: 'number',
				required: false,
				defaultValue: 1,
			},
			{
				id: 'f3',
				name: 'reason',
				label: 'Reason',
				type: 'text',
				required: true,
				defaultValue: '',
			},
		],
		steps: [
			{
				id: 's1',
				type: 'type',
				content: 'deploy {{env}} {{count}} {{reason}}',
			},
		],
	});
	await repository.upsert({
		id: 'slow',
		title: 'Slow',
		steps: [
			{ id: 'w', type: 'wait_time', durationSeconds: '0.2' },
			{ id: 't', type: 'type', content: 'done' },
		],
	});
	const sessions = {
		caller: 'project-a',
		worker: 'project-b',
	};
	const adapter = createMacroControlAdapter({
		query: async (operation, payload, signal) =>
			registry.operations.queries[operation](
				mcpPrincipalQueryRequest(operation, payload, signal),
			),
		command: async (operation, payload, signal) =>
			registry.operations.commands[operation](
				mcpPrincipalCommandRequest(operation, payload, signal),
			),
		resolveTerminal: (caller, reference) => {
			const projectId = sessions[reference];
			if (
				projectId === undefined ||
				(caller.reach !== 'workspace' && projectId !== caller.projectId)
			)
				throw notFound();
			return { serverId: 'server-a', projectId, sessionId: reference };
		},
	});
	const dispatch = createTerminalControlAdapter({
		adapter: {},
		macros: adapter,
	});
	const call = (op, params, caller = context()) =>
		dispatch({ id: op, version: 1, op, params }, caller);
	return { registry, writes, call };
}

test('run_macro validates fields as the launch form does and runs in a terminal the caller reaches', async () => {
	const f = await macroFixture();
	const listed = await f.call('list_macros', {});
	assert.deepEqual(listed.macros.map((macro) => macro.id).sort(), [
		'deploy',
		'slow',
	]);
	assert.deepEqual(
		listed.macros.find((macro) => macro.id === 'deploy').fields[0].options,
		['staging', 'production'],
	);
	for (const [values, message] of [
		[{}, /"Reason" is required/],
		[{ reason: '   ' }, /"Reason" is required/],
		[{ reason: 'r', env: 'moon' }, /must be one of: staging, production/],
		[{ reason: 'r', count: 'two' }, /"Count" must be a number/],
		[{ reason: 'r', extra: 'x' }, /no field named "extra"/],
	]) {
		const outcome = await f.call('run_macro', {
			macro_id: 'deploy',
			terminal: 'caller',
			values,
		});
		assert.equal(outcome.error.code, 'bad_request', JSON.stringify(values));
		assert.match(outcome.error.message, message);
	}
	assert.deepEqual(f.writes, []);
	// A terminal of another project fails as not found, and nothing runs.
	const outside = await f.call('run_macro', {
		macro_id: 'deploy',
		terminal: 'worker',
		values: { reason: 'r' },
	});
	assert.equal(outside.error.code, 'terminal_not_found');
	const run = await f.call('run_macro', {
		macro_id: 'deploy',
		terminal: 'caller',
		values: { env: 'production', count: 3, reason: 'release' },
	});
	assert.equal(run.terminal, 'caller');
	assert.match(run.run_id, /^deploy:/);
	await delay(20);
	assert.deepEqual(f.writes, [
		{
			target: {
				serverId: 'server-a',
				projectId: 'project-a',
				sessionId: 'caller',
			},
			text: 'deploy production 3 release',
		},
	]);
});

test("an MCP macro run has no launching client: it survives the caller's capability ending, and cancel_macro needs reach", async () => {
	const f = await macroFixture();
	const run = await f.call('run_macro', {
		macro_id: 'slow',
		terminal: 'caller',
	});
	// The capability ends and every connection that could have launched it closes.
	f.registry.closeConnection('system:mcp');
	f.registry.closeConnection('local');
	assert.equal(f.registry.runner.snapshot(run.run_id)?.status, 'running');
	// Another project's terminal cannot reach the run.
	const outside = await f.call(
		'cancel_macro',
		{ run_id: run.run_id },
		context({ terminalSessionId: 'worker', projectId: 'project-b' }),
	);
	assert.equal(outside.error.code, 'not_found');
	await delay(300);
	assert.deepEqual(
		f.writes.map((write) => write.text),
		['done'],
	);
	// A run cancelled by a caller that reaches it stops.
	const second = await f.call('run_macro', {
		macro_id: 'slow',
		terminal: 'caller',
	});
	assert.deepEqual(
		await f.call(
			'cancel_macro',
			{ run_id: second.run_id },
			workspaceTerminal(),
		),
		{
			run_id: second.run_id,
			cancelled: true,
		},
	);
	await delay(300);
	assert.deepEqual(
		f.writes.map((write) => write.text),
		['done'],
	);
});
