import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import {
	FileViewerClient,
	ProjectEnvironmentsClient,
	TerminayClient,
	TerminayClientFacade,
	TerminayTerminalClient,
	WorkspaceClient,
} from '@terminay/client-core';
import { build } from 'esbuild';

const {
	ServerPortTransport,
	ServerScopedMessagePort,
	ServerTerminalAuthority,
	TerminalService,
	TerminalServiceError,
	getPathRelativeToRoot,
	WorkspaceStore,
	createInitialWorkspace,
} = await importAuthority();

test('Electron detaches authority consumers when a renderer is destroyed', async () => {
	const main = await readFile(
		new URL('../electron/main.ts', import.meta.url),
		'utf8',
	);

	assert.match(
		main,
		/app\.on\('web-contents-created',[\s\S]*?const webContentsId = contents\.id;[\s\S]*?contents\.once\('destroyed',[\s\S]*?detachSessionsForWebContents\(webContentsId\)/u,
	);
	assert.match(
		main,
		/function detachSessionsForWebContents\(webContentsId: number\): void \{[\s\S]*?serverTerminalAuthority\?\.detachRendererAll\(webContentsId\)/u,
	);
	assert.match(
		main,
		/serverTerminalAuthority\?\.acceptRendererPort\([\s\S]*?ownerId:\s*windowWebContentsId/u,
	);
	assert.doesNotMatch(
		main,
		/function detachSessionsForWebContents[\s\S]*?serverTerminalAuthority\?\.kill\(/u,
	);
});

function bindRendererChannel(channel) {
	let serverMessage;
	let serverMessageError;
	let closed = 0;
	channel.port1.on('message', (data) => serverMessage?.({ data }));
	channel.port1.on('messageerror', () => serverMessageError?.());
	return {
		closed: () => closed,
		port: {
			get onmessage() {
				return serverMessage;
			},
			set onmessage(listener) {
				serverMessage = listener;
			},
			get onmessageerror() {
				return serverMessageError;
			},
			set onmessageerror(listener) {
				serverMessageError = listener;
			},
			postMessage: (data) => channel.port1.postMessage(data),
			start: () => channel.port1.start(),
			close: () => {
				closed += 1;
				channel.port1.close();
			},
		},
	};
}

function createPtyFactory() {
	const processes = [];
	return {
		processes,
		spawn(options) {
			const exitListeners = new Set();
			const dataListeners = new Set();
			const process = {
				pid: 7_000 + processes.length,
				options,
				writes: [],
				resizes: [],
				write(bytes) {
					this.writes.push(new Uint8Array(bytes));
				},
				resize(dimensions) {
					this.resizes.push({ ...dimensions });
				},
				kills: 0,
				kill() {
					this.kills += 1;
				},
				onData(listener) {
					dataListeners.add(listener);
					return () => dataListeners.delete(listener);
				},
				onExit(listener) {
					exitListeners.add(listener);
					return () => exitListeners.delete(listener);
				},
				emitData(data) {
					for (const listener of dataListeners) listener(data);
				},
				emitExit(exit = {}) {
					for (const listener of exitListeners) listener(exit);
				},
			};
			processes.push(process);
			return process;
		},
	};
}

function systemShellProfiles(shellPath = '/bin/zsh', environment = {}) {
	const definition = {
		id: 'system',
		name: 'System default',
		target: { kind: 'system' },
		args: [],
		startupMode: 'login',
		environment,
	};
	const profile = {
		...definition,
		kind: 'system',
		readOnly: true,
		source: 'system',
		availability: { available: true },
		projectReferences: [],
		environmentEntryCount: 0,
		hasEnvironmentOverlay: false,
	};
	return {
		async catalogue() {
			return {
				settingsRevision: 3,
				defaultProfileId: 'system',
				cwdPolicy: 'current',
				entries: [profile],
			};
		},
		async resolveProfile(_id, catalogue) {
			return {
				profile,
				definition,
				settingsRevision: catalogue.settingsRevision,
				target: { kind: 'executable', executable: shellPath },
			};
		},
	};
}

test('ServerTerminalAuthority exposes redacted workspace command records only in test mode', async () => {
	const previousTestMode = process.env.TERMINAY_TEST;
	process.env.TERMINAY_TEST = '1';
	const authority = new ServerTerminalAuthority({
		serverId: 'workspace-command-observer',
		terminalService: new TerminalService({
			serverId: 'workspace-command-observer',
			ptyFactory: createPtyFactory(),
		}),
	});
	const channel = new MessageChannel();
	const renderer = bindRendererChannel(channel);
	try {
		const viewId = authority.workspace.state.viewOrder[0];
		authority.workspace.apply({
			commandId: 'seed-sidebar-project',
			command: {
				type: 'project.create',
				projectId: 'sidebar-project',
				viewId,
				root: '/workspace/sidebar-project',
				name: 'Sidebar project',
			},
		});
		authority.resetWorkspaceCommandTestRecords();

		authority.acceptRendererPort(renderer.port, { ownerId: 901 });
		const client = new TerminayClient({
			clientId: 'workspace-command-observer-renderer',
			clientVersion: 'test',
			capabilities: ['workspace'],
			transport: new ServerPortTransport(
				new ServerScopedMessagePort(
					channel.port2,
					'workspace-command-observer',
				),
			),
		});
		await client.connect();
		const workspace = new WorkspaceClient(client);
		await workspace.updateProjectSidebar({
			projectId: 'sidebar-project',
			sidebar: { sidebarExplorerHeight: 432, sidebarGitHeight: 198 },
		});

		const records = authority.getWorkspaceCommandTestRecords();
		assert.deepEqual(records, [
			{
				operation: 'workspace.command',
				command: {
					type: 'project.sidebar.update',
					projectId: 'sidebar-project',
					sidebar: { sidebarExplorerHeight: 432, sidebarGitHeight: 198 },
				},
			},
		]);
		records[0].command.sidebar.sidebarExplorerHeight = 1;
		assert.equal(
			authority.getWorkspaceCommandTestRecords()[0].command.sidebar
				.sidebarExplorerHeight,
			432,
		);
		authority.resetWorkspaceCommandTestRecords();
		assert.deepEqual(authority.getWorkspaceCommandTestRecords(), []);
		await client.close();
	} finally {
		await authority.shutdown();
		if (previousTestMode === undefined) delete process.env.TERMINAY_TEST;
		else process.env.TERMINAY_TEST = previousTestMode;
	}
});

test('replacing a renderer port for the same window closes the previous connection', async () => {
	const authority = new ServerTerminalAuthority({
		serverId: 'reload-renderer-owner',
		terminalService: new TerminalService({
			serverId: 'reload-renderer-owner',
			ptyFactory: createPtyFactory(),
		}),
	});
	const firstChannel = new MessageChannel();
	const secondChannel = new MessageChannel();
	const first = bindRendererChannel(firstChannel);
	const second = bindRendererChannel(secondChannel);
	try {
		authority.acceptRendererPort(first.port, { ownerId: 17 });
		const firstClient = new TerminayClient({
			clientId: 'first-renderer',
			clientVersion: 'test',
			capabilities: ['workspace'],
			transport: new ServerPortTransport(
				new ServerScopedMessagePort(
					firstChannel.port2,
					'reload-renderer-owner',
				),
			),
		});
		await firstClient.connect();

		authority.acceptRendererPort(second.port, { ownerId: 17 });
		await Promise.race([
			new Promise((resolve) => {
				const poll = () => {
					if (first.closed() >= 1) resolve(undefined);
					else setTimeout(poll, 10);
				};
				poll();
			}),
			new Promise((_, reject) => {
				setTimeout(
					() =>
						reject(
							new Error('the previous renderer connection was not closed'),
						),
					1_000,
				);
			}),
		]);
		assert.ok(first.closed() >= 1);

		const secondClient = new TerminayClient({
			clientId: 'second-renderer',
			clientVersion: 'test',
			capabilities: ['workspace'],
			transport: new ServerPortTransport(
				new ServerScopedMessagePort(
					secondChannel.port2,
					'reload-renderer-owner',
				),
			),
		});
		await secondClient.connect();
		const workspace = new WorkspaceClient(secondClient);
		const snapshot = await workspace.snapshot();
		assert.equal(typeof snapshot.revision, 'number');

		await secondClient.close().catch(() => undefined);
		await firstClient.close().catch(() => undefined);
	} finally {
		firstChannel.port1.close();
		firstChannel.port2.close();
		secondChannel.port1.close();
		secondChannel.port2.close();
		await authority.shutdown();
	}
});

test('Local reopening drops every stale terminal tab and seeds one fresh terminal in every restored project', async () => {
	const pty = createPtyFactory();
	const workspace = new WorkspaceStore(
		createInitialWorkspace('desktop-local-reopen'),
	);
	const viewId = workspace.state.viewOrder[0];
	if (viewId === undefined)
		throw new Error('Expected the initial Local workspace view.');
	const apply = (commandId, command) => {
		const result = workspace.apply({ commandId, command });
		assert.equal(
			result.ok,
			true,
			result.ok ? undefined : result.conflict.message,
		);
	};
	apply('seed-default-project', {
		type: 'project.create',
		projectId: 'default',
		viewId,
		root: tmpdir(),
		name: 'Project',
	});
	apply('seed-default-terminal', {
		type: 'terminal.createPanel',
		projectId: 'default',
		sessionId: 'stale-default',
		panelId: 'stale-default-panel',
		title: 'Terminal 1',
		cwd: tmpdir(),
		createdAt: 1,
	});
	apply('seed-default-file', {
		type: 'panel.create',
		panel: {
			id: 'default-file',
			projectId: 'default',
			type: 'file',
			path: 'README.md',
			createdAt: 1,
		},
	});
	apply('seed-idle-project', {
		type: 'project.create',
		projectId: 'idle-project',
		viewId,
		root: tmpdir(),
		name: 'Idle',
	});
	apply('seed-idle-terminal-1', {
		type: 'terminal.createPanel',
		projectId: 'idle-project',
		sessionId: 'stale-idle-1',
		panelId: 'stale-idle-panel-1',
		title: 'Terminal 1',
		cwd: tmpdir(),
		createdAt: 2,
	});
	apply('seed-idle-terminal-2', {
		type: 'terminal.createPanel',
		projectId: 'idle-project',
		sessionId: 'stale-idle-2',
		panelId: 'stale-idle-panel-2',
		title: 'Terminal 2',
		cwd: tmpdir(),
		createdAt: 3,
	});
	apply('seed-active-project', {
		type: 'project.create',
		projectId: 'active-project',
		viewId,
		root: tmpdir(),
		name: 'Active',
	});
	apply('seed-active-terminal', {
		type: 'terminal.createPanel',
		projectId: 'active-project',
		sessionId: 'stale-active',
		panelId: 'stale-active-panel',
		title: 'Terminal 1',
		cwd: tmpdir(),
		createdAt: 4,
	});
	// A process can fail between creating a persisted session and its panel.
	// Restart recovery must not retain that unpresented Local session either.
	apply('seed-orphaned-terminal', {
		type: 'terminal.create',
		projectId: 'active-project',
		sessionId: 'stale-orphan',
		createdAt: 5,
	});
	apply('restore-active-project', {
		type: 'project.activate',
		projectId: 'active-project',
	});

	let nextSession = 0;
	const authority = new ServerTerminalAuthority({
		serverId: 'desktop-local-reopen',
		terminalService: new TerminalService({
			serverId: 'desktop-local-reopen',
			ptyFactory: pty,
			generateSessionId: () => `fresh-after-reopen-${++nextSession}`,
		}),
		shellProfiles: systemShellProfiles('/bin/sh'),
		// The production host supplies this already-open durable repository. The
		// recovery branch relies only on its loaded state and creation marker.
		workspaceRepository: { wasCreated: false, workspace },
	});

	const terminalPanelsFor = (projectId) =>
		Object.values(workspace.state.panels).filter(
			(panel) => panel.projectId === projectId && panel.type === 'terminal',
		);

	try {
		await authority.initializeWorkspace();
		const terminalPanels = Object.values(workspace.state.panels).filter(
			(panel) => panel.type === 'terminal',
		);
		const sessions = Object.values(workspace.state.terminalSessions);
		const projectIds = ['active-project', 'default', 'idle-project'];
		assert.equal(
			pty.processes.length,
			3,
			'Local reopening must spawn one replacement PTY per restored project',
		);
		assert.equal(terminalPanels.length, 3);
		assert.equal(sessions.length, 3);
		assert.deepEqual(
			sessions.map((session) => session.projectId).toSorted(),
			projectIds.toSorted(),
		);
		for (const projectId of projectIds) {
			const panels = terminalPanelsFor(projectId);
			assert.equal(
				panels.length,
				1,
				`${projectId} must have exactly one fresh terminal after Local reopen`,
			);
			assert.match(panels[0]?.sessionId ?? '', /^fresh-after-reopen-\d+$/u);
		}
		assert.equal(workspace.state.panels['default-file']?.type, 'file');
		assert.deepEqual(
			workspace.state.projects.default?.panelIds.toSorted(),
			[terminalPanelsFor('default')[0]?.id, 'default-file'].toSorted(),
		);
		assert.equal(workspace.state.terminalSessions['stale-orphan'], undefined);
		assert.equal(workspace.state.terminalSessions['stale-default'], undefined);
		assert.equal(workspace.state.terminalSessions['stale-idle-1'], undefined);
		assert.equal(workspace.state.terminalSessions['stale-idle-2'], undefined);
		assert.equal(
			terminalPanelsFor('active-project')[0]?.sessionId,
			'fresh-after-reopen-1',
			'the restored active project is seeded first so its tab is ready immediately',
		);

		await authority.initializeWorkspace();
		assert.equal(
			pty.processes.length,
			3,
			'recovery is idempotent once each project has a fresh PTY',
		);
		assert.equal(Object.keys(workspace.state.terminalSessions).length, 3);
	} finally {
		await authority.shutdown();
	}
});

test('Local reopening preserves a missing persisted root without aborting the rest of workspace startup', async () => {
	const pty = createPtyFactory();
	const workspace = new WorkspaceStore(
		createInitialWorkspace('desktop-local-missing-root'),
	);
	const viewId = workspace.state.viewOrder[0];
	if (viewId === undefined)
		throw new Error('Expected the initial Local workspace view.');
	const apply = (commandId, command) => {
		const result = workspace.apply({ commandId, command });
		assert.equal(
			result.ok,
			true,
			result.ok ? undefined : result.conflict.message,
		);
	};
	apply('seed-available-project', {
		type: 'project.create',
		projectId: 'available',
		viewId,
		root: tmpdir(),
		name: 'Available',
	});
	apply('seed-available-terminal', {
		type: 'terminal.createPanel',
		projectId: 'available',
		sessionId: 'stale-available',
		panelId: 'stale-available-panel',
		title: 'Terminal 1',
		cwd: tmpdir(),
		createdAt: 1,
	});
	apply('seed-missing-project', {
		type: 'project.create',
		projectId: 'missing',
		viewId,
		root: join(tmpdir(), 'terminay-root-that-does-not-exist'),
		name: 'Missing',
	});
	apply('seed-missing-terminal', {
		type: 'terminal.createPanel',
		projectId: 'missing',
		sessionId: 'stale-missing',
		panelId: 'stale-missing-panel',
		title: 'Terminal 1',
		cwd: join(tmpdir(), 'terminay-root-that-does-not-exist'),
		createdAt: 2,
	});

	const authority = new ServerTerminalAuthority({
		serverId: 'desktop-local-missing-root',
		terminalService: new TerminalService({
			serverId: 'desktop-local-missing-root',
			ptyFactory: pty,
		}),
		shellProfiles: systemShellProfiles('/bin/sh'),
		workspaceRepository: { wasCreated: false, workspace },
	});
	try {
		await authority.initializeWorkspace();
		assert.equal(pty.processes.length, 1);
		assert.equal(pty.processes[0]?.options.projectId, 'available');
		assert.ok(workspace.state.projects.missing);
		assert.equal(workspace.state.projects.missing.panelIds.length, 0);
		assert.equal(workspace.state.projects.available.panelIds.length, 1);
	} finally {
		await authority.shutdown();
	}
});

test('Local reopening seeds a remote project even when its root is not on this host', async () => {
	const pty = createPtyFactory();
	const workspace = new WorkspaceStore(
		createInitialWorkspace('desktop-remote-reopen'),
	);
	const viewId = workspace.state.viewOrder[0];
	if (viewId === undefined)
		throw new Error('Expected the initial Local workspace view.');
	const apply = (commandId, command) => {
		const result = workspace.apply({ commandId, command });
		assert.equal(
			result.ok,
			true,
			result.ok ? undefined : result.conflict.message,
		);
	};
	apply('seed-remote-project', {
		type: 'project.create',
		projectId: 'remote-project',
		viewId,
		root: '/home/vms-not-on-this-host',
		name: 'Remote',
		projectEnvironmentId: 'ssh-env',
		environmentRevision: 4,
	});
	apply('seed-remote-terminal', {
		type: 'terminal.createPanel',
		projectId: 'remote-project',
		sessionId: 'stale-remote',
		panelId: 'stale-remote-panel',
		title: 'Terminal 1',
		cwd: '/home/vms-not-on-this-host',
		createdAt: 1,
	});

	const authority = new ServerTerminalAuthority({
		serverId: 'desktop-remote-reopen',
		terminalService: new TerminalService({
			serverId: 'desktop-remote-reopen',
			ptyFactory: pty,
			generateSessionId: () => 'fresh-remote',
		}),
		workspaceRepository: { wasCreated: false, workspace },
	});
	try {
		await authority.initializeWorkspace();
		const deadline = Date.now() + 2_000;
		while (
			(pty.processes.length === 0 ||
				(workspace.state.projects['remote-project']?.panelIds.length ?? 0) ===
					0) &&
			Date.now() < deadline
		) {
			await new Promise((resolve) => setImmediate(resolve));
		}
		assert.equal(pty.processes.length, 1);
		assert.equal(
			workspace.state.projects['remote-project']?.panelIds.length,
			1,
		);
		assert.equal(workspace.state.terminalSessions['stale-remote'], undefined);
		assert.equal(
			Object.values(workspace.state.terminalSessions).some(
				(session) => session.projectId === 'remote-project',
			),
			true,
		);
	} finally {
		await authority.shutdown();
	}
});

test('Desktop production authority projects a real PTY foreground process onto its exact activity session', async () => {
	const authority = new ServerTerminalAuthority({
		serverId: 'desktop-real-foreground',
		shellProfiles: systemShellProfiles('/bin/sh'),
	});
	await authority.initializeWorkspace();
	const session = await authority.service.createSession({
		projectId: 'default',
		sessionId: 'real-foreground-session',
		shellPath: '/bin/sh',
		cwd: process.cwd(),
		cols: 80,
		rows: 24,
	});
	try {
		await authority.service.input(session.identity, 'sleep 10\r', {
			...session.identity,
			clientId: 'foreground-test',
			scope: 'write',
		});
		const deadline = Date.now() + 5_000;
		let snapshot;
		while (Date.now() < deadline) {
			snapshot = authority.activity.get(session.identity);
			if (snapshot?.foregroundBusy === true) break;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		assert.equal(snapshot?.sessionId, session.identity.sessionId);
		assert.equal(snapshot?.projectId, session.identity.projectId);
		assert.equal(snapshot?.foregroundBusy, true);
		assert.equal(snapshot?.source, 'structured:foreground');
	} finally {
		await authority.service
			.kill(session.identity, undefined, 'SIGKILL')
			.catch(() => undefined);
		await authority.shutdown();
	}
});

test('Desktop authority resolves every compatibility-created PTY through the canonical profile and cwd boundary', async () => {
	const pty = createPtyFactory();
	process.env.PROFILE_LAYER_TEST = 'host';
	const authority = new ServerTerminalAuthority({
		serverId: 'desktop-launch',
		terminalService: new TerminalService({
			serverId: 'desktop-launch',
			ptyFactory: pty,
		}),
		shellProfiles: systemShellProfiles('/bin/zsh', {
			PROFILE_LAYER_TEST: 'profile',
		}),
	});
	try {
		const cwd = process.cwd();
		const first = await authority.create({
			projectId: 'project-a',
			cwd,
			cols: 80,
			rows: 24,
		});
		const second = await authority.create({
			projectId: 'project-a',
			cwd,
			cols: 100,
			rows: 30,
		});
		assert.equal(first.cwd, cwd);
		assert.equal(second.cwd, cwd);
		assert.deepEqual(
			pty.processes.map((process) => ({
				shellPath: process.options.shellPath,
				args: process.options.args,
				cwd: process.options.cwd,
			})),
			[
				{ shellPath: '/bin/zsh', args: ['-l'], cwd },
				{ shellPath: '/bin/zsh', args: ['-l'], cwd },
			],
		);
		assert.equal(pty.processes[0].options.env.PROFILE_LAYER_TEST, 'profile');
	} finally {
		delete process.env.PROFILE_LAYER_TEST;
		await authority.shutdown();
	}
});

function writeAuthorization() {
	return {
		serverId: 'authority-server',
		projectId: 'authority-project',
		sessionId: 'authority-session',
		scope: 'write',
	};
}

test('trusted Desktop writes produce canonical OSC completion activity through the PTY boundary', async () => {
	const pty = createPtyFactory();
	const authority = new ServerTerminalAuthority({
		serverId: 'trusted-activity',
		terminalService: new TerminalService({
			serverId: 'trusted-activity',
			ptyFactory: pty,
			generateSessionId: () => 'activity-session',
		}),
	});
	try {
		const session = await authority.create({
			projectId: 'project-a',
			cwd: process.cwd(),
			cols: 80,
			rows: 24,
		});
		const identity = {
			serverId: session.serverId,
			projectId: session.projectId,
			sessionId: session.id,
		};
		pty.processes[0].write = function (bytes) {
			this.writes.push(new Uint8Array(bytes));
			const command = new TextDecoder().decode(bytes);
			const marker = command.match(/(?:9;4;[03];|133;[CD](?:;0)?)/)?.[0];
			// A real PTY delivers output after accepting input. Preserve that
			// ordering so accepted user input cannot overwrite a completion marker
			// emitted synchronously by the test double.
			if (marker !== undefined)
				setImmediate(() => this.emitData(`\u001b]${marker}\u0007`));
		};

		await authority.write(session.id, "printf '\\033]9;4;3;\\007'\r");
		await new Promise(setImmediate);
		assert.equal(authority.activity.get(identity)?.status, 'working');
		await authority.write(session.id, "printf '\\033]9;4;0;\\007'\r");
		await new Promise(setImmediate);
		assert.equal(authority.activity.get(identity)?.status, 'idle');
		assert.equal(authority.activity.get(identity)?.acknowledged, true);
		await new Promise((resolve) => setTimeout(resolve, 2_100));
		assert.equal(authority.activity.get(identity)?.acknowledged, false);
		assert.equal(
			authority.activity.get(identity)?.source,
			'structured:input-quiet',
		);

		await authority.write(session.id, "printf '\\033]133;C\\007'\r");
		await new Promise(setImmediate);
		assert.equal(authority.activity.get(identity)?.status, 'working');
		await authority.write(session.id, "printf '\\033]133;D;0\\007'\r");
		await new Promise(setImmediate);
		assert.equal(authority.activity.get(identity)?.status, 'idle');
		assert.equal(authority.activity.get(identity)?.acknowledged, false);
		assert.equal(
			authority.activity.get(identity)?.source,
			'structured:command',
		);
	} finally {
		await authority.shutdown();
	}
});

test('embedded framed clients receive canonical agent and folder projections', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-embedded-projections-'));
	const initialRoot = join(root, 'initial');
	const updatedRoot = join(root, 'updated');
	await mkdir(initialRoot);
	await mkdir(join(updatedRoot, 'work', 'nested'), { recursive: true });
	await writeFile(
		join(updatedRoot, 'work', 'plan.md'),
		'# Plan\n- [ ] Root task\n',
	);
	await writeFile(
		join(updatedRoot, 'work', 'nested', 'roadmap.md'),
		'# Roadmap\n- [x] Nested task\n',
	);
	const pty = createPtyFactory();
	let nextSession = 0;
	const authority = new ServerTerminalAuthority({
		serverId: 'embedded-projections',
		terminalService: new TerminalService({
			serverId: 'embedded-projections',
			ptyFactory: pty,
			generateSessionId: () => `session-${++nextSession}`,
		}),
	});
	const channel = new MessageChannel();
	let serverMessage;
	let serverMessageError;
	channel.port1.on('message', (data) => serverMessage?.({ data }));
	channel.port1.on('messageerror', () => serverMessageError?.());
	authority.acceptRendererPort({
		get onmessage() {
			return serverMessage;
		},
		set onmessage(listener) {
			serverMessage = listener;
		},
		get onmessageerror() {
			return serverMessageError;
		},
		set onmessageerror(listener) {
			serverMessageError = listener;
		},
		postMessage: (data) => channel.port1.postMessage(data),
		start: () => channel.port1.start(),
		close: () => channel.port1.close(),
	});
	const protocol = new TerminayClient({
		clientId: 'embedded-renderer',
		clientVersion: 'test',
		capabilities: ['terminal', 'files', 'agents'],
		transport: new ServerPortTransport(
			new ServerScopedMessagePort(channel.port2, 'embedded-projections'),
		),
	});

	try {
		// Host registration mirrors Desktop's initial project/session adoption.
		const hostCreated = await authority.create({
			projectId: 'desktop',
			cwd: initialRoot,
			cols: 80,
			rows: 24,
		});
		await protocol.connect();
		const facade = new TerminayClientFacade(protocol);
		const workspace = new WorkspaceClient(protocol);
		const terminals = new TerminayTerminalClient(protocol);
		const files = new FileViewerClient(facade);
		const hostWorkspace = await workspace.snapshot();
		assert.equal(
			hostWorkspace.terminalSessions[hostCreated.id]?.projectId,
			'desktop',
		);
		const hostPanel = Object.values(hostWorkspace.panels).find(
			(panel) => panel.sessionId === hostCreated.id,
		);
		assert.equal(hostPanel?.type, 'terminal');
		assert.equal(hostPanel?.title, 'Terminal 1');
		const created = await terminals.create({ projectId: 'desktop' });
		const identity = {
			serverId: 'embedded-projections',
			projectId: 'desktop',
			sessionId: created.sessionId,
		};
		// Production composition registers this identity before spawning the PTY.
		// The injected TerminalService fixture deliberately has no lifecycle observer.
		authority.activity.register(identity);
		authority.agents.register(identity);
		await authority.agents.ingestJournalRecord(identity, 'codex', {
			type: 'session_meta',
			payload: { id: 'codex-embedded-projection', model: 'gpt-test-codex' },
		});
		const subscription = await protocol.subscribe('agent');
		const eventPromise = new Promise((resolve) => {
			const remove = subscription.onEvent((event) => {
				remove();
				resolve(event.payload);
			});
		});

		await authority.agents.ingestJournalRecord(identity, 'codex', {
			type: 'event_msg',
			payload: {
				type: 'user_message',
				message: 'Project canonical status',
				model: 'gpt-test-codex',
			},
		});

		const event = await eventPromise;
		assert.equal(
			Object.values(event.entries)[0].activationTerminalSessionId,
			created.sessionId,
		);
		const snapshot = await protocol.query('agent.snapshot', {});
		assert.equal(
			Object.values(snapshot.result.entries)[0].activationTerminalSessionId,
			created.sessionId,
		);
		assert.equal(Object.values(snapshot.result.entries)[0].state, 'working');

		const rootUpdate = await workspace.updateProjectRoot(
			{
				projectId: 'desktop',
				root: updatedRoot,
				expectedRevision: authority.workspace.state.revision,
			},
			{ commandId: 'embedded-root-update' },
		);
		assert.equal(rootUpdate.root.endsWith('/updated'), true);
		assert.equal(
			authority.workspace.state.projects.desktop.root,
			rootUpdate.root,
		);
		const folder = await files.listFolder('work', 'desktop');
		assert.deepEqual(
			folder.entries.map((entry) => entry.name),
			['nested', 'plan.md'],
		);
		const tasks = await files.getFolderMarkdownTasks('work', 'desktop');
		assert.equal(tasks.stats.total, 2);
		assert.equal(tasks.stats.completed, 1);
		assert.deepEqual(
			tasks.files.map((file) => file.relativePath),
			['work/plan.md', 'work/nested/roadmap.md'],
		);

		await subscription.unsubscribe();
	} finally {
		await protocol.close().catch(() => undefined);
		channel.port1.close();
		channel.port2.close();
		await authority.shutdown();
		await rm(root, { recursive: true, force: true });
	}
});

test('a newly created This-server project can list its Explorer root immediately', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-new-project-explorer-'));
	await writeFile(join(root, 'README.md'), '# Explorer root\n');
	const authority = new ServerTerminalAuthority({
		serverId: 'new-project-explorer',
		terminalService: new TerminalService({
			serverId: 'new-project-explorer',
			ptyFactory: createPtyFactory(),
		}),
	});
	const channel = new MessageChannel();
	let serverMessage;
	let serverMessageError;
	channel.port1.on('message', (data) => serverMessage?.({ data }));
	channel.port1.on('messageerror', () => serverMessageError?.());
	authority.acceptRendererPort({
		get onmessage() {
			return serverMessage;
		},
		set onmessage(listener) {
			serverMessage = listener;
		},
		get onmessageerror() {
			return serverMessageError;
		},
		set onmessageerror(listener) {
			serverMessageError = listener;
		},
		postMessage: (data) => channel.port1.postMessage(data),
		start: () => channel.port1.start(),
		close: () => channel.port1.close(),
	});
	const protocol = new TerminayClient({
		clientId: 'embedded-renderer-new-project',
		clientVersion: 'test',
		capabilities: ['terminal', 'files', 'workspace'],
		transport: new ServerPortTransport(
			new ServerScopedMessagePort(channel.port2, 'new-project-explorer'),
		),
	});

	try {
		await authority.initializeWorkspace();
		await protocol.connect();
		const facade = new TerminayClientFacade(protocol);
		const workspace = new WorkspaceClient(protocol);
		const environments = new ProjectEnvironmentsClient(facade);
		const files = new FileViewerClient(facade);
		const viewId = (await workspace.snapshot()).viewOrder[0];
		assert.ok(viewId, 'Local workspace must expose an initial view');

		const created = await environments.createProject({
			environmentId: 'terminay:this-server',
			viewId,
			root,
		});
		assert.equal(created.state, 'succeeded');
		assert.ok(
			created.projectId,
			'project creation must return the canonical project id',
		);

		const listing = await files.listFolder('.', created.projectId);
		assert.deepEqual(
			listing.entries.map((entry) => entry.name),
			['README.md'],
		);
	} finally {
		await protocol.close().catch(() => undefined);
		channel.port1.close();
		channel.port2.close();
		await authority.shutdown();
		await rm(root, { recursive: true, force: true });
	}
});

test('a stale Explorer root after a server root update reproduces the forbidden files.list failure', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-stale-explorer-root-'));
	const formerRoot = join(root, 'former');
	const currentRoot = join(root, 'current');
	await mkdir(formerRoot);
	await mkdir(currentRoot);
	const authority = new ServerTerminalAuthority({
		serverId: 'stale-explorer-root',
		terminalService: new TerminalService({
			serverId: 'stale-explorer-root',
			ptyFactory: createPtyFactory(),
		}),
	});
	const channel = new MessageChannel();
	let serverMessage;
	let serverMessageError;
	channel.port1.on('message', (data) => serverMessage?.({ data }));
	channel.port1.on('messageerror', () => serverMessageError?.());
	authority.acceptRendererPort({
		get onmessage() {
			return serverMessage;
		},
		set onmessage(listener) {
			serverMessage = listener;
		},
		get onmessageerror() {
			return serverMessageError;
		},
		set onmessageerror(listener) {
			serverMessageError = listener;
		},
		postMessage: (data) => channel.port1.postMessage(data),
		start: () => channel.port1.start(),
		close: () => channel.port1.close(),
	});
	const protocol = new TerminayClient({
		clientId: 'embedded-renderer-stale-root',
		clientVersion: 'test',
		capabilities: ['terminal', 'files', 'workspace'],
		transport: new ServerPortTransport(
			new ServerScopedMessagePort(channel.port2, 'stale-explorer-root'),
		),
	});

	try {
		await authority.initializeWorkspace();
		await protocol.connect();
		const facade = new TerminayClientFacade(protocol);
		const workspace = new WorkspaceClient(protocol);
		const environments = new ProjectEnvironmentsClient(facade);
		const files = new FileViewerClient(facade);
		const viewId = (await workspace.snapshot()).viewOrder[0];
		assert.ok(viewId);
		const created = await environments.createProject({
			environmentId: 'terminay:this-server',
			viewId,
			root: formerRoot,
		});
		assert.equal(created.state, 'succeeded');
		assert.ok(created.projectId);
		await workspace.updateProjectRoot({
			projectId: created.projectId,
			root: currentRoot,
		});

		const stalePath = getPathRelativeToRoot(formerRoot, currentRoot);
		assert.equal(stalePath, '../former');
		await assert.rejects(
			files.listFolder(stalePath, created.projectId),
			(error) =>
				error?.operation === 'files.list' && error?.cause?.code === 'forbidden',
		);
	} finally {
		await protocol.close().catch(() => undefined);
		channel.port1.close();
		channel.port2.close();
		await authority.shutdown();
		await rm(root, { recursive: true, force: true });
	}
});

test('ServerTerminalAuthority reports only accepted writes and resizes to host bookkeeping', async () => {
	const pty = createPtyFactory();
	const service = new TerminalService({
		serverId: 'authority-server',
		ptyFactory: pty,
		generateSessionId: () => 'authority-session',
	});
	const writes = [];
	const resizes = [];
	let process;
	const authority = new ServerTerminalAuthority({
		serverId: 'authority-server',
		terminalService: service,
		onAcceptedWrite(event) {
			assert.equal(
				process.writes.length,
				1,
				'host observer runs after the PTY accepted the write',
			);
			writes.push(event);
			return Promise.reject(new Error('recording observer failed'));
		},
		onAcceptedResize(event) {
			assert.equal(
				process.resizes.length,
				1,
				'host observer runs after the PTY accepted the resize',
			);
			resizes.push(event);
			return Promise.reject(new Error('remote observer failed'));
		},
	});

	try {
		const session = await authority.create({
			projectId: 'authority-project',
			sessionId: 'authority-session',
			cwd: '/tmp',
			shellPath: '/bin/zsh',
			cols: 80,
			rows: 24,
		});
		assert.equal(
			session.shellPath,
			'/bin/zsh',
			'authority snapshots retain the immutable launch shell',
		);
		process = pty.processes[0];
		const input = new Uint8Array([0, 255]);

		await authority.write('authority-session', input, writeAuthorization());
		input[0] = 9;
		await authority.resize(
			'authority-session',
			{ cols: 120, rows: 40 },
			writeAuthorization(),
		);

		assert.deepEqual(process.writes, [new Uint8Array([0, 255])]);
		assert.deepEqual(process.resizes, [{ cols: 120, rows: 40 }]);
		assert.deepEqual(writes, [
			{
				serverId: 'authority-server',
				projectId: 'authority-project',
				sessionId: 'authority-session',
				data: new Uint8Array([0, 255]),
			},
		]);
		assert.deepEqual(resizes, [
			{
				serverId: 'authority-server',
				projectId: 'authority-project',
				sessionId: 'authority-session',
				cols: 120,
				rows: 40,
			},
		]);

		await assert.rejects(
			authority.write('authority-session', 'forbidden', {
				...writeAuthorization(),
				projectId: 'other-project',
			}),
			(error) =>
				error instanceof TerminalServiceError && error.code === 'forbidden',
		);
		await assert.rejects(
			authority.resize(
				'authority-session',
				{ cols: 0, rows: 40 },
				writeAuthorization(),
			),
			(error) =>
				error instanceof TerminalServiceError &&
				error.code === 'invalid_dimensions',
		);
		assert.equal(writes.length, 1);
		assert.equal(resizes.length, 1);
	} finally {
		await authority.shutdown();
	}
});

test('ServerTerminalAuthority tracks renderer attachment per immutable session', async () => {
	const service = new TerminalService({
		serverId: 'authority-server',
		ptyFactory: createPtyFactory(),
		generateSessionId: () => 'attachment-session',
	});
	const authority = new ServerTerminalAuthority({
		serverId: 'authority-server',
		terminalService: service,
	});

	try {
		await authority.create({
			projectId: 'authority-project',
			sessionId: 'attachment-session',
			shellPath: '/bin/zsh',
			cwd: tmpdir(),
			cols: 80,
			rows: 24,
		});

		assert.equal(authority.isRendererAttached('attachment-session', 41), false);
		const detach = authority.attachRenderer('attachment-session', 41, () => {});
		assert.equal(authority.isRendererAttached('attachment-session', 41), true);
		assert.equal(authority.isRendererAttached('attachment-session', 42), false);
		detach();
		assert.equal(authority.isRendererAttached('attachment-session', 41), false);
	} finally {
		await authority.shutdown();
	}
});

test('ServerTerminalAuthority detaches every destroyed renderer consumer without killing the server PTY', async () => {
	const pty = createPtyFactory();
	const service = new TerminalService({
		serverId: 'authority-server',
		ptyFactory: pty,
		generateSessionId: () => 'detach-session',
	});
	const authority = new ServerTerminalAuthority({
		serverId: 'authority-server',
		terminalService: service,
	});

	try {
		await authority.create({
			projectId: 'authority-project',
			sessionId: 'detach-session',
			shellPath: '/bin/zsh',
			cwd: tmpdir(),
			cols: 80,
			rows: 24,
		});

		const destroyedRendererEvents = [];
		const survivingRendererEvents = [];
		authority.attachRenderer('detach-session', 41, (event) =>
			destroyedRendererEvents.push(event),
		);
		authority.attachRenderer('detach-session', 42, (event) =>
			survivingRendererEvents.push(event),
		);

		// This is the exact operation invoked by the global webContents
		// `destroyed` handler. It is consumer cleanup only: never a PTY kill.
		authority.detachRendererAll(41);

		assert.equal(authority.isRendererAttached('detach-session', 41), false);
		assert.equal(authority.isRendererAttached('detach-session', 42), true);
		assert.equal(pty.processes[0].kills, 0);

		pty.processes[0].emitData('still alive');
		assert.equal(pty.processes[0].kills, 0);
		assert.deepEqual(destroyedRendererEvents, []);
		assert.equal(survivingRendererEvents.length, 1);
		assert.equal(survivingRendererEvents[0].type, 'output');
	} finally {
		await authority.shutdown();
	}
});

test('ServerTerminalAuthority coalesces concurrent shutdown calls', async () => {
	const pty = createPtyFactory();
	const service = new TerminalService({
		serverId: 'authority-server',
		ptyFactory: pty,
		generateSessionId: () => 'shutdown-session',
	});
	const authority = new ServerTerminalAuthority({
		serverId: 'authority-server',
		terminalService: service,
	});

	await authority.create({
		projectId: 'authority-project',
		sessionId: 'shutdown-session',
		shellPath: '/bin/zsh',
		cwd: tmpdir(),
		cols: 80,
		rows: 24,
	});

	await Promise.all([authority.shutdown(), authority.shutdown()]);
	assert.equal(pty.processes[0].kills ?? 0, 1);
});

test('ServerTerminalAuthority attachment checks reject a different renderer at runtime', async () => {
	const service = new TerminalService({
		serverId: 'authority-server',
		ptyFactory: createPtyFactory(),
		generateSessionId: () => 'attachment-runtime-session',
	});
	const authority = new ServerTerminalAuthority({
		serverId: 'authority-server',
		terminalService: service,
	});

	try {
		await authority.create({
			projectId: 'authority-project',
			sessionId: 'attachment-runtime-session',
			shellPath: '/bin/zsh',
			cwd: tmpdir(),
			cols: 80,
			rows: 24,
		});

		authority.attachRenderer('attachment-runtime-session', 41, () => {});
		assert.equal(
			authority.isRendererAttached('attachment-runtime-session', 41),
			true,
		);
		assert.equal(
			authority.isRendererAttached('attachment-runtime-session', 42),
			false,
		);
	} finally {
		await authority.shutdown();
	}
});

test('ServerTerminalAuthority hands a renderer stream to one destination without retaining the source', async () => {
	const pty = createPtyFactory();
	const service = new TerminalService({
		serverId: 'authority-server',
		ptyFactory: pty,
		generateSessionId: () => 'handoff-session',
	});
	const authority = new ServerTerminalAuthority({
		serverId: 'authority-server',
		terminalService: service,
	});
	const sourceEvents = [];
	const destinationEvents = [];

	try {
		await authority.create({
			projectId: 'authority-project',
			sessionId: 'handoff-session',
			shellPath: '/bin/zsh',
			cwd: tmpdir(),
			cols: 80,
			rows: 24,
		});
		authority.attachRenderer('handoff-session', 41, (event) =>
			sourceEvents.push(event),
		);
		pty.processes[0].emitData('before');

		authority.handoffRenderer('handoff-session', 41, 42, (event) =>
			destinationEvents.push(event),
		);
		pty.processes[0].emitData('after');

		assert.equal(authority.isRendererAttached('handoff-session', 41), false);
		assert.equal(authority.isRendererAttached('handoff-session', 42), true);
		assert.deepEqual(
			sourceEvents
				.filter((event) => event.type === 'output')
				.map((event) => event.data),
			['before'],
		);
		assert.deepEqual(
			destinationEvents
				.filter((event) => event.type === 'output')
				.map((event) => event.data),
			['before', 'after'],
		);
		assert.throws(
			() => authority.handoffRenderer('handoff-session', 41, 43, () => {}),
			/source renderer is not attached/u,
		);
	} finally {
		await authority.shutdown();
	}
});

async function importAuthority() {
	const cacheRoot = join(process.cwd(), 'node_modules', '.cache');
	await mkdir(cacheRoot, { recursive: true });
	const directory = await mkdtemp(
		join(cacheRoot, 'terminay-server-terminal-authority-'),
	);
	const outputPath = join(directory, 'authority.mjs');
	try {
		await build({
			absWorkingDir: process.cwd(),
			bundle: true,
			// Keep package dependencies external: several are CommonJS and must be
			// loaded through Node's ESM-to-CommonJS bridge rather than esbuild's
			// generated dynamic-require shim. Local TypeScript stays bundled.
			format: 'esm',
			packages: 'external',
			outfile: outputPath,
			platform: 'node',
			stdin: {
				contents: [
					`export { ServerTerminalAuthority } from ${JSON.stringify(new URL('../electron/serverTerminalAuthority.ts', import.meta.url).pathname)}`,
					`export { TerminalService } from ${JSON.stringify(new URL('../packages/server-core/src/terminalService/service.ts', import.meta.url).pathname)}`,
					`export { TerminalServiceError } from ${JSON.stringify(new URL('../packages/server-core/src/terminalService/errors.ts', import.meta.url).pathname)}`,
					`export { WorkspaceStore, createInitialWorkspace } from ${JSON.stringify(new URL('../packages/server-core/src/workspace.ts', import.meta.url).pathname)}`,
					`export { ServerPortTransport, ServerScopedMessagePort } from ${JSON.stringify(new URL('../src/shared/serverPortTransport.ts', import.meta.url).pathname)}`,
					`export { getPathRelativeToRoot } from ${JSON.stringify(new URL('../src/pathUtils.ts', import.meta.url).pathname)}`,
				].join('\n'),
				loader: 'ts',
				resolveDir: process.cwd(),
			},
			target: 'node24',
		});
		return await import(outputPath);
	} finally {
		// The module remains loaded after import; the generated file is no longer
		// needed and must not become a worktree artifact.
		await rm(directory, { recursive: true, force: true });
	}
}
