import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
	assertManifestMatchesPackage,
	createAgentExtensionHarness,
	validateExtensionManifest,
} from '../dist/index.js';
import example from '../examples/bot-agent/extension.js';

test('the bot agent author example conforms without starting a process or reading a credential', async () => {
	const pkg = JSON.parse(
		await readFile(
			new URL('../examples/bot-agent/package.json', import.meta.url),
			'utf8',
		),
	);
	const validation = validateExtensionManifest(pkg.terminay);
	assert.equal(validation.ok, true, JSON.stringify(validation));
	assertManifestMatchesPackage(validation.value, pkg);
	const harness = await createAgentExtensionHarness(example, {
		manifest: validation.value,
	});
	try {
		const id = 'com.example.bot/example';
		assert.deepEqual(harness.registeredBotAgentIds(), [id]);
		assert.deepEqual(await harness.botAgentModels(id), {
			available: true,
			value: [{ id: 'gpt-6-luna', displayName: 'GPT-6 Luna' }],
		});
		assert.equal(
			(await harness.botAgentStatus(id)).value.state,
			'not_signed_in',
		);
		assert.deepEqual(await harness.botAgentLaunch(id, { modelId: 'small' }), {
			available: true,
			value: { args: [], env: {} },
		});
		assert.deepEqual(await harness.botAgentLaunch(id, { modelId: null }), {
			available: true,
			value: { args: [], env: {} },
		});
	} finally {
		await harness.dispose();
	}
});

test('bot conformance harness refuses invalid device declarations before activation', async () => {
	const pkg = JSON.parse(
		await readFile(
			new URL('../examples/bot-agent/package.json', import.meta.url),
			'utf8',
		),
	);
	for (const mutate of [
		(device) => {
			delete device.signOutCommand;
		},
		(device) => {
			device.configFiles[0].path = '../escape';
		},
	]) {
		const manifest = structuredClone(pkg.terminay);
		mutate(manifest.contributes.botAgents[0].deviceSignIn);
		let activated = false;
		await assert.rejects(
			createAgentExtensionHarness(
				{
					activate() {
						activated = true;
					},
				},
				{ manifest },
			),
			/Invalid bot agent declaration/,
		);
		assert.equal(activated, false);
	}
});
