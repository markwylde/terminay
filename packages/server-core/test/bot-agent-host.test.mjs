import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validManifestFixture } from '@terminay/extension-api';
import {
	ExtensionHost,
	ExtensionHostManager,
	ExtensionSecretBroker,
	extensionLaunchDescriptor,
} from '../dist/index.js';

const extensionId = 'example.bots';
const agentId = `${extensionId}/example`;
const contribution = {
	id: agentId,
	displayName: 'Example',
	imageInstall: { npm: ['example-acp@1.2.3'] },
	runtimeProtocol: 'native-cli-v1',
	nativeDriver: 'claude-code-cli',
	runtimeVersion: '2.1.312',
	autonomousOnly: false,
	credentialSecrets: [
		{
			environmentVariable: 'EXAMPLE_BOT_KEY',
			kind: 'api-key',
			label: 'Key',
			help: 'Create a key.',
		},
	],
};
const unavailable = { available: false, reason: 'unavailable' };
async function fixture(
	t,
	{
		models = "return [{ id: 'small', displayName: 'Small' }];",
		status = "return { state: 'ready' };",
		launch = 'return { args: request.modelId ? ["--model", request.modelId] : [], env: {} };',
		activation = '',
		permissions = ['agent-bots'],
	} = {},
) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-bot-agent-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(
		join(root, 'extension.js'),
		`export function activate(context) {
    let modelCalls = 0;
    const requests = [];
    const runtime = {
      async models(signal) { modelCalls++; ${models} },
      async status(signal) { ${status} },
      async launch(request, signal) { requests.push(request); ${launch} },
    };
    const registration = context.agents.registerBotAgent('${agentId}', runtime);
    ${activation}
    return { methods: {
      inspect() { return { modelCalls, requests, agentKeys: Object.keys(context.agents).sort(), hasBotApi: ['bots','containers','transcripts','sessions','acp','vault','botTokens'].some(k => k in context), envKey: process.env.EXAMPLE_BOT_KEY ?? null }; },
      dispose() { registration.dispose(); registration.dispose(); },
      async forbidden({ operation, payload }) { try { return await context.broker.request(operation, payload); } catch (error) { return { refused: true, message: error.message }; } },
    }};
  }`,
	);
	for (const name of ['config', 'data', 'cache']) await mkdir(join(root, name));
	return {
		extensionId,
		packageRoot: root,
		entrypoint: 'extension.js',
		configDirectory: join(root, 'config'),
		dataDirectory: join(root, 'data'),
		cacheDirectory: join(root, 'cache'),
		permissions,
		botAgents: [contribution],
	};
}
function hostFor(t, options = {}) {
	const host = new ExtensionHost(extensionId, {
		broker: {
			async request() {
				throw new Error('unexpected broker call');
			},
		},
		...options,
	});
	t.after(() => host.stop());
	return host;
}

test('bot-only manifest bridges through validated launch descriptors', async (t) => {
	const descriptor = await fixture(t);
	const result = await extensionLaunchDescriptor({
		...descriptor,
		manifest: {
			...validManifestFixture,
			id: extensionId,
			api: '^3.5.0',
			permissions: ['agent-bots'],
			entrypoint: 'extension.js',
			contributes: { botAgents: [contribution] },
		},
	});
	assert.deepEqual(result.descriptor.botAgents, [contribution]);
});

test('real child registration exposes validated models, status and model-only launch, cached per activation', async (t) => {
	const host = hostFor(t);
	const descriptor = await fixture(t);
	await host.start(descriptor);
	assert.deepEqual(host.botAgentContributions(), [contribution]);
	const [first, second] = await Promise.all([
		host.botAgentModels(agentId),
		host.botAgentModels(agentId),
	]);
	assert.deepEqual(first, {
		available: true,
		value: [{ id: 'small', displayName: 'Small' }],
	});
	first.value[0].id = 'tampered';
	assert.equal(second.value[0].id, 'small');
	assert.deepEqual(await host.botAgentStatus(agentId), {
		available: true,
		value: { state: 'ready' },
	});
	assert.deepEqual(await host.botAgentLaunch(agentId, { modelId: 'small' }), {
		available: true,
		value: { args: ['--model', 'small'], env: {} },
	});
	assert.deepEqual(await host.botAgentLaunch(agentId, { modelId: null }), {
		available: true,
		value: { args: [], env: {} },
	});
	assert.equal((await host.invoke({ method: 'inspect' })).modelCalls, 1);
	assert.deepEqual((await host.invoke({ method: 'inspect' })).requests, [
		{ modelId: 'small' },
		{ modelId: null },
	]);
	assert.deepEqual(
		await host.botAgentModels('example.bots/missing'),
		unavailable,
	);
	await host.stop();
	assert.deepEqual(await host.botAgentStatus(agentId), unavailable);
	await host.start(descriptor);
	await host.botAgentModels(agentId);
	assert.equal((await host.invoke({ method: 'inspect' })).modelCalls, 1);
});

test('undeclared ids, duplicate ids and missing permission fail activation', async (t) => {
	for (const options of [
		{
			activation: `context.agents.registerBotAgent('${extensionId}/undeclared', runtime);`,
		},
		{ activation: `context.agents.registerBotAgent('${agentId}', runtime);` },
		{ permissions: [] },
	]) {
		const host = hostFor(t);
		await assert.rejects(
			host.start(await fixture(t, options)),
			/undeclared|duplicate|permission/,
		);
	}
});

test('child disposal invalidates parent model cache and registration', async (t) => {
	const host = hostFor(t);
	await host.start(await fixture(t));
	await host.botAgentModels(agentId);
	await host.invoke({ method: 'dispose' });
	assert.deepEqual(host.botAgentContributions(), []);
	assert.deepEqual(await host.botAgentModels(agentId), unavailable);
});

test('oversized models, status and launch results and private exceptions leave the agent unavailable', async (t) => {
	for (const [options, method] of [
		[
			{
				models:
					'return Array.from({length:65}, (_, i) => ({id:String(i),displayName:"X"}));',
			},
			'models',
		],
		[
			{ status: 'return {state:"not_signed_in", detail:"x".repeat(1025)};' },
			'status',
		],
		[{ launch: 'return { args: Array(65).fill("x"), env: {} };' }, 'launch'],
		[
			{
				launch: 'return { args: [], env: { EXAMPLE_BOT_KEY: "fake-value" } };',
			},
			'launch',
		],
		[{ models: 'throw new Error("private failure text");' }, 'models'],
	]) {
		const host = hostFor(t);
		await host.start(await fixture(t, options));
		const result =
			method === 'models'
				? await host.botAgentModels(agentId)
				: method === 'status'
					? await host.botAgentStatus(agentId)
					: await host.botAgentLaunch(agentId, { modelId: null });
		assert.deepEqual(result, unavailable);
		assert.deepEqual(await host.botAgentStatus(agentId), unavailable);
	}
});

test('a call deadline aborts a slow extension and reports unavailable', async (t) => {
	const host = hostFor(t, { limits: { invocationTimeoutMs: 50 } });
	await host.start(
		await fixture(t, {
			models:
				'return await new Promise(resolve => signal.addEventListener("abort", () => resolve([]), {once:true}));',
		}),
	);
	assert.deepEqual(await host.botAgentModels(agentId), unavailable);
	assert.deepEqual(await host.botAgentStatus(agentId), unavailable);
});

test('manager publishes bot agents and removes availability on stop', async (t) => {
	const manager = new ExtensionHostManager({ broker: { async request() {} } });
	t.after(() => manager.shutdown());
	await manager.start(await fixture(t));
	assert.deepEqual(manager.botAgentContributions(), [
		{ extensionId, contribution },
	]);
	assert.deepEqual(await manager.botAgentStatus(agentId), {
		available: true,
		value: { state: 'ready' },
	});
	assert.equal((await manager.botAgentModels(agentId)).available, true);
	assert.equal(
		(await manager.botAgentLaunch(agentId, { modelId: null })).available,
		true,
	);
	await manager.stop(extensionId);
	assert.deepEqual(manager.botAgentContributions(), []);
	assert.deepEqual(await manager.botAgentStatus(agentId), unavailable);
});

test('no bot, transcript, container or token broker route exists, even with secrets:resolve', async (t) => {
	let vaultReads = 0;
	const secrets = new ExtensionSecretBroker({
		withSecret() {
			vaultReads++;
			throw new Error('must not read bot credential');
		},
	});
	for (const permissions of [
		['agent-bots'],
		['agent-bots', 'secrets:resolve'],
	]) {
		const host = hostFor(t, { secrets });
		await host.start(await fixture(t, { permissions }));
		const inspection = await host.invoke({ method: 'inspect' });
		assert.equal(inspection.hasBotApi, false);
		assert.equal(inspection.envKey, null);
		assert.deepEqual(inspection.agentKeys, [
			'registerBotAgent',
			'registerChatProvider',
			'registerSessionSource',
		]);
		for (const operation of [
			'bots.list',
			'bots.get',
			'bots.transcript',
			'bots.container.exec',
			'bot.token.resolve',
			'bot.credential.inject',
			'secret.resolve',
		]) {
			const result = await host.invoke({
				method: 'forbidden',
				input: {
					operation,
					payload: {
						profileId: 'bot-1',
						fieldId: 'EXAMPLE_BOT_KEY',
						secretId: 'bots.bot-1.key',
						extensionId: 'host',
					},
				},
			});
			assert.equal(result.refused, true, operation);
			assert.doesNotMatch(JSON.stringify(result), /fake-value/);
		}
	}
	assert.equal(vaultReads, 0);
});

test('the parent validates results independently of the extension child', async (t) => {
	const descriptor = await fixture(t);
	const childEntrypoint = join(descriptor.packageRoot, 'hostile-child.js');
	await writeFile(
		childEntrypoint,
		`process.on('message', (frame) => {
    if (frame.kind === 'activate') process.send({protocolVersion:1,kind:'ready',id:frame.id,payload:{botAgents:['${agentId}']}});
    if (frame.kind === 'agent.bot.models') process.send({protocolVersion:1,kind:'result',id:frame.id,payload:Array.from({length:65},(_,i)=>({id:String(i),displayName:'X'}))});
    if (frame.kind === 'deactivate') process.send({protocolVersion:1,kind:'deactivated',id:frame.id});
  });`,
	);
	const host = hostFor(t, { childEntrypoint });
	await host.start(descriptor);
	assert.deepEqual(await host.botAgentModels(agentId), unavailable);
	assert.deepEqual(await host.botAgentStatus(agentId), unavailable);
});

test('child registrations captured before deactivation or a new activation cannot register again', async () => {
	const { BotAgentChild } = await import('../dist/extensions/botAgentChild.js');
	const disposed = [];
	const child = new BotAgentChild({
		result() {},
		failure() {},
		disposed: (id) => disposed.push(id),
	});
	child.reset([contribution], true, 100);
	const registry = child.registry();
	const runtime = {
		models: async () => [],
		status: async () => ({ state: 'ready' }),
		launch: async () => ({ args: [], env: {} }),
	};
	const old = registry.registerBotAgent(agentId, runtime);
	child.deactivate();
	assert.throws(
		() => registry.registerBotAgent(agentId, runtime),
		/deactivated/,
	);
	child.reset([contribution], true, 100);
	child.registry().registerBotAgent(agentId, runtime);
	old.dispose();
	assert.deepEqual(child.ids(), [agentId]);
	assert.deepEqual(disposed, []);
	assert.throws(
		() => registry.registerBotAgent(agentId, runtime),
		/deactivated/,
	);
	child.deactivate();
});
