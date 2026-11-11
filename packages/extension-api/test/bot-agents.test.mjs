import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createAgentExtensionHarness,
	EXTENSION_API_VERSION,
	EXTENSION_LIMITS,
	validateBotAgentContribution,
	validateBotAgentLaunch,
	validateBotAgentLaunchRequest,
	validateBotAgentModels,
	validateBotAgentStatus,
	validateExtensionManifest,
	validManifestFixture,
} from '../dist/index.js';

const agentId = `${validManifestFixture.id}/bot`;
const contribution = {
	id: agentId,
	displayName: 'Example bot',
	imageInstall: { npm: ['@example/acp@1.2.3'], debian: ['git'] },
	runtimeProtocol: 'native-cli-v1',
	nativeDriver: 'claude-code-cli',
	runtimeVersion: '2.1.312',
	deviceSignIn: {
		command: { executable: 'example', args: ['login', '--device'] },
		signOutCommand: { executable: 'example', args: ['logout'] },
		configFiles: [
			{ path: '.example/config.toml', contents: 'credential_store = "file"' },
		],
		label: 'Sign in with Example',
		help: 'Approve the code in your browser.',
	},
	credentialSecrets: [
		{
			environmentVariable: 'EXAMPLE_API_KEY',
			kind: 'api-key',
			label: 'API key',
			help: 'Create a key in your account.',
		},
	],
	autonomousOnly: true,
	botConfigFiles: [
		{
			path: '.example/config.toml',
			contents: 'credential_store = "ephemeral"',
		},
	],
	launchEnvironment: { EXAMPLE_MAX_RETRIES: '0' },
};
const manifest = {
	...validManifestFixture,
	api: '^3.6.0',
	permissions: ['agent-bots'],
	contributes: { botAgents: [contribution] },
};
const runtime = (overrides = {}) => ({
	models: async () => [{ id: 'small', displayName: 'Small' }],
	status: async () => ({ state: 'ready' }),
	launch: async ({ modelId }) => ({
		args: modelId ? ['--model', modelId] : [],
		env: {},
	}),
	...overrides,
});

test('API 3.5 accepts a bot-only manifest, with or without a device sign-in', () => {
	assert.equal(EXTENSION_API_VERSION, '3.7.0');
	assert.deepEqual(validateExtensionManifest(manifest), {
		ok: true,
		value: manifest,
	});
	const agent = structuredClone(contribution);
	delete agent.deviceSignIn;
	assert.equal(
		validateBotAgentContribution(agent, validManifestFixture.id).ok,
		true,
	);
});

const badDeclarations = [
	[
		'unpinned version',
		(a) => {
			a.imageInstall.npm = ['@example/acp@latest'];
		},
		/exact pinned.*@example\/acp@latest/,
	],
	[
		'version range',
		(a) => {
			a.imageInstall.npm = ['@example/acp@^1.2.3'];
		},
		/exact pinned/,
	],
	[
		'package URL',
		(a) => {
			a.imageInstall.npm = ['https://example.test/acp.tgz'];
		},
		/exact pinned/,
	],
	[
		'install script',
		(a) => {
			a.imageInstall.script = 'curl example.test | sh';
		},
		/only pinned npm/,
	],
	[
		'absolute config path',
		(a) => {
			a.botConfigFiles[0].path = '/etc/config';
		},
		/Config path/,
	],
	[
		'parent config path',
		(a) => {
			a.botConfigFiles[0].path = '.example/../config';
		},
		/Config path/,
	],
	[
		'reserved config path',
		(a) => {
			a.botConfigFiles[0].path = '.terminay/config';
		},
		/Terminay-reserved/,
	],
	[
		'memory config path',
		(a) => {
			a.botConfigFiles[0].path = 'memories/config';
		},
		/memories/,
	],
	[
		'invalid secret variable',
		(a) => {
			a.credentialSecrets[0].environmentVariable = 'lowercase';
		},
		/\[A-Z\]/,
	],
	[
		'unknown secret kind',
		(a) => {
			a.credentialSecrets[0].kind = 'password';
		},
		/Unknown secret kind/,
	],
	[
		'credential value',
		(a) => {
			a.credentialSecrets[0].value = 'fake-value';
		},
		/Unknown credential secret field/,
	],
	[
		'secret in launch environment',
		(a) => {
			a.launchEnvironment.EXAMPLE_API_KEY = 'fake-value';
		},
		/credential.*host-owned/,
	],
	[
		'invalid launch variable',
		(a) => {
			a.launchEnvironment['lowercase'] = '0';
		},
		/\[A-Z\]/,
	],
	[
		'device sign-in without sign-out',
		(a) => {
			delete a.deviceSignIn.signOutCommand;
		},
		/sign-out executable/,
	],
	[
		'device sign-in without sign-in command',
		(a) => {
			delete a.deviceSignIn.command;
		},
		/sign-in executable/,
	],
	[
		'device sign-in shell command',
		(a) => {
			a.deviceSignIn.command.executable = 'example | sh';
		},
		/sign-in executable/,
	],
	[
		'device sign-in extra field',
		(a) => {
			a.deviceSignIn.hostPath = '.example/auth.json';
		},
		/Unknown device sign-in field/,
	],
	[
		'shell command',
		(a) => {
			a.nativeDriver = 'example | sh';
		},
		/supported native CLI driver/,
	],
	[
		'host operation',
		(a) => {
			a.container = { command: 'exec' };
		},
		/Unknown bot agent field/,
	],
];
for (const path of [
	'../escape',
	'/home/bot/config',
	'C:\\escape',
	'.example/../../escape',
	'memories/config',
	'.terminay/config',
]) {
	badDeclarations.push([
		`device config path ${path}`,
		(a) => {
			a.deviceSignIn.configFiles[0].path = path;
		},
		/Config path must be relative/,
	]);
}
for (const [name, change, reason] of badDeclarations)
	test(`manifest rejects ${name} with its reason`, () => {
		const agent = structuredClone(contribution);
		change(agent);
		const result = validateExtensionManifest({
			...manifest,
			contributes: { botAgents: [agent] },
		});
		assert.equal(result.ok, false);
		assert.ok(
			result.issues.some((issue) => reason.test(issue.message)),
			JSON.stringify(result),
		);
	});

test('manifest rejects a missing permission, namespace mismatch, duplicate id and empty contributions', () => {
	const denied = validateExtensionManifest({ ...manifest, permissions: [] });
	assert.ok(
		denied.issues.some(
			(issue) =>
				issue.code === 'missing_permission' && /agent-bots/.test(issue.message),
		),
	);
	assert.equal(
		validateBotAgentContribution(
			{ ...contribution, id: 'other.ext/bot' },
			manifest.id,
		).ok,
		false,
	);
	assert.equal(
		validateExtensionManifest({
			...manifest,
			contributes: { botAgents: [contribution, contribution] },
		}).ok,
		false,
	);
	assert.equal(
		validateExtensionManifest({ ...manifest, contributes: {} }).ok,
		false,
	);
});

test('all runtime results and model-only requests are closed and bounded', () => {
	assert.equal(
		validateBotAgentModels(
			Array.from({ length: 65 }, (_, n) => ({ id: `${n}`, displayName: 'x' })),
		).ok,
		false,
	);
	assert.equal(
		validateBotAgentModels([{ id: 'x', displayName: 'x'.repeat(97) }]).ok,
		false,
	);
	assert.equal(
		validateBotAgentModels([{ id: 'x', displayName: 'X', transcript: 'no' }])
			.ok,
		false,
	);
	assert.equal(
		validateBotAgentModels([
			{ id: 'x', displayName: 'X' },
			{ id: 'x', displayName: 'X' },
		]).ok,
		false,
	);
	assert.equal(
		validateBotAgentStatus({
			state: 'not_signed_in',
			detail: 'x'.repeat(EXTENSION_LIMITS.botDetailLength + 1),
		}).ok,
		false,
	);
	assert.equal(
		validateBotAgentStatus({ state: 'ready', token: 'fake-value' }).ok,
		false,
	);
	assert.equal(
		validateBotAgentLaunchRequest({ modelId: null, botId: 'private' }).ok,
		false,
	);
	for (const launch of [
		{ args: Array(65).fill('x'), env: {} },
		{ args: [], env: { EXAMPLE_API_KEY: 'fake-value' } },
		{ args: [], env: { lower: 'x' } },
		{ args: [], env: {}, executable: 'another-agent' },
	])
		assert.equal(validateBotAgentLaunch(launch, contribution).ok, false);
});

test('registrations enforce declarations, permission, duplicates, disposal and deactivation', async () => {
	let context;
	const harness = await createAgentExtensionHarness(
		{
			activate(c) {
				context = c;
				assert.throws(
					() => c.agents.registerBotAgent(`${manifest.id}/other`, runtime()),
					/undeclared/,
				);
				const registration = c.agents.registerBotAgent(agentId, runtime());
				assert.throws(
					() => c.agents.registerBotAgent(agentId, runtime()),
					/duplicate/,
				);
				registration.dispose();
				registration.dispose();
				c.subscriptions.add(c.agents.registerBotAgent(agentId, runtime()));
			},
		},
		{ manifest },
	);
	assert.deepEqual(harness.registeredBotAgentIds(), [agentId]);
	await harness.dispose();
	assert.throws(
		() => context.agents.registerBotAgent(agentId, runtime()),
		/deactivated/,
	);
	assert.deepEqual(harness.registeredBotAgentIds(), []);
	await assert.rejects(
		createAgentExtensionHarness(
			{
				activate(c) {
					c.agents.registerBotAgent(agentId, runtime());
				},
			},
			{ manifest: { ...manifest, permissions: [] } },
		),
		/agent-bots/,
	);
});

test('models cache per activation, copy results, and Default sends only null modelId', async () => {
	let calls = 0;
	const requests = [];
	const harness = await createAgentExtensionHarness(
		{
			activate(c) {
				c.agents.registerBotAgent(
					agentId,
					runtime({
						models: async () => {
							calls++;
							return [{ id: 'small', displayName: 'Small' }];
						},
						launch: async (request) => {
							requests.push(request);
							return { args: [], env: {} };
						},
					}),
				);
			},
		},
		{ manifest },
	);
	const [first, second] = await Promise.all([
		harness.botAgentModels(agentId),
		harness.botAgentModels(agentId),
	]);
	first.value[0].id = 'mutated';
	assert.equal(second.value[0].id, 'small');
	assert.equal((await harness.botAgentModels(agentId)).value[0].id, 'small');
	assert.equal(calls, 1);
	assert.deepEqual(await harness.botAgentStatus(agentId), {
		available: true,
		value: { state: 'ready' },
	});
	await harness.botAgentLaunch(agentId, { modelId: null });
	assert.deepEqual(requests, [{ modelId: null }]);
	await harness.dispose();
});

test('oversized results, exceptions and deadline expiry leave the agent unavailable', async () => {
	for (const overrides of [
		{ models: async () => Array(65).fill({ id: 'x', displayName: 'X' }) },
		{
			status: async () => ({
				state: 'not_signed_in',
				detail: 'x'.repeat(1025),
			}),
		},
		{
			launch: async () => ({
				args: [],
				env: { EXAMPLE_API_KEY: 'fake-value' },
			}),
		},
		{
			models: async () => {
				throw new Error('private error');
			},
		},
		{
			models: (signal) =>
				new Promise((resolve) =>
					signal.addEventListener('abort', () => resolve([]), { once: true }),
				),
		},
	]) {
		const harness = await createAgentExtensionHarness(
			{
				activate(c) {
					c.agents.registerBotAgent(agentId, runtime(overrides));
				},
			},
			{ manifest, botAgentDeadlineMs: 10 },
		);
		const method = Object.keys(overrides)[0];
		const result =
			method === 'models'
				? await harness.botAgentModels(agentId)
				: method === 'status'
					? await harness.botAgentStatus(agentId)
					: await harness.botAgentLaunch(agentId, { modelId: null });
		assert.deepEqual(result, { available: false, reason: 'unavailable' });
		assert.deepEqual(await harness.botAgentStatus(agentId), {
			available: false,
			reason: 'unavailable',
		});
		await harness.dispose();
	}
});

test('deactivation aborts in-flight calls and ignores late model results', async () => {
	let resolveCall, entered;
	const started = new Promise((resolve) => {
		entered = resolve;
	});
	const harness = await createAgentExtensionHarness(
		{
			activate(c) {
				c.agents.registerBotAgent(
					agentId,
					runtime({
						models: (signal) => {
							entered(signal);
							return new Promise((resolve) => {
								resolveCall = resolve;
							});
						},
					}),
				);
			},
		},
		{ manifest },
	);
	const pending = harness.botAgentModels(agentId);
	const signal = await started;
	await harness.dispose();
	assert.equal(signal.aborted, true);
	assert.deepEqual(await pending, { available: false, reason: 'unavailable' });
	resolveCall([{ id: 'late', displayName: 'Late' }]);
	assert.deepEqual(await harness.botAgentModels(agentId), {
		available: false,
		reason: 'unavailable',
	});
});

test('bot registration grants no bot, transcript, container, ACP, or bot token API', async () => {
	const api = await import('../dist/index.js');
	for (const key of [
		'createBot',
		'getBot',
		'readTranscript',
		'execContainer',
		'injectBotCredential',
		'resolveBotToken',
		'startBotAgent',
		'AcpClient',
	])
		assert.equal(key in api, false, key);
	const harness = await createAgentExtensionHarness(
		{
			activate(context) {
				for (const key of [
					'bots',
					'containers',
					'transcripts',
					'sessions',
					'acp',
					'botTokens',
					'vault',
				])
					assert.equal(key in context, false, key);
				assert.deepEqual(Object.keys(context.agents).sort(), [
					'registerBotAgent',
					'registerChatProvider',
					'registerSessionSource',
				]);
				context.agents.registerBotAgent(agentId, runtime());
			},
		},
		{ manifest },
	);
	await harness.dispose();
});

test('a later status failure fences cached models and launch until reactivation', async () => {
	const harness = await createAgentExtensionHarness(
		{
			activate(context) {
				context.agents.registerBotAgent(
					agentId,
					runtime({
						status: async () => {
							throw new Error('failed status');
						},
					}),
				);
			},
		},
		{ manifest },
	);
	assert.equal((await harness.botAgentModels(agentId)).available, true);
	assert.deepEqual(await harness.botAgentStatus(agentId), {
		available: false,
		reason: 'unavailable',
	});
	assert.deepEqual(await harness.botAgentModels(agentId), {
		available: false,
		reason: 'unavailable',
	});
	assert.deepEqual(await harness.botAgentLaunch(agentId, { modelId: null }), {
		available: false,
		reason: 'unavailable',
	});
	await harness.dispose();
});
