import assert from 'node:assert/strict';
import test from 'node:test';
import {
	AUTOMATION_SPACE_PROJECT_ID,
	WORKSPACE_VIEW_EVENTS,
	WORKSPACE_VIEW_OPERATIONS,
	WorkspaceRepository,
	WorkspaceViewRelay,
} from '@terminay/server-core';
import {
	createTerminalControlAdapter,
	createWorkspaceViewAdapter,
	ProjectHandleCodec,
} from '../dist/index.js';

/**
 * The MCP view tools (ADR-0070), end to end on the server: scope resolution,
 * the relay to the agent's client, and what the agent is told back. The
 * client is simulated at the relay's wire: it receives the addressed event and
 * answers with the respond command, as a real window does.
 */

const KEY = new Uint8Array(32).fill(7);

async function fixture() {
	let persisted;
	const repository = new WorkspaceRepository(
		{ load: async () => persisted, commit: async (state) => { persisted = state; } },
		'server-a',
	);
	const initial = await repository.load();
	const viewId = initial.viewOrder[0];
	let commands = 0;
	const apply = async (command) => {
		const result = await repository.apply({ commandId: `c${++commands}`, command });
		if (!result.ok) throw new Error(`refused ${command.type}`);
	};
	for (const [projectId, name] of [['project-a', 'Alpha'], ['project-b', 'Beta']])
		await apply({ type: 'project.create', projectId, viewId, root: `/work/${projectId}`, name });
	repository.workspace.ensureAutomationSpace({ root: '/work/automations' });
	const addTerminal = async (sessionId, projectId, folderId) => {
		await apply({
			type: 'terminal.createPanel',
			sessionId,
			projectId,
			...(folderId === undefined ? {} : { folderId }),
			panelId: `p:${sessionId}`,
			title: sessionId,
			createdAt: 1,
		});
	};
	await addTerminal('caller', 'project-a');
	await addTerminal('sibling', 'project-a');
	await addTerminal('other', 'project-b');
	await addTerminal('automation', AUTOMATION_SPACE_PROJECT_ID);

	// The agent's client, at the relay's wire.
	const requests = [];
	let answer = (request) => ({ ok: true, result: { layout: layoutFor(request.params.projectId ?? 'project-a') } });
	const relay = new WorkspaceViewRelay({
		eventJournal: {
			revision: 0,
			cursor: '0',
			append() { throw new Error('view requests are never retained'); },
			publishTransient(event, payload) {
				assert.equal(event, WORKSPACE_VIEW_EVENTS.request);
				requests.push(payload);
				queueMicrotask(() => {
					const reply = answer(payload);
					relay.operations().commands[WORKSPACE_VIEW_OPERATIONS.respond]({
						envelope: { payload: { requestId: payload.requestId, ...reply } },
						body: new Uint8Array(),
						context: { connectionId: payload.toConnectionId, clientId: payload.clientId, authScope: 'full' },
					});
				});
				return { revision: 0, cursor: '0' };
			},
		},
	});
	relay.operations().commands[WORKSPACE_VIEW_OPERATIONS.attach]({
		envelope: { payload: {} },
		body: new Uint8Array(),
		context: { connectionId: 'window-conn', clientId: 'window', authScope: 'full' },
	});
	let target = { clientId: 'window', connectionId: 'window-conn' };
	const projectHandles = new ProjectHandleCodec('server-a', KEY);
	const view = createWorkspaceViewAdapter({
		relay,
		targetFor: () => target,
		state: () => repository.workspace.state,
		apply: (command) => apply(command),
		projectHandles,
	});
	return {
		repository,
		apply,
		addTerminal,
		requests,
		view,
		projectHandles,
		setAnswer: (next) => { answer = next; },
		setTarget: (next) => { target = next; },
		general: (projectId) => repository.workspace.state.projects[projectId].folderIds[0],
	};
}

function layoutFor(projectId, tabs = ['caller', 'sibling']) {
	return {
		projectId,
		shownProjectId: 'project-a',
		root: {
			split: 'row',
			children: tabs.map((sessionId, index) => ({
				size: 1 / tabs.length,
				pane: String(index + 1),
				tabs: [{ tab: `p:${sessionId}`, sessionId, kind: 'terminal', title: sessionId, active: true }],
			})),
		},
		focusedTab: `p:${tabs[0]}`,
	};
}

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
const automation = () => context({ terminalSessionId: 'automation', projectId: AUTOMATION_SPACE_PROJECT_ID, reach: 'workspace' });

async function rejects(promise, code) {
	await assert.rejects(promise, (error) => error.code === code);
}

test('get_layout asks the agent\'s client about the caller\'s own project and describes it with terminal handles', async () => {
	const { view, requests, general } = await fixture();
	const layout = await view.getLayout({}, context(), new AbortController().signal);
	assert.equal(requests.length, 1);
	assert.equal(requests[0].clientId, 'window');
	assert.equal(requests[0].toConnectionId, 'window-conn');
	assert.equal(requests[0].op, 'layout');
	assert.deepEqual(requests[0].params, { projectId: 'project-a' });
	assert.equal(layout.visible, true);
	assert.equal(layout.project, undefined, 'project reach never names a project');
	assert.equal(layout.projects, undefined);
	assert.equal(layout.root.split, 'row');
	assert.deepEqual(layout.root.children.map((pane) => pane.tabs[0].terminal), ['caller', 'sibling']);
	assert.equal(layout.focused_tab, 'p:caller');
	assert.deepEqual(layout.folders, [{ folder: general('project-a'), name: 'General', kind: 'general', selected: false }]);
});

test('a project-scope caller cannot name a project, and a reply about another project is refused', async () => {
	const { view, requests, projectHandles, setAnswer } = await fixture();
	await rejects(view.getLayout({ project: projectHandles.handleFor('project-b') }, context(), new AbortController().signal), 'bad_request');
	assert.equal(requests.length, 0);
	setAnswer(() => ({ ok: true, result: { layout: layoutFor('project-b', ['other']) } }));
	await rejects(view.getLayout({}, context(), new AbortController().signal), 'internal');
});

test('a terminal outside the caller\'s project is dropped from what the client reports', async () => {
	const { view, setAnswer } = await fixture();
	setAnswer(() => ({ ok: true, result: { layout: layoutFor('project-a', ['caller', 'other']) } }));
	const layout = await view.getLayout({}, context(), new AbortController().signal);
	const terminals = layout.root.children.flatMap((pane) => pane.tabs.map((tab) => tab.terminal));
	assert.deepEqual(terminals, ['caller']);
});

test('a workspace-scope caller sees project handles, every ordinary project, and can pick one', async () => {
	const { view, requests, projectHandles, setAnswer } = await fixture();
	setAnswer((request) => ({ ok: true, result: { layout: layoutFor(request.params.projectId ?? 'project-a', request.params.projectId === 'project-b' ? ['other'] : ['caller']) } }));
	const shown = await view.getLayout({}, automation(), new AbortController().signal);
	assert.equal(requests[0].params.projectId, undefined, 'the client reports what it shows');
	assert.equal(shown.project, projectHandles.handleFor('project-a'));
	assert.equal(shown.project_title, 'Alpha');
	assert.deepEqual(shown.projects.map((project) => project.title).sort(), ['Alpha', 'Beta']);
	const beta = await view.getLayout({ project: projectHandles.handleFor('project-b') }, automation(), new AbortController().signal);
	assert.equal(requests[1].params.projectId, 'project-b');
	assert.equal(beta.visible, false);
	assert.equal(beta.root.children[0].tabs[0].terminal, 'other');
});

test('a tab outside scope is not found and no client is asked', async () => {
	const { view, requests } = await fixture();
	await rejects(view.focusTab({ tab: 'other' }, context(), new AbortController().signal), 'not_found');
	await rejects(view.focusTab({ tab: 'p:other' }, context(), new AbortController().signal), 'not_found');
	assert.equal(requests.length, 0);
});

test('with no client to talk to, a view tool fails instead of pretending', async () => {
	const { view, setTarget, requests } = await fixture();
	setTarget(undefined);
	await rejects(view.focusTab({ tab: 'sibling' }, context(), new AbortController().signal), 'renderer_unavailable');
	setTarget({ clientId: 'window', connectionId: 'not-attached' });
	await rejects(view.arrangeTabs({ arrangement: 'grid' }, context(), new AbortController().signal), 'renderer_unavailable');
	assert.equal(requests.length, 0);
});

test('a client refusal keeps its meaning', async () => {
	const { view, setAnswer } = await fixture();
	setAnswer(() => ({ ok: false, error: { code: 'not_found', message: 'No such tab is open in this window.' } }));
	await rejects(view.focusTab({ tab: 'sibling' }, context(), new AbortController().signal), 'not_found');
	setAnswer(() => ({ ok: false, error: { code: 'unavailable', message: 'That project is not open in this window.' } }));
	await rejects(view.focusTab({ tab: 'sibling' }, context(), new AbortController().signal), 'renderer_unavailable');
	setAnswer(() => ({ ok: true, result: { layout: { projectId: 'project-a', root: { split: 'diagonal' } } } }));
	await rejects(view.focusTab({ tab: 'sibling' }, context(), new AbortController().signal), 'internal');
});

test('focus, move, resize, and arrange send exactly what the client needs and return its layout', async () => {
	const { view, requests } = await fixture();
	const signal = new AbortController().signal;
	const focused = await view.focusTab({ tab: 'sibling' }, context(), signal);
	assert.deepEqual(requests.at(-1).params, { projectId: 'project-a', tab: { sessionId: 'sibling' } });
	assert.equal(focused.focused, true);
	assert.ok(focused.layout.root);

	await view.moveTab({ tab: 'sibling', beside: 'p:caller', position: 'below' }, context(), signal);
	assert.equal(requests.at(-1).op, 'place');
	assert.deepEqual(requests.at(-1).params, {
		projectId: 'project-a',
		tab: { sessionId: 'sibling' },
		beside: { tab: 'p:caller', sessionId: 'caller' },
		position: 'below',
		focus: false,
	});

	await view.resizePane({ tab: 'caller', width: 0.3 }, context(), signal);
	assert.deepEqual(requests.at(-1).params, { projectId: 'project-a', tab: { sessionId: 'caller' }, width: 0.3 });

	await view.arrangeTabs({ arrangement: 'grid', tabs: ['caller', 'sibling', 'file-3'] }, context(), signal);
	assert.equal(requests.at(-1).op, 'arrange');
	assert.deepEqual(requests.at(-1).params, {
		projectId: 'project-a',
		arrangement: 'grid',
		tabs: [{ sessionId: 'caller' }, { sessionId: 'sibling' }, { tab: 'file-3' }],
	});
});

test('tabs of two projects cannot be moved or arranged together', async () => {
	const { view, requests } = await fixture();
	const signal = new AbortController().signal;
	await rejects(view.moveTab({ tab: 'caller', beside: 'other', position: 'right' }, automation(), signal), 'bad_request');
	await rejects(view.arrangeTabs({ arrangement: 'columns', tabs: ['caller', 'other'] }, automation(), signal), 'bad_request');
	assert.equal(requests.length, 0);
});

test('focus_project shows a project, or the automation space through Home, and only to workspace scope', async () => {
	const { view, requests, projectHandles, repository } = await fixture();
	const signal = new AbortController().signal;
	await view.focusProject({ project: projectHandles.handleFor('project-b') }, automation(), signal);
	assert.deepEqual(requests.at(-1), { ...requests.at(-1), op: 'showProject', params: { projectId: 'project-b' } });
	const space = Object.values(repository.workspace.state.projects).find((project) => project.id === AUTOMATION_SPACE_PROJECT_ID);
	// The automation space is shown through Home, with Automations in front (ADR-0072).
	const shown = await view.focusProject({ project: projectHandles.handleFor(space.id) }, automation(), signal);
	assert.equal(shown.home, true);
	assert.deepEqual(requests.at(-1), { ...requests.at(-1), op: 'showHome', params: { section: 'automations' } });
	await rejects(view.focusProject({ project: projectHandles.handleFor('project-b') }, context(), signal), 'bad_request');
});

test('folders: create, rename, move a terminal into one, and show it; never another project\'s', async () => {
	const { view, requests, repository, general } = await fixture();
	const signal = new AbortController().signal;
	const created = await view.createFolder({ name: 'Builds' }, context(), signal);
	const folder = repository.workspace.state.folders[created.folder];
	assert.equal(folder.projectId, 'project-a');
	assert.equal(folder.name, 'Builds');
	await view.renameFolder({ folder: created.folder, name: 'CI' }, context(), signal);
	assert.equal(repository.workspace.state.folders[created.folder].name, 'CI');
	await view.moveTabToFolder({ tab: 'sibling', folder: created.folder }, context(), signal);
	assert.equal(repository.workspace.state.panels['p:sibling'].folderId, created.folder);
	await view.selectFolder({ folder: created.folder }, context(), signal);
	assert.deepEqual(requests.at(-1).params, { projectId: 'project-a', folderId: created.folder });
	await rejects(view.renameFolder({ folder: general('project-a'), name: 'X' }, context(), signal), 'bad_request');
	await rejects(view.selectFolder({ folder: general('project-b') }, context(), signal), 'not_found');
	await rejects(view.moveTabToFolder({ tab: 'other', folder: created.folder }, automation(), signal), 'bad_request');
	await rejects(view.createFolder({ name: 'Elsewhere' }, context(), signal).then(() => view.createFolder({ name: 'Elsewhere' }, context(), signal)), 'bad_request');
});

test('open_file sends the path and returns the tab, never content', async () => {
	const { view, requests, setAnswer } = await fixture();
	setAnswer((request) => ({ ok: true, result: { tab: 'file-1', content: 'SECRET', layout: layoutFor(request.params.projectId) } }));
	const opened = await view.openFile({ path: 'README.md' }, context(), new AbortController().signal);
	assert.deepEqual(requests.at(-1).params, { projectId: 'project-a', path: 'README.md' });
	assert.equal(opened.tab, 'file-1');
	assert.equal(JSON.stringify(opened).includes('SECRET'), false);
});

test('close_tab reports whether the tab closed', async () => {
	const { view, setAnswer } = await fixture();
	setAnswer((request) => ({ ok: true, result: { closed: false, layout: layoutFor(request.params.projectId) } }));
	const kept = await view.closeTab({ tab: 'sibling' }, context(), new AbortController().signal);
	assert.equal(kept.closed, false);
});

/** A host that opens terminals into the same workspace, as both real hosts do. */
function hostFor(fx, opened = []) {
	let next = 0;
	const create = async (projectId, folderId) => {
		const sessionId = `new-${++next}`;
		await fx.addTerminal(sessionId, projectId, folderId);
		opened.push(sessionId);
		return { terminal: sessionId, status: 'running' };
	};
	return {
		opened,
		adapter: {
			listTerminals: () => ({ terminals: [] }),
			readTerminal: () => ({}),
			getTerminalStatus: () => ({}),
			writeTerminal: () => ({}),
			runCommand: () => ({}),
			closeTerminal: () => ({}),
			renameTerminal: () => ({}),
			waitForIdle: () => ({}),
			waitForCommand: () => ({}),
			waitForAttention: () => ({}),
			getMcpCapabilities: () => ({ tools: [{ tool: 'focus_terminal', available: false }, { tool: 'arrange_tabs', available: false }, { tool: 'run_command', available: true }] }),
			focusTerminal: (params) => ({ terminal: params.terminal }),
			openTerminal: async (params, context) => {
				const projectId = params.project === undefined
					? context.projectId
					: [...Object.keys(fx.repository.workspace.state.projects)].find((id) => fx.projectHandles.handleFor(id) === params.project);
				return create(projectId);
			},
			splitTerminal: async (params) => {
				const panel = fx.repository.workspace.state.panels[`p:${params.terminal}`];
				return create(panel.projectId, panel.folderId);
			},
		},
	};
}

function dispatcher(fx, host) {
	const dispatch = createTerminalControlAdapter({ adapter: host.adapter, workspaceView: fx.view });
	return (op, params, ctx = context()) => dispatch({ id: 'r', version: 1, op, params }, ctx);
}

test('split_terminal opens exactly one terminal and places it beside its target on the agent\'s client', async () => {
	const fx = await fixture();
	const host = hostFor(fx);
	const call = dispatcher(fx, host);
	const result = await call('split_terminal', { terminal: 'caller', direction: 'right' });
	assert.deepEqual(host.opened, ['new-1']);
	assert.equal(result.terminal, 'new-1');
	assert.equal(result.opened, 1);
	assert.equal(result.placed, true);
	assert.equal(result.focused, false);
	assert.ok(result.layout.root);
	assert.deepEqual(fx.requests.at(-1).params, {
		projectId: 'project-a',
		tab: { sessionId: 'new-1' },
		beside: { sessionId: 'caller' },
		position: 'right',
		focus: false,
	});
});

test('the 2x2 request: three splits make three terminals, each placed, and the layout says where', async () => {
	const fx = await fixture();
	const host = hostFor(fx);
	const call = dispatcher(fx, host);
	const right = await call('split_terminal', { terminal: 'caller', direction: 'right' });
	const belowLeft = await call('split_terminal', { terminal: 'caller', direction: 'below' });
	const belowRight = await call('split_terminal', { terminal: right.terminal, direction: 'below' });
	assert.deepEqual(host.opened, ['new-1', 'new-2', 'new-3']);
	for (const result of [right, belowLeft, belowRight]) assert.equal(result.placed, true);
	assert.deepEqual(
		fx.requests.map((request) => [request.op, request.params.tab.sessionId, request.params.beside.sessionId, request.params.position]),
		[
			['place', 'new-1', 'caller', 'right'],
			['place', 'new-2', 'caller', 'below'],
			['place', 'new-3', 'new-1', 'below'],
		],
	);
});

test('a terminal that cannot be placed is still opened, and the result says why', async () => {
	const fx = await fixture();
	const host = hostFor(fx);
	fx.setAnswer(() => ({ ok: false, error: { code: 'unavailable', message: 'That project is not open in this window.' } }));
	const result = await dispatcher(fx, host)('split_terminal', { terminal: 'caller', direction: 'below' });
	assert.deepEqual(host.opened, ['new-1']);
	assert.equal(result.terminal, 'new-1');
	assert.equal(result.placed, false);
	assert.match(result.reason, /not open in this window/);
});

test('open_terminal asks nothing of the client unless told to place or focus', async () => {
	const fx = await fixture();
	const host = hostFor(fx);
	const call = dispatcher(fx, host);
	const quiet = await call('open_terminal', { name: 'Quiet' });
	assert.equal(quiet.terminal, 'new-1');
	assert.equal(quiet.placed, undefined);
	assert.equal(fx.requests.length, 0);
	const focused = await call('open_terminal', { focus: true });
	assert.equal(focused.focused, true);
	assert.deepEqual(fx.requests.at(-1), { ...fx.requests.at(-1), op: 'focus', params: { projectId: 'project-a', tab: { sessionId: 'new-2' } } });
});

test('open_terminal with split goes beside the calling terminal by default, or beside a named tab', async () => {
	const fx = await fixture();
	const host = hostFor(fx);
	const call = dispatcher(fx, host);
	await call('open_terminal', { split: 'left' });
	assert.deepEqual(fx.requests.at(-1).params.beside, { sessionId: 'caller' });
	await call('open_terminal', { split: 'above', beside: 'sibling', focus: true });
	assert.deepEqual(fx.requests.at(-1).params, {
		projectId: 'project-a',
		tab: { sessionId: 'new-2' },
		beside: { sessionId: 'sibling' },
		position: 'above',
		focus: true,
	});
	const refused = await call('open_terminal', { split: 'right', beside: 'other' });
	assert.equal(refused.ok, false);
	assert.equal(refused.error.code, 'not_found');
	assert.deepEqual(host.opened, ['new-1', 'new-2'], 'nothing opens beside a tab the caller cannot reach');
});

test('a chat that splits opens in the project its window shows, beside the tab in front', async () => {
	const fx = await fixture();
	const host = hostFor(fx);
	const chat = context({ terminalSessionId: 'chat:c1', projectId: AUTOMATION_SPACE_PROJECT_ID, reach: 'workspace', chat: { chatId: 'c1' } });
	fx.setAnswer(() => ({ ok: true, result: { layout: { ...layoutFor('project-b', ['other']), shownProjectId: 'project-b' } } }));
	const result = await dispatcher(fx, host)('open_terminal', { split: 'right' }, chat);
	assert.equal(fx.repository.workspace.state.panels[`p:${result.terminal}`].projectId, 'project-b');
	assert.equal(fx.requests[0].op, 'layout');
	assert.deepEqual(fx.requests[1].params.beside, { tab: 'p:other', sessionId: 'other' });
	assert.equal(result.placed, true);
});

test('a terminal placed beside a tab in another folder is moved to that folder first', async () => {
	const fx = await fixture();
	const host = hostFor(fx);
	const folder = await fx.view.createFolder({ name: 'Side' }, context(), new AbortController().signal);
	await fx.view.moveTabToFolder({ tab: 'sibling', folder: folder.folder }, context(), new AbortController().signal);
	const result = await dispatcher(fx, host)('open_terminal', { split: 'below', beside: 'sibling' });
	assert.equal(result.placed, true);
	assert.equal(fx.repository.workspace.state.panels[`p:${result.terminal}`].folderId, folder.folder);
});

test('focus_terminal shows the terminal on the agent\'s client and nowhere else', async () => {
	const fx = await fixture();
	const result = await dispatcher(fx, hostFor(fx))('focus_terminal', { terminal: 'sibling' });
	assert.equal(result.terminal, 'sibling');
	assert.equal(result.focused, true);
	assert.equal(fx.requests.length, 1);
	assert.equal(fx.requests[0].op, 'focus');
});

test('capabilities report the view tools available exactly when a view is bound', async () => {
	const fx = await fixture();
	const host = hostFor(fx);
	const bound = await dispatcher(fx, host)('get_mcp_capabilities', {});
	assert.deepEqual(bound.tools.map((tool) => [tool.tool, tool.available]), [['focus_terminal', true], ['arrange_tabs', true], ['run_command', true]]);
	const unbound = await createTerminalControlAdapter({ adapter: host.adapter })({ id: 'r', version: 1, op: 'get_mcp_capabilities', params: {} }, context());
	assert.deepEqual(unbound.tools.map((tool) => [tool.tool, tool.available]), [['focus_terminal', false], ['arrange_tabs', false], ['run_command', true]]);
	const refused = await createTerminalControlAdapter({ adapter: host.adapter })({ id: 'r', version: 1, op: 'get_layout', params: {} }, context());
	assert.equal(refused.error.code, 'unsupported_op');
});

test('view tool parameters are validated before anything runs', async () => {
	const fx = await fixture();
	const call = dispatcher(fx, hostFor(fx));
	for (const [op, params] of [
		['move_tab', { tab: 'caller', beside: 'caller' }],
		['move_tab', { tab: 'caller', beside: 'sibling', position: 'diagonal' }],
		['resize_pane', { tab: 'caller' }],
		['resize_pane', { tab: 'caller', width: 1.5 }],
		['arrange_tabs', { arrangement: 'spiral' }],
		['arrange_tabs', { arrangement: 'grid', tabs: ['caller', 'caller'] }],
		['focus_project', {}],
		['create_folder', { name: ' ' }],
		['open_file', { path: 'a\u0000b' }],
		['open_terminal', { beside: 'caller' }],
		['split_terminal', { terminal: 'caller', direction: 'right', focus: 'yes' }],
	]) {
		const result = await call(op, params);
		assert.equal(result.ok, false, `${op} ${JSON.stringify(params)}`);
		assert.equal(result.error.code, 'bad_request', `${op} ${JSON.stringify(params)}`);
	}
	assert.equal(fx.requests.length, 0);
});
