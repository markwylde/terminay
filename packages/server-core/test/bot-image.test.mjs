import assert from 'node:assert/strict';
import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	agentLayer,
	buildBotImage,
	dockerfileSources,
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
	const changed = await planBotImage(directory, [agent], 1000, 1000);
	assert.notEqual(first.fingerprint, changed.fingerprint);
	// A changed MCP adapter makes every existing bot image out of date.
	await writeFile(path.join(directory, 'bin/terminay-bot-mcp'), '# changed');
	assert.notEqual(
		changed.fingerprint,
		(await planBotImage(directory, [agent], 1000, 1000)).fingerprint,
	);
	assert.match(
		first.dockerfile,
		new RegExp(`LABEL terminay.fingerprint="${first.fingerprint}"`),
	); // Tests and notes beside the Dockerfile are not built into the image.
	const settled = (await planBotImage(directory, [agent], 1000, 1000))
		.fingerprint;
	await writeFile(path.join(directory, 'test_extra.py'), 'print(1)');
	await writeFile(path.join(directory, 'PORTING.md'), '# notes');
	assert.equal(
		settled,
		(await planBotImage(directory, [agent], 1000, 1000)).fingerprint,
	);
	const plan = async () =>
		(await planBotImage(directory, [agent], 1000, 1000)).fingerprint;
	// A copied script's executable bit is built into the image.
	await chmod(path.join(directory, 'bin/terminay-init'), 0o644);
	const plain = await plan();
	assert.notEqual(plain, settled);
	await chmod(path.join(directory, 'bin/terminay-init'), 0o755);
	assert.equal(await plan(), settled);
	// So is the ignore file, which decides what the build context holds.
	await writeFile(path.join(directory, '.dockerignore'), '*.md\n');
	assert.notEqual(await plan(), settled);
	await rm(path.join(directory, '.dockerignore'));
	// A copied path that is a link is refused, never followed.
	await rm(path.join(directory, 'bin/terminay-run'));
	await symlink('terminay-init', path.join(directory, 'bin/terminay-run'));
	await assert.rejects(plan(), /links/);
});

test('the fingerprint reads exactly the context paths the Dockerfile copies', () => {
	assert.deepEqual(
		dockerfileSources(
			[
				'FROM debian AS base',
				'COPY bin/b bin/a /usr/local/bin/',
				'COPY --chown=bot:bot conf \\',
				'  /etc/conf',
				'COPY --from=base /x /y',
				'ADD bin/a /opt/',
			].join('\n'),
		),
		['bin/a', 'bin/b', 'conf'],
	);
	for (const refused of [
		'COPY bin/* /x/',
		'COPY /etc/passwd /x',
		'COPY ../outside /x',
		'COPY bin/../outside /x',
		'COPY $SOURCES /x',
		'COPY --from /x /y',
		'COPY --fromage=1 bin/* /x',
		'COPY --chown=bot ["a", "/b"]',
		'ADD https://example.invalid/a /x',
	])
		assert.throws(() => dockerfileSources(refused), /literal/, refused);
	assert.throws(() => dockerfileSources('COPY ["a", "/b"]'), /JSON-form/);
	assert.throws(
		() => dockerfileSources('COPY <<EOF /x\nhello\nEOF'),
		/heredoc/,
	);
});

test('copied directories include empty entries and refuse linked parent paths', async (t) => {
	const directory = await mkdtemp(path.join(tmpdir(), 'bot-image-paths-'));
	t.after(() => rm(directory, { force: true, recursive: true }));
	await mkdir(path.join(directory, 'files'));
	await writeFile(path.join(directory, 'files/a'), 'input');
	await writeFile(
		path.join(directory, 'Dockerfile'),
		'FROM scratch\nCOPY files /files',
	);
	const plan = () => planBotImage(directory, [], 1000, 1000);
	const first = await plan();
	await mkdir(path.join(directory, 'files/empty'));
	assert.notEqual((await plan()).fingerprint, first.fingerprint);
	await symlink('files', path.join(directory, 'linked'));
	await writeFile(
		path.join(directory, 'Dockerfile'),
		'FROM scratch\nCOPY linked/a /a',
	);
	await assert.rejects(plan(), /links/);
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
	assert.match(layer, /@openai\/codex@0\.165\.0/);
	assert.doesNotMatch(layer, /agentclientprotocol|install-claude|ln -s/);
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

test('native image installs public pinned CLIs directly', async () => {
	const layer = agentLayer([
		{
			id: 'builtin/claude',
			install: { npm: ['@anthropic-ai/claude-code@2.1.312'] },
		},
	]);
	assert.match(layer, /@anthropic-ai\/claude-code@2\.1\.312/);
	assert.doesNotMatch(
		layer,
		/adapter|agent-sdk|install-claude|agentclientprotocol/,
	);
});
