import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	AUTOMATION_SPACE_PROJECT_ID,
	McpApprovalService,
} from '@terminay/server-core';
// Imported from the built package in plain Node: the host must load with no
// Electron present, or the standalone server could not compose it (ADR-0108).
import { createMcpHost, MCP_CAPABILITY_FILE } from '../dist/index.js';

const SERVER = 'host-test';

function settingsSource(initial) {
	const listeners = new Set();
	let current = initial;
	return {
		get current() {
			return current;
		},
		onChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		set(next) {
			current = next;
			for (const listener of listeners) listener(next);
		},
	};
}

function fakeServer({ keepsTerminalsAcrossRestart = false } = {}) {
	const sessions = new Map();
	const listeners = new Set();
	let windowsEnded = 0;
	const approvals = new McpApprovalService();
	const composition = {
		terminal: {
			listSessions: () =>
				[...sessions].map(([sessionId, status]) => ({
					sessionId,
					serverId: SERVER,
					projectId: 'project-a',
					cwd: '/',
					pid: 1,
					status,
				})),
			onEvent(listener) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		mcpApprovals: approvals,
		appWindows: {
			endAll() {
				windowsEnded += 1;
			},
		},
	};
	return {
		sessions,
		approvals,
		get windowsEnded() {
			return windowsEnded;
		},
		exit(sessionId) {
			sessions.set(sessionId, 'exited');
			for (const listener of listeners) listener({ type: 'exit', sessionId });
		},
		server: {
			composition,
			workspace: { state: { projects: {} }, subscribe: () => () => undefined },
			activity: {},
			agents: {},
			keepsTerminalsAcrossRestart,
		},
	};
}

async function withHost(run, { initialSettings, dataRoot } = {}) {
	const root = dataRoot ?? (await mkdtemp(join(tmpdir(), 'tmh-')));
	const settings = settingsSource(initialSettings ?? {});
	const host = createMcpHost({
		serverId: SERVER,
		dataRoot: root,
		placement: {
			dataDirectory: root,
			platform: process.platform,
			temporaryDirectory: tmpdir(),
		},
		serverCommand: () => ({ command: process.execPath, args: ['entry.js'] }),
		clientVersion: 'test',
		homeDirectory: root,
		initialSettings: settings.current,
		onSettingsChange: (listener) => settings.onChange(listener),
		openTerminal: async () => {
			throw new Error('not used');
		},
	});
	try {
		await run({ host, settings, root });
	} finally {
		await host.stop();
		if (dataRoot === undefined)
			await rm(root, { recursive: true, force: true });
	}
}

const launch = (host, sessionId, projectId = 'project-a') =>
	host.terminalLaunchEnvironmentFor({ identity: { sessionId, projectId } }, {});

test('a launched terminal gets the socket and a capability that its exit revokes', async () => {
	await withHost(async ({ host }) => {
		const fake = fakeServer();
		fake.sessions.set('s1', 'running');
		await host.bind(fake.server);
		const env = launch(host, 's1');
		assert.ok(env.TERMINAY_CONTROL_SOCKET);
		assert.ok(env.TERMINAY_CONTROL_TOKEN);
		assert.equal(
			host.capabilities.resolve(env.TERMINAY_CONTROL_TOKEN)?.terminalSessionId,
			's1',
		);
		fake.exit('s1');
		assert.equal(host.capabilities.resolve(env.TERMINAY_CONTROL_TOKEN), null);
	});
});

test('a server started with Terminay MCP off mints nothing until it is turned on', async () => {
	await withHost(
		async ({ host, settings }) => {
			assert.equal(launch(host, 's1'), undefined);
			const fake = fakeServer();
			await host.bind(fake.server);
			assert.equal(launch(host, 's2'), undefined);
			settings.set({ terminayMcp: { enabled: true } });
			assert.ok(launch(host, 's3')?.TERMINAY_CONTROL_TOKEN);
		},
		{ initialSettings: { terminayMcp: { enabled: false } } },
	);
});

test('turning Terminay MCP off revokes capabilities, cancels pending approvals, and ends windows', async () => {
	await withHost(async ({ host, settings }) => {
		const fake = fakeServer();
		fake.sessions.set('s1', 'running');
		await host.bind(fake.server);
		const env = launch(host, 's1');
		const pending = fake.approvals.authorize({
			terminalSessionId: 's1',
			projectId: 'project-a',
			operation: 'create_automation',
			group: 'automationsManage',
			agent: 'Agent',
			terminalTitle: 'Terminal 1',
			summary: 'add an automation',
			details: [],
			signal: new AbortController().signal,
		});
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(fake.approvals.list().length, 1);
		settings.set({ terminayMcp: { enabled: false } });
		const outcome = await pending;
		assert.equal(outcome.ok, false);
		assert.equal(fake.approvals.list().length, 0);
		assert.equal(host.capabilities.resolve(env.TERMINAY_CONTROL_TOKEN), null);
		assert.equal(fake.windowsEnded, 1);
	});
});

test('a moved terminal keeps its capability in the new project, and entering the automation space revokes it', async () => {
	await withHost(async ({ host }) => {
		const fake = fakeServer();
		fake.sessions.set('s1', 'running');
		fake.sessions.set('s2', 'running');
		await host.bind(fake.server);
		const moved = launch(host, 's1');
		host.onTerminalRehomed({
			sessionId: 's1',
			sourceProjectId: 'project-a',
			targetProjectId: 'project-b',
		});
		const scope = host.capabilities.resolve(moved.TERMINAY_CONTROL_TOKEN);
		assert.equal(scope?.projectId, 'project-b');
		assert.notEqual(scope?.reach, 'workspace');

		// Entering the automation space would widen a project capability to
		// workspace reach, so the move revokes it instead.
		const widened = launch(host, 's2');
		host.onTerminalRehomed({
			sessionId: 's2',
			sourceProjectId: 'project-a',
			targetProjectId: AUTOMATION_SPACE_PROJECT_ID,
		});
		assert.equal(
			host.capabilities.resolve(widened.TERMINAY_CONTROL_TOKEN),
			null,
		);
	});
});

test('kept terminals keep their capability across a restart; ended ones and a corrupt file restore nothing', async () => {
	const root = await mkdtemp(join(tmpdir(), 'tmh-'));
	try {
		let kept;
		let ended;
		await withHost(
			async ({ host }) => {
				const fake = fakeServer({ keepsTerminalsAcrossRestart: true });
				fake.sessions.set('kept', 'running');
				fake.sessions.set('ended', 'running');
				await host.bind(fake.server);
				kept = launch(host, 'kept');
				ended = launch(host, 'ended');
				// Shutdown of a server that keeps its terminals.
				host.stopPersisting();
			},
			{ dataRoot: root },
		);
		// stop() revoked every capability in memory, but the saved copy had
		// stopped following first.
		const saved = JSON.parse(
			await readFile(join(root, MCP_CAPABILITY_FILE), 'utf8'),
		);
		assert.ok(JSON.stringify(saved).includes('kept'));

		await withHost(
			async ({ host }) => {
				const fake = fakeServer({ keepsTerminalsAcrossRestart: true });
				fake.sessions.set('kept', 'running');
				await host.bind(fake.server);
				assert.equal(
					host.capabilities.resolve(kept.TERMINAY_CONTROL_TOKEN)
						?.terminalSessionId,
					'kept',
				);
				assert.equal(
					host.capabilities.resolve(ended.TERMINAY_CONTROL_TOKEN),
					null,
				);
			},
			{ dataRoot: root },
		);

		await writeFile(join(root, MCP_CAPABILITY_FILE), '{not json');
		await withHost(
			async ({ host }) => {
				const fake = fakeServer({ keepsTerminalsAcrossRestart: true });
				fake.sessions.set('kept', 'running');
				await host.bind(fake.server);
				assert.equal(
					host.capabilities.resolve(kept.TERMINAY_CONTROL_TOKEN),
					null,
				);
			},
			{ dataRoot: root },
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('binding rejects when the control socket has nowhere to go', async () => {
	const root = await mkdtemp(join(tmpdir(), 'tmh-'));
	try {
		const long = join(root, 'd'.repeat(120), 'e'.repeat(120));
		const host = createMcpHost({
			serverId: SERVER,
			dataRoot: long,
			placement: {
				dataDirectory: long,
				platform: 'linux',
				temporaryDirectory: join(root, 't'.repeat(120)),
				runtimeDirectory: join(root, 'r'.repeat(120)),
			},
			serverCommand: () => ({ command: process.execPath, args: [] }),
			clientVersion: 'test',
			homeDirectory: root,
			initialSettings: {},
			onSettingsChange: () => () => undefined,
			openTerminal: async () => {
				throw new Error('not used');
			},
		});
		await assert.rejects(
			host.bind(fakeServer().server),
			/path too long for a local socket/,
		);
		await host.stop();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// The standalone server hands this to its bot service (ADR-0100), as Desktop
// does: an opted-in execution gets Terminay MCP, an opted-out one none, and
// none once MCP is turned off.
test('a bot execution gets Terminay MCP only when opted in and while MCP is on', async () => {
	await withHost(async ({ host, settings }) => {
		await host.bind(fakeServer().server);
		const bot = 'abcdefabcdef';
		assert.equal(
			host.botTerminayMcp.open(bot, '0123456789abcdef01234567', () => false),
			undefined,
		);
		const opened = host.botTerminayMcp.open(
			bot,
			'76543210fedcba9876543210',
			() => true,
		);
		assert.ok(opened);
		assert.equal(host.capabilities.snapshot().length, 0, 'never saved');
		settings.set({ terminayMcp: { enabled: false } });
		assert.equal(
			host.botTerminayMcp.open(bot, '0123456789abcdef01234568', () => true),
			undefined,
		);
		opened.close();
	});
});
