import assert from 'node:assert/strict';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	BotCredentialClient,
	BotEngineClient,
	BotEnvironmentClient,
	BotIoClient,
	BotsClient,
	TerminayClient,
	TerminayClientFacade,
} from '@terminay/client-core';
import { createInMemoryTransportPair } from '@terminay/protocol-conformance';
import {
	BotTokenService,
	createBotServerService,
	createServerCoreComposition,
	NotificationManager,
	TerminalActivityService,
} from '../dist/index.js';
import { BotMessagesClient } from '@terminay/client-core';
import { startBotSocketServer } from './fixtures/bot-socket-server.mjs';
import { until } from './fixtures/bot-test-runtime.mjs';

const agent = {
	id: 'fake/agent',
	displayName: 'Fake agent',
	imageInstall: { npm: ['fake-acp@1.0.0'] },
	runtimeProtocol: 'native-cli-v1',
	nativeDriver: 'claude-code-cli',
	runtimeVersion: '2.1.312',
	autonomousOnly: false,
	deviceSignIn: {
		command: { executable: 'codex', args: ['login', '--device-auth'] },
		signOutCommand: { executable: 'codex-session', args: ['forget', '--all'] },
		statusCommand: { executable: 'codex', args: ['login', 'status'] },
		label: 'Sign in with ChatGPT',
		help: 'Approve the code',
		configFiles: [
			{
				path: '.codex/config.toml',
				contents: 'cli_auth_credentials_store = "file"',
			},
		],
	},
	botConfigFiles: [
		{
			path: '.codex/config.toml',
			contents: 'cli_auth_credentials_store = "ephemeral"',
		},
	],
	credentialSecrets: [
		{
			environmentVariable: 'FAKE_KEY',
			kind: 'api-key',
			label: 'Fake key',
			help: 'Use a fake key',
		},
	],
};
function vault() {
	const values = new Map();
	return {
		values,
		status: () => ({ entries: [...values.keys()].map((id) => ({ id })) }),
		put: async ({ id, value }) => values.set(id, Buffer.from(value)),
		replace: async ({ id, value }) => values.set(id, Buffer.from(value)),
		remove: async (id) => values.delete(id),
		withSecret: async (id, fn) => {
			if (!values.has(id)) throw new Error('missing');
			const v = Buffer.from(values.get(id));
			try {
				return await fn(v);
			} finally {
				v.fill(0);
			}
		},
	};
}
async function setup(
	t,
	{ legacyPin = false, composition: compositionOptions = {}, ...options } = {},
) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'bots-composed-')));
	const original = {
		PATH: process.env.PATH,
		TERMINAY_FAKE_ENGINE_ID: process.env.TERMINAY_FAKE_ENGINE_ID,
		TERMINAY_FAKE_CONTAINER_LOG_BYTES:
			process.env.TERMINAY_FAKE_CONTAINER_LOG_BYTES,
		TERMINAY_FAKE_BUILD_FAIL: process.env.TERMINAY_FAKE_BUILD_FAIL,
		TERMINAY_FAKE_BUILD_LOG_BYTES: process.env.TERMINAY_FAKE_BUILD_LOG_BYTES,
		TERMINAY_FAKE_BOT_ROOT: process.env.TERMINAY_FAKE_BOT_ROOT,
		DOCKER_HOST: process.env.DOCKER_HOST,
		DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
		CONTAINER_HOST: process.env.CONTAINER_HOST,
		CONTAINER_CONNECTION: process.env.CONTAINER_CONNECTION,
	};
	// The fake engine stands in for the host's: a runner's own engine address
	// (CI sets a TCP DOCKER_HOST) would be refused as remote.
	for (const name of [
		'DOCKER_HOST',
		'DOCKER_CONTEXT',
		'CONTAINER_HOST',
		'CONTAINER_CONNECTION',
	])
		delete process.env[name];
	process.env.TERMINAY_FAKE_BOT_ROOT = root;
	const api = await startBotSocketServer(root);
	if (legacyPin) {
		mkdirSync(join(root, 'bots'), { recursive: true });
		writeFileSync(
			join(root, 'bots', 'engine.json'),
			JSON.stringify({
				kind: 'docker',
				address: `unix://${api.socketPath}`,
				connection: false,
				identity: 'fake-bot-engine',
			}),
		);
	}
	process.env.DOCKER_HOST = `unix://${api.socketPath}`;
	const pty = {
		spawn: () => {
			throw new Error('Bots must not spawn a host PTY');
		},
	};
	const v = vault();
	const tokens = new BotTokenService(v);
	const agents = {
		botAgentContributions: () => [
			{
				extensionId: 'fake',
				extensionName: 'Fake extension',
				contribution: agent,
			},
		],
		botAgentInstalls: () => [
			{ id: agent.id, install: { npm: agent.imageInstall.npm } },
		],
		botAgentModels: async () => ({
			available: true,
			value: [{ id: 'selected', displayName: 'Selected' }],
		}),
		botAgentStatus: async () => ({
			available: true,
			value: { state: 'ready' },
		}),
		botAgentLaunch: async () => ({
			available: true,
			value: { args: [], env: {} },
		}),
	};
	const service = createBotServerService({
		serverId: 'composed-bots',
		dataRoot: root,
		agents,
		vault: v,
		tokens,
		pty,
		platform: 'darwin',
		...options,
	});
	const composition = createServerCoreComposition({
		serverId: 'composed-bots',
		serverVersion: 'test',
		capabilities: [],
		bots: service,
		ptyFactory: pty,
		allowUnresolvedTestSessions: true,
		...compositionOptions,
	});
	await composition.start();
	const clients = [];
	t.after(async () => {
		for (const c of clients) await c.close();
		await composition.shutdown();
		for (const [k, value] of Object.entries(original)) {
			if (value === undefined) delete process.env[k];
			else process.env[k] = value;
		}
		await api.close();
		rmSync(root, { recursive: true, force: true });
	});
	const connect = async (
		identity = { clientId: 'writer', authScope: 'write' },
	) => {
		const pair = createInMemoryTransportPair();
		const connection = composition.core.accept(pair.server, {
			authenticatedClient: identity,
		});
		const task = connection.start();
		const client = new TerminayClient({
			transport: pair.client,
			clientId: identity.clientId,
		});
		clients.push(client);
		await pair.open();
		const hello = await client.connect();
		const facade = new TerminayClientFacade(client);
		return {
			client,
			transport: facade,
			connection,
			task,
			hello,
			bots: new BotsClient(facade),
			engine: new BotEngineClient(facade),
			credentials: new BotCredentialClient(facade),
			io: new BotIoClient(facade),
		};
	};
	return {
		root,
		agents,
		tokens,
		service,
		composition,
		v,
		connect,
		processes: api.terminals,
		closed: api.closed,
		api,
		calls: () =>
			readFileSync(join(root, 'calls.jsonl'), 'utf8')
				.trim()
				.split('\n')
				.map(JSON.parse),
	};
}

test('composed Bots server: engine, image, message, Files, Shell, tokens and revocation over the client connection', {
	timeout: 30000,
}, async (t) => {
	const r = await setup(t),
		c = await r.connect();
	assert.ok(c.hello.capabilities.includes('bots.v1'));
	const events = await c.client.subscribe('bots.engine.changed');
	const invalidations = [];
	events.onEvent((e) => invalidations.push(e.payload));
	assert.equal((await c.engine.status()).image.state, 'missing');
	await c.engine.build();
	assert.equal((await c.engine.status()).image.state, 'current');
	const before = invalidations.length;
	await c.engine.status();
	await c.engine.status();
	assert.equal(
		invalidations.length,
		before,
		'reading status must not cause an invalidation/refetch loop',
	);
	assert.match(await c.engine.log(), /pinned fake adapter/);
	assert.ok(invalidations.length > 0);
	assert.ok(
		invalidations.every((e) => Object.keys(e).join(',') === 'revision'),
	);
	assert.equal((await c.bots.agents())[0].extensionName, 'Fake extension');
	const bot = await c.bots.save({
		name: 'Bird',
		agentId: agent.id,
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
	});
	const token = Buffer.from('secret');
	await c.credentials.save(bot.id, 'FAKE_KEY', token);
	assert.ok(token.every((v) => v === 0));
	assert.ok(
		!JSON.stringify(await c.credentials.options(bot.id)).includes('secret'),
	);
	const sent = await c.bots.send(bot.id, 'normal');
	await until(
		r.service,
		'changed',
		() => r.service.sessions.get(sent.sessionId).state === 'completed',
	);
	const session = await c.bots.session(bot.id, sent.sessionId);
	assert.ok(session.updates.length > 0);
	assert.ok(!JSON.stringify(session).includes('secret'));
	assert.match(JSON.stringify(session), /redacted/);
	assert.equal(r.tokens.retainedCount(bot.id), 1);
	await c.bots.control(bot.id, sent.sessionId, 'stop');
	assert.equal(r.tokens.retainedCount(bot.id), 0);
	process.env.TERMINAY_FAKE_CONTAINER_LOG_BYTES = '300000';
	const environment = new BotEnvironmentClient(
		new TerminayClientFacade(c.client),
	);
	const overview = await environment.overview(bot.id);
	assert.equal(Buffer.byteLength(overview.log), 256 * 1024);
	assert.ok(!overview.log.includes('secret'));
	assert.match(overview.log, /redacted/);
	assert.equal(r.tokens.retainedCount(bot.id), 0);
	const siblingId = 'a'.repeat(64);
	writeFileSync(
		join(r.root, `container-${siblingId}.json`),
		JSON.stringify({
			Id: siblingId,
			Name: 'sibling',
			Config: { Labels: { 'terminay.bot': bot.id }, Image: 'fake' },
			State: { Running: true, Status: 'running' },
		}),
	);
	const siblingLog = await environment.containerAction(
		bot.id,
		siblingId,
		'logs',
	);
	assert.equal(Buffer.byteLength(siblingLog), 256 * 1024);
	assert.ok(!siblingLog.includes('secret'));

	assert.ok(r.calls().some((c) => c.args?.[0] === 'exec' && c.keyPresent));
	assert.ok(!JSON.stringify(r.calls()).includes('secret'));
	assert.equal((await c.engine.status()).botContainers, 1);
	const files = await c.io.files(bot.id, 1);
	assert.equal((await files.list('.')).entries[0].name, 'hello');
	await files.close();
	const shell = await c.io.shell(bot.id, 1, 80, 24);
	await shell.write(Buffer.from('whoami\n'));
	const next = shell.read()[Symbol.asyncIterator]();
	assert.match(Buffer.from((await next.next()).value).toString(), /bot/);
	await shell.close();
	await until(r.closed, 'changed', () => r.processes.size === 0);
	const revoked = await c.io.shell(bot.id, 2, 80, 24);
	await until(r.closed, 'changed', () => r.processes.size >= 1);
	await c.connection.close({ code: 'unauthorized', message: 'revoked' });
	await c.task;
	await until(r.closed, 'changed', () => r.processes.size === 0);
	await revoked.close();
});

test('every composed operation family refuses restricted clients; a second device sees queue ids and cancels', {
	timeout: 30000,
}, async (t) => {
	const r = await setup(t),
		c = await r.connect();
	await c.engine.build();
	const bot = await c.bots.save({
		name: 'Queue',
		agentId: agent.id,
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
	});
	await c.credentials.save(bot.id, 'FAKE_KEY', Buffer.from('secret'));
	const sent = await c.bots.send(bot.id, 'hold');
	await until(
		r.service,
		'changed',
		() => r.service.sessions.get(sent.sessionId).state === 'running',
	);
	await assert.rejects(
		c.bots.reviseMessage(bot.id, sent.sessionId, 'user:0', 'hold', 'changed'),
		/shared message log/,
	);
	await assert.rejects(
		c.bots.clearChat(bot.id, sent.sessionId),
		/shared message log/,
	);
	for (let n = 0; n < 4; n++) await c.bots.send(bot.id, 'hold');
	const queued = await c.bots.send(bot.id, 'next');
	const other = await r.connect({ clientId: 'second', authScope: 'write' });
	assert.equal((await other.bots.queue(bot.id)).items[0].id, queued.queueId);
	await other.bots.cancelQueued(bot.id, queued.queueId);
	assert.deepEqual((await c.bots.queue(bot.id)).items, []);
	for (const identity of [
		{ clientId: 'read', authScope: 'read' },
		{ clientId: 'bound', authScope: 'write', claims: { capabilityId: 'cap' } },
	]) {
		const restricted = await r.connect(identity);
		for (const [op, payload] of [
			['bots.engine.status', {}],
			['bots.image.progress', {}],
			['bots.agents', {}],
			['bots.queue', { botId: bot.id }],
			['bots.environment.overview', { botId: bot.id }],
			['bots.environment.settings', { botId: bot.id }],
			['bots.credentials.options', { botId: bot.id }],
			['bots.files.list', { botId: bot.id }],
			['bots.io.read', { botId: bot.id }],
		])
			await assert.rejects(
				restricted.client.query(op, payload),
				(e) => e.code === 'forbidden',
			);
		for (const op of [
			'bots.environment.set-settings',
			'bots.engine.check',
			'bots.image.build',
			'bots.shell.open',
			'bots.desktop.open',
			'bots.files.open',
			'bots.credentials.save',
		])
			await assert.rejects(
				restricted.client.command(op, {
					botId: bot.id,
					generation: 1,
					cols: 80,
					rows: 24,
				}),
				(e) => e.code === 'forbidden',
			);
		await assert.rejects(
			restricted.client.subscribe('bots.engine.changed'),
			(e) => e.code === 'forbidden',
		);
	}
	await c.bots.control(bot.id, sent.sessionId, 'stop');
});

test('engine pin changes require confirmation; builds serialize, bound output and preserve the previous image on failure', {
	timeout: 30000,
}, async (t) => {
	const r = await setup(t),
		c = await r.connect();
	await writeFileSync(
		join(r.root, 'volume-terminay-engine-identity.json'),
		JSON.stringify({
			Labels: { 'terminay.engine.identity': 'replacement-engine' },
		}),
	);
	assert.equal((await c.engine.status()).reason, 'engine-changed');
	await assert.rejects(c.engine.use('docker', 'unix:///fake/bots.sock'));
	await c.engine.use('docker', process.env.DOCKER_HOST, true);
	assert.equal((await c.engine.status()).available, true);
	process.env.TERMINAY_FAKE_BUILD_LOG_BYTES = '300000';
	await Promise.all([c.engine.build(), c.engine.build()]);
	assert.ok(r.calls().filter((call) => call.args?.[0] === 'build').length >= 1);
	assert.equal(Buffer.byteLength(await c.engine.log()), 256 * 1024);
	const image = (await c.engine.status()).image;
	process.env.TERMINAY_FAKE_BUILD_FAIL = '1';
	await assert.rejects(c.engine.build());
	const failed = (await c.engine.status()).image;
	assert.equal(failed.state, 'failed');
	assert.equal(failed.fingerprint, image.fingerprint);
	delete process.env.TERMINAY_FAKE_BUILD_FAIL;
	await c.engine.build();
	assert.equal((await c.engine.status()).image.state, 'current');
});

test('agent picker retains disabled declarations and exposes per-bot sign-in methods', {
	timeout: 30000,
}, async (t) => {
	const r = await setup(t, {
		catalog: async () => [
			{
				extensionId: 'fake',
				extensionName: 'Fake extension',
				contribution: agent,
				enabled: true,
			},
			{
				extensionId: 'disabled',
				extensionName: 'Disabled extension',
				contribution: { ...agent, id: 'disabled/agent' },
				enabled: false,
			},
		],
	});
	const c = await r.connect();
	await c.engine.build();
	r.agents.botAgentStatus = async () => ({
		available: true,
		value: { state: 'not_signed_in' },
	});
	const agents = await c.bots.agents();
	assert.deepEqual(agents[0].status, { state: 'ready' });
	assert.deepEqual(agents[0].signInMethods, ['device', 'token']);
	assert.deepEqual(agents[1].status, {
		state: 'unavailable',
		action: { label: 'Enable extension', kind: 'enable-extension' },
	});
});

test('an uncomposed Bots capability is omitted from server hello capabilities', async () => {
	const composition = createServerCoreComposition({
		serverId: 'without-bots',
		serverVersion: 'test',
		capabilities: ['bots.v1'],
		allowUnresolvedTestSessions: true,
		ptyFactory: {
			spawn: () => {
				throw new Error('unused');
			},
		},
	});
	assert.ok(!composition.coreOptions.capabilities.includes('bots.v1'));
	await composition.shutdown();
});

test('environment settings over the connection deliver typed refusals and bots.changed invalidations', {
	timeout: 30000,
}, async (t) => {
	const r = await setup(t),
		c = await r.connect();
	const bot = await c.bots.save({ name: 'Settings', agentId: agent.id });
	const environment = new BotEnvironmentClient(
		new TerminayClientFacade(c.client),
	);
	const before = await environment.settings(bot.id);
	assert.equal(before.idleStopMs, 1800000);
	const subscription = await c.client.subscribe('bots.changed');
	t.after(() => subscription.unsubscribe());
	const events = [];
	subscription.onEvent((event) => events.push(event.payload));
	const saved = await environment.setSettings({
		botId: bot.id,
		idleStopMs: null,
		expectedRevision: before.revision,
	});
	assert.equal(saved.revision, before.revision + 1);
	assert.equal(saved.idleStopMs, null);
	await assert.rejects(
		environment.setSettings({
			botId: bot.id,
			idleStopMs: 300000,
			expectedRevision: before.revision,
		}),
		(e) => e.cause.code === 'conflict' && e.cause.details.reason === 'conflict',
	);
	assert.equal(events.length, 1);
	assert.deepEqual(Object.keys(events[0]).sort(), ['botId', 'revision']);
	assert.equal(events[0].botId, bot.id);
});

const terminalText = async (terminal) => {
	let text = '';
	for await (const bytes of terminal.read())
		text += Buffer.from(bytes).toString();
	return text;
};
const deviceMode = (r, mode) =>
	writeFileSync(join(r.root, 'device-mode-next.json'), JSON.stringify(mode));

test('9.4 unsigned messages and trigger firings fail before sessions, helpers or containers', {
	timeout: 10000,
}, async (t) => {
	const r = await setup(t),
		c = await r.connect();
	const bot = await c.bots.save({ name: 'Unsigned', agentId: agent.id });
	assert.deepEqual(bot.signIn, { kind: 'none' });
	const before = r.calls().length;
	await assert.rejects(c.bots.send(bot.id, 'normal'), (e) => {
		assert.equal(e.code, 'unavailable');
		assert.match(e.message, /Configure › Profile › Sign-in/);
		return true;
	});
	const trigger = r.service.triggers.create(bot.id, {
		name: 'Tick',
		prompt: 'normal',
		condition: { kind: 'every', intervalMs: 300000 },
		enabled: true,
	});
	const firing = await r.service.triggers.runNow(bot.id, trigger.id);
	assert.equal(firing.outcome, 'failed');
	assert.equal(firing.sessionId, null);
	assert.match(firing.reason, /Configure › Profile › Sign-in/);
	assert.deepEqual(r.service.sessions.list(bot.id), []);
	assert.equal(r.calls().length, before);
});

test('9.3/9.4 device terminal prints a URL/code, records success, restores config per session and signs out while stopped', {
	timeout: 15000,
}, async (t) => {
	const r = await setup(t),
		c = await r.connect();
	await c.engine.build();
	const bot = await c.bots.save({ name: 'Device', agentId: agent.id });
	await assert.rejects(c.bots.save({ ...bot, signIn: { kind: 'device' } }));
	const terminal = await c.io.shell(bot.id, 1, 80, 24, {}, 'sign-in');
	assert.match(
		await terminalText(terminal),
		/https:\/\/example.invalid\/device.*TEST-CODE/,
	);
	assert.deepEqual((await c.bots.get(bot.id)).signIn, { kind: 'device' });
	assert.equal((await c.credentials.options(bot.id)).device.signedIn, true);
	const start = r
		.calls()
		.find((call) => call.args?.some((arg) => arg.startsWith('signin-')));
	assert.ok(
		r.api.calls.some((call) => call.body?.Env?.includes('HOME=/home/bot')),
	);
	assert.deepEqual(start.args.slice(-3), ['codex', 'login', '--device-auth']);
	const sent = await c.bots.send(bot.id, 'normal');
	await until(
		r.service,
		'changed',
		() => r.service.sessions.get(sent.sessionId).state === 'completed',
	);
	assert.match(
		r.calls().find((call) => call.agent).config[0].content,
		/"file"/,
	);
	assert.equal(r.calls().find((call) => call.agent).keyPresent, false);
	await c.bots.control(bot.id, sent.sessionId, 'stop');
	writeFileSync(
		join(r.root, `config-terminay-bot-${bot.id}.json`),
		JSON.stringify([{ path: '.codex/config.toml', content: 'tampered' }]),
	);
	const fresh = await c.bots.send(bot.id, 'normal', sent.sessionId);
	await until(
		r.service,
		'changed',
		() => r.service.sessions.get(fresh.sessionId).state === 'completed',
	);
	assert.match(
		r
			.calls()
			.filter((call) => call.agent)
			.at(-1).config[0].content,
		/"file"/,
	);
	await c.bots.control(bot.id, fresh.sessionId, 'end');
	// Token sessions must restore the default even after a device session.
	await c.credentials.save(bot.id, 'FAKE_KEY', Buffer.from('secret'));
	await c.bots.save({
		...(await c.bots.get(bot.id)),
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
	});
	const token = await c.bots.send(bot.id, 'normal');
	await until(
		r.service,
		'changed',
		() => r.service.sessions.get(token.sessionId).state === 'completed',
	);
	assert.match(
		r
			.calls()
			.filter((call) => call.agent)
			.at(-1).config[0].content,
		/"ephemeral"/,
	);
	await c.bots.control(bot.id, token.sessionId, 'stop');
	const again = await c.io.shell(bot.id, 2, 80, 24, {}, 'sign-in');
	await terminalText(again);
	const environment = new BotEnvironmentClient(
		new TerminayClientFacade(c.client),
	);
	await environment.lifecycle(bot.id, 'stop');
	await c.credentials.deviceSignOut(bot.id);
	assert.deepEqual((await c.bots.get(bot.id)).signIn, { kind: 'none' });
	assert.equal((await c.credentials.options(bot.id)).device.signedIn, false);
	const signOut = r
		.calls()
		.find((call) => call.args?.some((arg) => arg.startsWith('signout-')));
	assert.deepEqual(signOut.args.slice(-3), [
		'codex-session',
		'forget',
		'--all',
	]);
});

for (const mode of ['fail', 'wait']) {
	test(`9.4 device ${mode === 'fail' ? 'failed exit' : 'abandoned terminal'} keeps the bot unsigned`, {
		timeout: 10000,
	}, async (t) => {
		const r = await setup(t),
			c = await r.connect();
		await c.engine.build();
		const bot = await c.bots.save({ name: mode, agentId: agent.id });
		deviceMode(r, mode);
		const terminal = await c.io.shell(bot.id, 1, 80, 24, {}, 'sign-in');
		if (mode === 'fail') await terminalText(terminal);
		else {
			const reader = terminal.read()[Symbol.asyncIterator]();
			assert.match(
				Buffer.from((await reader.next()).value).toString(),
				/TEST-CODE/,
			);
			await terminal.close();
			await reader.return();
		}
		assert.deepEqual((await c.bots.get(bot.id)).signIn, { kind: 'none' });
		await until(r.closed, 'changed', () => r.processes.size === 0);
	});
}

test('9.3 device operations refuse restricted clients and agents without device sign-in', {
	timeout: 15000,
}, async (t) => {
	const r = await setup(t),
		owner = await r.connect();
	await owner.engine.build();
	const bot = await owner.bots.save({ name: 'Authority', agentId: agent.id });
	for (const identity of [
		{ clientId: 'read-only', authScope: 'read' },
		{ clientId: 'capability', authScope: 'write', claims: { sessionId: 's' } },
	]) {
		const c = await r.connect(identity);
		await assert.rejects(c.io.shell(bot.id, 1, 80, 24, {}, 'sign-in'));
		await assert.rejects(c.credentials.deviceSignOut(bot.id));
	}
	const { deviceSignIn, ...tokenAgent } = agent;
	r.agents.botAgentContributions = () => [
		{ extensionId: 'fake', contribution: tokenAgent },
	];
	assert.equal((await owner.credentials.options(bot.id)).device, null);
	await assert.rejects(owner.io.shell(bot.id, 1, 80, 24, {}, 'sign-in'));
	await assert.rejects(owner.credentials.deviceSignOut(bot.id));
	assert.deepEqual((await owner.bots.get(bot.id)).signIn, { kind: 'none' });
});

test('9.4 a device login missing from the home sets the bot Not signed in before the agent starts', {
	timeout: 15000,
}, async (t) => {
	const r = await setup(t),
		c = await r.connect();
	await c.engine.build();
	const bot = await c.bots.save({ name: 'Lost login', agentId: agent.id });
	await terminalText(await c.io.shell(bot.id, 1, 80, 24, {}, 'sign-in'));
	const signedIn = await c.bots.send(bot.id, 'normal');
	await until(
		r.service,
		'changed',
		() => r.service.sessions.get(signedIn.sessionId).state === 'completed',
	);
	assert.ok(r.calls().some((call) => call.status && call.home === '/home/bot'));
	await c.bots.control(bot.id, signedIn.sessionId, 'end');
	writeFileSync(join(r.root, 'login-state.json'), JSON.stringify('gone'));
	const agentsBefore = r.calls().filter((call) => call.agent).length;
	const lost = await c.bots.send(bot.id, 'normal');
	await until(
		r.service,
		'changed',
		() => !['queued', 'running'].includes(r.service.sessions.get(lost.sessionId).state),
	);
	assert.match(
		r.service.sessions.get(lost.sessionId).reason ?? '',
		/Sign in with ChatGPT login is no longer in its home.*Configure › Profile › Sign-in/,
	);
	assert.equal(r.calls().filter((call) => call.agent).length, agentsBefore);
	assert.deepEqual((await c.bots.get(bot.id)).signIn, { kind: 'none' });
	await assert.rejects(c.bots.send(bot.id, 'normal'), (e) => {
		assert.equal(e.code, 'unavailable');
		assert.match(e.message, /Configure › Profile › Sign-in/);
		return true;
	});
});

test('9.4 failed sign-out retains the device state', {
	timeout: 10000,
}, async (t) => {
	const r = await setup(t),
		c = await r.connect();
	await c.engine.build();
	const bot = await c.bots.save({ name: 'Signout failure', agentId: agent.id });
	await terminalText(await c.io.shell(bot.id, 1, 80, 24, {}, 'sign-in'));
	deviceMode(r, 'fail-signout');
	await assert.rejects(c.credentials.deviceSignOut(bot.id));
	assert.deepEqual((await c.bots.get(bot.id)).signIn, { kind: 'device' });
});

test('9.3 sign-in stream rechecks connection, bot, generation and revocation', {
	timeout: 15000,
}, async (t) => {
	const r = await setup(t),
		c = await r.connect(),
		other = await r.connect({ clientId: 'other', authScope: 'write' });
	await c.engine.build();
	const bot = await c.bots.save({ name: 'Bound device', agentId: agent.id });
	deviceMode(r, 'wait');
	const terminal = await c.io.shell(bot.id, 1, 80, 24, {}, 'sign-in');
	const reader = terminal.read()[Symbol.asyncIterator]();
	assert.match(
		Buffer.from((await reader.next()).value).toString(),
		/TEST-CODE/,
	);
	await assert.rejects(
		other.client.queryWithBody('bots.io.read', { ...terminal.handle }),
	);
	for (const patch of [{ botId: 'abc123def456' }, { generation: 2 }])
		await assert.rejects(
			c.client.queryWithBody('bots.io.read', { ...terminal.handle, ...patch }),
		);
	await terminal.resize(100, 40);
	await c.connection.close({ code: 'unauthorized', message: 'revoked' });
	await c.task;
	await until(r.closed, 'changed', () => r.processes.size === 0);
	assert.deepEqual(r.service.bots.get(bot.id).signIn, { kind: 'none' });
	await reader.return();
});

test('an existing saved engine pin opens the dashboard without another selection and still builds the bot image', async (t) => {
	const r = await setup(t, { legacyPin: true }),
		client = await r.connect();
	const status = await client.engine.status();
	assert.equal(status.available, true);
	assert.equal(status.engine, 'docker');
	assert.equal(status.reason, null);
	assert.equal(
		JSON.parse(readFileSync(join(r.root, 'bots', 'engine.json'), 'utf8'))
			.version,
		2,
	);
	await client.engine.build();
	assert.equal((await client.engine.status()).image.state, 'current');
});

test('shared message APIs persist communication, enforce authority and preserve execution diagnostics', {
	timeout: 30000,
}, async (t) => {
	const r = await setup(t),
		c = await r.connect();
	await c.engine.build();
	const bot = await c.bots.save({
		name: 'Editable',
		agentId: agent.id,
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
	});
	await c.credentials.save(bot.id, 'FAKE_KEY', Buffer.from('secret'));

	const sent = await r.service.postUserMessage(bot.id, 'normal', 'first');
	await until(
		r.service,
		'changed',
		() => r.service.sessions.get(sent.sessionId).state === 'completed',
	);
	const user = r.service.messages
		.list(bot.id)
		.items.find((m) => m.author === 'user');
	assert.ok(user);
	const original = r.service.sessions.get(sent.sessionId);
	await assert.rejects(
		c.transport.command('bots.messages.edit', {
			botId: bot.id,
			messageId: user.id,
			revision: 0,
			text: 'stale',
		}),
	);
	const reader = await r.connect({
		clientId: 'reader-edit',
		authScope: 'read',
	});
	await assert.rejects(
		reader.transport.command('bots.messages.edit', {
			botId: bot.id,
			messageId: user.id,
			revision: 1,
			text: 'denied',
		}),
	);
	await c.transport.command('bots.messages.edit', {
		botId: bot.id,
		messageId: user.id,
		revision: 1,
		text: 'updated secret',
	});
	assert.equal(
		r.service.messages.get(bot.id, user.id).text,
		'updated [redacted]',
	);
	assert.deepEqual(
		r.service.sessions.get(sent.sessionId).updates,
		original.updates,
	);
	const page = await c.transport.query('bots.messages.list', {
		botId: bot.id,
		limit: 1,
	});
	assert.equal(page.items.length, 1);
	assert.equal('text' in page.items[0], false);
	await c.transport.command('bots.messages.remove', {
		botId: bot.id,
		messageId: user.id,
		revision: 2,
	});
	assert.throws(() => r.service.messages.get(bot.id, user.id));
	await c.transport.command('bots.messages.clear', {
		botId: bot.id,
		confirmed: true,
	});
	assert.equal(r.service.messages.list(bot.id).total, 0);
	assert.ok(r.service.sessions.get(sent.sessionId));
});

test('retry and dismiss travel the message protocol with authority and act for the asking window', {
	timeout: 30000,
}, async (t) => {
	const r = await setup(t),
		c = await r.connect();
	await c.engine.build();
	const bot = await c.bots.save({
		name: 'Retried',
		agentId: agent.id,
		signIn: { kind: 'none' },
	});
	const first = await c.transport.command('bots.messages.post', {
		botId: bot.id,
		text: 'normal',
		key: 'retry-1',
	});
	assert.equal(first.message.dispatch.state, 'failed');
	const second = await c.transport.command('bots.messages.post', {
		botId: bot.id,
		text: 'normal',
		key: 'retry-2',
	});
	const reader = await r.connect({ clientId: 'reader-retry', authScope: 'read' });
	for (const op of ['bots.messages.retry', 'bots.messages.dismiss'])
		await assert.rejects(
			reader.transport.command(op, {
				botId: bot.id,
				messageId: first.message.id,
				revision: 1,
				attempt: 1,
			}),
		);
	await assert.rejects(
		c.transport.command('bots.messages.retry', {
			botId: bot.id,
			messageId: first.message.id,
			revision: 1,
			attempt: 0,
		}),
	);
	const dismissed = await c.transport.command('bots.messages.dismiss', {
		botId: bot.id,
		messageId: second.message.id,
		revision: 1,
		attempt: 1,
	});
	assert.equal(dismissed.dispatch.dismissed, true);

	await c.bots.save({
		...bot,
		signIn: { kind: 'token', environmentVariable: 'FAKE_KEY' },
	});
	await c.credentials.save(bot.id, 'FAKE_KEY', Buffer.from('secret'));
	const other = await r.connect({ clientId: 'other-window', authScope: 'write' });
	const retried = await other.transport.command('bots.messages.retry', {
		botId: bot.id,
		messageId: first.message.id,
		revision: 1,
		attempt: 1,
	});
	assert.ok(retried.sessionId);
	assert.equal(retried.message.dispatch.state, 'started');
	assert.equal(retried.message.dispatch.attempt, 2);
	assert.equal(r.service.viewerOf(bot.id)?.clientId, 'other-window');
	await until(r.service, 'changed', () =>
		['completed', 'failed'].includes(
			r.service.sessions.get(retried.sessionId).state,
		),
	);
});

test('wire errors explain engine identity changes and deletion remains usable with deferred owned resource removal', {
	timeout: 30000,
}, async (t) => {
	const r = await setup(t),
		c = await r.connect();
	await c.engine.build();
	const bot = await c.bots.save({
		name: 'Recoverable',
		agentId: agent.id,
		signIn: { kind: 'none' },
	});
	const env = new BotEnvironmentClient(c.transport);
	await env.lifecycle(bot.id, 'start');
	const pin = JSON.parse(
		readFileSync(join(r.root, 'bots', 'engine.json'), 'utf8'),
	);
	const home = `terminay-bot-${bot.id}-home`;
	const marker = await r.api.read('volume', 'terminay-engine-identity');
	await r.api.put('volume', 'terminay-engine-identity', {
		...marker,
		Labels: { 'terminay.engine.identity': 'different-engine' },
	});
	await c.engine.check();
	assert.equal((await c.engine.status()).reason, 'engine-changed');
	await assert.rejects(
		env.overview(bot.id),
		(error) =>
			error.details?.reason === 'engine-changed' &&
			/Use this engine/.test(error.message),
	);
	const result = await c.bots.remove(bot.id, true, true);
	assert.match(result.warning, /Removal is pending/);
	assert.equal((await c.bots.list()).bots.length, 0);
	assert.ok(await r.api.read('volume', home));
	const pending = JSON.parse(
		readFileSync(join(r.root, 'bots', 'deletions.json'), 'utf8'),
	);
	assert.equal(pending.entries[0].pin.identity, pin.identity);
	// Explicit adoption of another identity must not apply the old deletion intent.
	const status = await c.engine.status();
	const candidate = status.candidates.find((c) => c.available);
	await c.engine.use(candidate.kind, candidate.address, true);
	assert.ok(await r.api.read('volume', home));
	// Re-adopt the original identity; only now can its pending owned home be removed.
	await r.api.put('volume', 'terminay-engine-identity', marker);
	await c.engine.check();
	await c.engine.use(candidate.kind, candidate.address, true);
	for (
		let attempt = 0;
		attempt < 100 &&
		JSON.parse(readFileSync(join(r.root, 'bots', 'deletions.json'), 'utf8'))
			.entries.length;
		attempt++
	)
		await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(
		JSON.parse(readFileSync(join(r.root, 'bots', 'deletions.json'), 'utf8'))
			.entries.length,
		0,
	);
	assert.equal(await r.api.read('volume', home), undefined);
});

test('overview helper events settle with two bots across the wire', {
	timeout: 30000,
}, async (t) => {
	const r = await setup(t),
		c = await r.connect();
	await c.engine.build();
	const env = new BotEnvironmentClient(c.transport);
	const bots = [];
	for (const name of ['One', 'Two']) {
		const bot = await c.bots.save({
			name,
			agentId: agent.id,
			signIn: { kind: 'none' },
		});
		bots.push(bot);
		await env.lifecycle(bot.id, 'start');
	}
	const events = await c.client.subscribe('bots.changed');
	const changes = [];
	events.onEvent((e) => changes.push(e));
	await env.overview(bots[0].id);
	const before = changes.length;
	for (const action of ['create', 'init', 'attach', 'start', 'die', 'destroy'])
		r.api.emitEvent({
			Type: 'container',
			Action: action,
			Actor: {
				Attributes: {
					name: 'random-helper',
					'terminay.server': 'composed-bots',
					'terminay.bot': bots[0].id,
					'terminay.role': 'helper',
				},
			},
		});
	// A later state query round trip establishes that the emitted frames have drained.
	for (const bot of bots) assert.equal(await env.state(bot.id), 'running');
	assert.equal(changes.length, before);
});

test('pending deletion completes on server restart when the original verified engine returns', {
	timeout: 30000,
}, async (t) => {
	const r = await setup(t),
		c = await r.connect();
	await c.engine.build();
	const bot = await c.bots.save({
		name: 'Restart cleanup',
		agentId: agent.id,
		signIn: { kind: 'none' },
	});
	await new BotEnvironmentClient(c.transport).lifecycle(bot.id, 'start');
	const marker = await r.api.read('volume', 'terminay-engine-identity');
	await r.api.put('volume', 'terminay-engine-identity', {
		...marker,
		Labels: { 'terminay.engine.identity': 'reset' },
	});
	await c.engine.check();
	assert.ok((await c.bots.remove(bot.id, true, true)).warning);
	await r.composition.shutdown();
	await r.api.put('volume', 'terminay-engine-identity', marker);
	const restarted = createBotServerService({
		serverId: 'composed-bots',
		dataRoot: r.root,
		agents: r.agents,
		vault: r.v,
		platform: 'darwin',
		pty: {
			spawn() {
				throw new Error('no host PTY');
			},
		},
	});
	try {
		await restarted.reconcile();
		for (
			let attempt = 0;
			attempt < 100 &&
			JSON.parse(readFileSync(join(r.root, 'bots', 'deletions.json'), 'utf8'))
				.entries.length;
			attempt++
		)
			await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(
			JSON.parse(readFileSync(join(r.root, 'bots', 'deletions.json'), 'utf8'))
				.entries.length,
			0,
		);
		assert.equal(
			await r.api.read('volume', `terminay-bot-${bot.id}-home`),
			undefined,
		);
	} finally {
		await restarted.shutdown();
	}
});

/** Re-read `read` until `check` holds; the settle timer runs on its own. */
async function eventually(read, check, ms = 5000) {
	const deadline = Date.now() + ms;
	for (;;) {
		const value = await read();
		if (check(value)) return value;
		if (Date.now() > deadline) assert.fail(`never held: ${JSON.stringify(value)}`);
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

test('a bot post is published as a notification only to bot-authorized clients, and acknowledgement or dismissal clears it', {
	timeout: 30000,
}, async (t) => {
	const notifications = new NotificationManager({ settleMs: 50 });
	const r = await setup(t, {
		composition: {
			activity: new TerminalActivityService({ serverId: 'composed-bots' }),
			notifications,
		},
	});
	const writer = await r.connect();
	const reader = await r.connect({ clientId: 'read', authScope: 'read' });
	const bot = await writer.bots.save({ name: 'Bird', agentId: agent.id });
	const snapshot = async (c) =>
		Object.values(
			(await c.client.query('notifications.snapshot', {})).result.notifications,
		);
	const post = (text, key) =>
		r.service.messages.post(bot.id, 'bot', text, 'a'.repeat(24), key);

	const first = post('Build is green', 'p1');
	const [record] = await eventually(() => snapshot(writer), (rows) => rows.length === 1);
	assert.deepEqual(
		[record.owner, record.botId, record.count, record.body, record.throughSequence],
		['bot', bot.id, 1, 'Build is green', first.sequence],
	);
	assert.deepEqual(await snapshot(reader), [], 'a read-only client sees no bot record');
	await assert.rejects(
		reader.client.command('notifications.dismiss', { id: record.id, botId: bot.id }),
	);

	// Acknowledging through what was seen clears it for everyone.
	await new BotMessagesClient(writer.transport).acknowledge(bot.id, first.sequence);
	await eventually(() => snapshot(writer), (rows) => rows.length === 0);
	await assert.rejects(
		new BotMessagesClient(reader.transport).acknowledge(bot.id, first.sequence),
	);

	// A post after the dismissed record survives the dismissal.
	post('Deploying', 'p2');
	const [second] = await eventually(() => snapshot(writer), (rows) => rows.length === 1);
	const racing = post('Deployed', 'p3');
	// The client dismisses what it was shown; the record has since grown.
	await writer.client.command('notifications.dismiss', {
		id: second.id,
		botId: bot.id,
		throughSequence: second.throughSequence,
	});
	const [left] = await eventually(
		() => snapshot(writer),
		(rows) => rows.length === 1 && rows[0].throughSequence === racing.sequence,
	);
	assert.deepEqual([left.count, left.body], [1, 'Deployed']);
	await writer.client.command('notifications.dismiss', { id: left.id, botId: bot.id });
	await eventually(() => snapshot(writer), (rows) => rows.length === 0);
});
