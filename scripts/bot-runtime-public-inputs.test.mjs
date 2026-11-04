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
