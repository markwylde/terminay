import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	agentLayer,
	buildBotImage,
	planBotImage,
} from '../dist/botService/index.js';

const source = new URL('../../../docker/terminay-bot/', import.meta.url)
	.pathname;
const agent = {
	id: 'builtin/codex',
	install: { npm: ['@agentclientprotocol/codex-acp@2.5.0'], apt: ['git'] },
};

test('4.2 only pinned npm and Debian lists reach generated Dockerfile', () => {
	const layer = agentLayer([agent]);
	assert.match(
		layer,
		/npm install -g -- @agentclientprotocol\/codex-acp@2\.5\.0/,
	);
	assert.match(layer, /apt-get install -y --no-install-recommends git/);
	assert.equal(
		agentLayer([
			{
				...agent,
				command: 'RUN evil',
				install: { ...agent.install, command: 'evil' },
			},
		]),
		layer,
	);
	for (const npm of [
		'x@latest',
		'x@^1.2.3',
		'x@1.2',
		'https://example.com/x',
		'x@1.2.3;touch /tmp/x',
		'-x@1.2.3',
		'$(id)@1.2.3',
		'x@01.2.3',
	])
		assert.throws(
			() => agentLayer([{ ...agent, install: { npm: [npm] } }]),
			/exact/,
		);
	for (const apt of ['git;id', '-y', '$(id)', 'git\nRUN evil', '../git'])
		assert.throws(
			() => agentLayer([{ ...agent, install: { npm: [], apt: [apt] } }]),
			/Debian/,
		);
	assert.throws(
		() =>
			agentLayer([
				agent,
				{
					id: 'other',
					install: { npm: ['@agentclientprotocol/codex-acp@2.6.0'] },
				},
			]),
		/conflicting/,
	);
});

test('4.2 fingerprint covers shipped scripts, sorted manifests, uid and new agents', async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), 'bot-image-test-'));
	t.after(() => rm(directory, { force: true, recursive: true }));
	await cp(source, directory, { recursive: true });
	const first = await planBotImage(directory, [agent], 1000, 1000);
	const extra = {
		id: 'builtin/claude',
		install: { npm: ['@agentclientprotocol/claude-agent-acp@0.99.1'] },
	};
	const second = await planBotImage(directory, [agent, extra], 1000, 1000);
	assert.notEqual(first.fingerprint, second.fingerprint);
	assert.equal(
		second.fingerprint,
		(await planBotImage(directory, [extra, agent], 1000, 1000)).fingerprint,
	);
	assert.notEqual(
		first.fingerprint,
		(await planBotImage(directory, [agent], 501, 20)).fingerprint,
	);
	await writeFile(path.join(directory, 'bin/terminay-init'), '# changed');
	assert.notEqual(
		first.fingerprint,
		(await planBotImage(directory, [agent], 1000, 1000)).fingerprint,
	);
	assert.match(
		first.dockerfile,
		new RegExp(`LABEL terminay.fingerprint="${first.fingerprint}"`),
	);
});

test('4.2 failed image build preserves published tag and success publishes only after build', async () => {
	const plan = await planBotImage(source, [agent], 1000, 1000);
	const calls = [];
	let fail = true;
	const driver = {
		run: async (args, options) => {
			calls.push(args);
			if (args[0] === 'build') {
				assert.equal(
					await readFile(path.join(args.at(-1), 'Dockerfile'), 'utf8'),
					plan.dockerfile,
				);
				assert.equal(options.deadlineMs, 900000);
				if (fail) throw new Error('install failed');
			}
			return '';
		},
	};
	await assert.rejects(buildBotImage(driver, source, plan), /install failed/);
	assert.equal(
		calls.some((args) => args[1] === 'tag'),
		false,
	);
	fail = false;
	calls.length = 0;
	await buildBotImage(driver, source, plan);
	assert.deepEqual(
		calls.map((args) => args.slice(0, 2)),
		[
			['build', '--tag'],
			['image', 'tag'],
			['image', 'rm'],
		],
	);
	assert.equal(calls[1].at(-1), 'terminay-bot:local');
});

test('validated botAgent manifests feed the image layer without unrelated metadata', async () => {
	const { validateExtensionManifest } = await import('@terminay/extension-api');
	const { botAgentInstalls } = await import('../dist/botService/index.js');
	const pkg = JSON.parse(
		await readFile(
			new URL(
				'../../../extensions/builtin-agents/package.json',
				import.meta.url,
			),
			'utf8',
		),
	);
	const checked = validateExtensionManifest(pkg.terminay);
	assert.equal(checked.ok, true);
	const contributions = checked.value.contributes.botAgents;
	const installs = botAgentInstalls(contributions);
	const layer = agentLayer(installs);
	for (const contribution of contributions) {
		for (const pin of contribution.imageInstall.npm)
			assert.ok(layer.includes(pin));
	}
	assert.match(
		layer,
		/ln -s .*codex-acp\/node_modules\/@openai\/codex\/bin\/codex.js \/usr\/local\/bin\/codex/,
	);
	assert.doesNotMatch(layer, /credentials|AUTH_TOKEN|API_KEY|config.toml/);
	const original = installs[0].install.npm[0];
	contributions[0].imageInstall.npm[0] = 'x@latest';
	assert.equal(installs[0].install.npm[0], original);
	assert.throws(() => botAgentInstalls(contributions), /invalid bot agent/);
	const extra = {
		...contributions[1],
		id: 'com.example.bot/extra',
		imageInstall: { npm: ['example@1.2.3'], debian: ['jq'] },
	};
	assert.deepEqual(botAgentInstalls([extra])[0].install.apt, ['jq']);
	const { ExtensionHostManager } = await import(
		'../dist/extensions/manager.js'
	);
	const manager = new ExtensionHostManager({
		broker: { request: async () => undefined },
	});
	assert.deepEqual(manager.botAgentInstalls(), []);
});

test('Claude sign-in resolves the adapter SDK native runtime for both Linux architectures', async (t) => {
	const { createRequire } = await import('node:module');
	const require = createRequire(import.meta.url);
	const {
		claudeExecutable,
	} = require('../../../docker/terminay-bot/install-claude.cjs');
	const directory = await mkdtemp(path.join(tmpdir(), 'bot-claude-runtime-'));
	t.after(() => rm(directory, { force: true, recursive: true }));
	const { mkdir, realpath } = await import('node:fs/promises');
	const adapter = path.join(directory, 'package.json');
	await writeFile(adapter, '{}');
	const sdk = path.join(
		directory,
		'node_modules/@anthropic-ai/claude-agent-sdk',
	);
	await mkdir(sdk, { recursive: true });
	await writeFile(
		path.join(sdk, 'package.json'),
		JSON.stringify({ main: 'sdk.mjs' }),
	);
	await writeFile(path.join(sdk, 'sdk.mjs'), '');
	for (const arch of ['arm64', 'x64']) {
		const native = path.join(
			directory,
			`node_modules/@anthropic-ai/claude-agent-sdk-linux-${arch}`,
		);
		await mkdir(native, { recursive: true });
		await writeFile(path.join(native, 'claude'), 'native fixture');
		assert.equal(
			claudeExecutable(adapter, arch),
			await realpath(path.join(native, 'claude')),
		);
	}
	assert.throws(() => claudeExecutable(adapter, 'riscv64'), /Unsupported/);
	await rm(path.join(directory, 'node_modules'), { recursive: true });
	assert.throws(
		() => claudeExecutable(path.join(directory, 'missing/package.json')),
		/Cannot find module/,
	);
	const layer = agentLayer([
		{
			id: 'builtin/claude',
			install: { npm: ['@agentclientprotocol/claude-agent-acp@0.99.1'] },
		},
	]);
	assert.match(
		layer,
		/install-claude.cjs && claude --version && claude auth login --help && claude auth logout --help/,
	);
	assert.doesNotMatch(agentLayer([agent]), /install-claude/);
});
