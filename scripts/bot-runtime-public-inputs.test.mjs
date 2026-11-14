import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../docker/terminay-bot/', import.meta.url);
test('bot image runtime inputs have no private registry or Atlas import dependency', async () => {
	const files = [
		'Dockerfile',
		...(await readdir(new URL('bin/', root))).map((name) => `bin/${name}`),
	];
	for (const file of files) {
		const source = await readFile(new URL(file, root), 'utf8');
		assert.doesNotMatch(
			source,
			/git\.i\.wylde\.net|@atlas\/|Projects\/atlas|from ['"][^'"]*atlas/i,
			file,
		);
	}
	const docker = await readFile(new URL('Dockerfile', root), 'utf8');
	assert.match(docker, /FROM docker\.io\/library\/node:/);
	assert.doesNotMatch(docker, /--no-sandbox|^EXPOSE/m);
	const manifest = JSON.parse(
		await readFile(
			new URL('../extensions/builtin-agents/package.json', import.meta.url),
			'utf8',
		),
	);
	for (const agent of manifest.terminay.contributes.botAgents) {
		assert.equal(agent.runtimeProtocol, 'native-cli-v1');
		assert.ok(['codex-cli', 'claude-code-cli'].includes(agent.nativeDriver));
		assert.ok(
			agent.imageInstall.npm.every((pin) => /@\d+\.\d+\.\d+$/.test(pin)),
		);
		assert.ok(
			agent.imageInstall.npm.includes(
				(agent.nativeDriver === 'codex-cli'
					? '@openai/codex@'
					: '@anthropic-ai/claude-code@') + agent.runtimeVersion,
			),
		);
	}
});

test('CI cache identity binds complete context, generated recipe and Docker daemon architecture', async () => {
	const { botCiImageCache } = await import('./bot-ci-image-cache.mjs');
	const inputs = { repository: 'registry.example/project/bot-ci-cache', platform: 'linux/x86_64', fingerprint: 'a'.repeat(64), dockerfile: 'FROM node:26\nCOPY bin /bin\n' };
	const first = botCiImageCache(inputs);
	assert.equal(first.platform, 'linux/amd64');
	assert.deepEqual(botCiImageCache({ ...inputs, platform: 'linux/amd64' }), first);
	for (const changed of [{ fingerprint: 'b'.repeat(64) }, { platform: 'linux/arm64' }, { dockerfile: 'FROM mirror/node:26\nCOPY bin /bin\n' }]) assert.notEqual(botCiImageCache({ ...inputs, ...changed }).reference, first.reference);
	assert.equal(botCiImageCache({ ...inputs, repository: undefined }), null);
	assert.throws(() => botCiImageCache({ ...inputs, repository: 'registry/project:mutable-tag' }), /Invalid/u);
});

test('CI cache restore fails closed on mismatched identities and never changes test execution', async () => {
	const { botCiImageCache, restoreBotCiImageCache, publishBotCiImageCache } = await import('./bot-ci-image-cache.mjs');
	const cache = botCiImageCache({ repository: 'registry.example/project/bot-ci-cache', platform: 'linux/amd64', fingerprint: 'a'.repeat(64), dockerfile: 'FROM node:26' });
	const calls = [];
	const good = (args) => { calls.push(args); return args[0] === 'image' ? `linux/amd64 ${cache.fingerprint}\n` : ''; };
	assert.equal(restoreBotCiImageCache(cache, good, () => {}), true);
	assert.equal(restoreBotCiImageCache(cache, args => args[0] === 'image' ? `linux/arm64 ${cache.fingerprint}` : '', () => {}), false);
	assert.equal(restoreBotCiImageCache(cache, args => args[0] === 'image' ? `linux/amd64 ${'b'.repeat(64)}` : '', () => {}), false);
	assert.equal(restoreBotCiImageCache(cache, () => { throw new Error('cache miss'); }, () => {}), false);
	assert.equal(publishBotCiImageCache(cache, 'image-under-test', good, () => {}), true);
	assert.deepEqual(calls.slice(-2), [['tag', 'image-under-test', cache.reference], ['push', cache.reference]]);
	assert.equal(publishBotCiImageCache(cache, 'image-under-test', () => { throw new Error('registry unavailable'); }, () => {}), false);
	const driver = await readFile(new URL('./run-bot-mcp-real-tests.mjs', import.meta.url), 'utf8');
	assert.match(driver, /const restored = restoreBotCiImageCache[\s\S]*docker\(\n\s*'build'/u, 'the source Dockerfile is built even on a hit');
	assert.match(driver, /restored \? \['--cache-from', cache\.reference\]/u);
	const publication = driver.indexOf('publishBotCiImageCache(cache, image, runDocker)');
	assert.ok(publication > driver.indexOf('TERMINAY_BOT_MCP_SMOKE_IMAGE='), 'cache publication follows the final real MCP suite');
	assert.match(driver, /--test-force-exit.*--test-timeout=120000/u);
});
