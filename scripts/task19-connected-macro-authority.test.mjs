import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
	new URL('../src/hooks/useMacroSettings.ts', import.meta.url),
	'utf8',
);

test('connected macro persistence uses only the canonical server client', () => {
	const start = source.indexOf(
		'export function createServerMacroSettingsClient',
	);
	const end = source.indexOf(
		'/**\n * The named Desktop compatibility caller',
		start,
	);
	assert.notEqual(start, -1);
	assert.notEqual(end, -1);
	const implementation = source.slice(start, end);

	assert.doesNotMatch(
		implementation,
		/LegacyMacroSettingsCapability|legacy\./u,
	);
	assert.match(implementation, /await client\.get\(\)/u);
	assert.match(implementation, /await client\.replace\(macros\)/u);
	assert.match(implementation, /await client\.reset\(\)/u);
	assert.match(implementation, /client\.onChanged/u);
});

test('connected dictation uploads through the selected server AI client', async () => {
	const controller = await readFile(
		new URL('../src/workspace/useDictationController.ts', import.meta.url),
		'utf8',
	);
	const app = await readFile(
		new URL('../src/App.tsx', import.meta.url),
		'utf8',
	);
	assert.match(controller, /aiClient\.transcribe\(/u);
	assert.match(controller, /new DictationCaptureClient/u);
	assert.match(controller, /capture\.begin\(/u);
	assert.match(controller, /getDisclosure\(\)/u);
	assert.match(controller, /audio: upload\.audio/u);
	assert.match(controller, /target: upload\.target/u);
	assert.match(app, /aiClient: serverAiClient/u);
	assert.match(app, /serverId: terminalClientContext\.serverId/u);
	assert.match(app, /audioDestination:/u);
	assert.match(app, /provider === 'openai' \? 'openai' : 'selected-server'/u);
	assert.match(app, /terminalClientContext\.connectionLabel/u);
	assert.match(
		controller,
		/Audio stays on \$\{serverDisclosureRef\.current\.serverLabel\}/u,
	);
	assert.match(
		controller,
		/Audio is sent from \$\{serverDisclosureRef\.current\.serverLabel\} to OpenAI/u,
	);
});

test('connected settings model discovery uses the selected server AI client', async () => {
	const [desktop, browser] = await Promise.all([
		readFile(new URL('../src/rendererRuntime.tsx', import.meta.url), 'utf8'),
		readFile(
			new URL('../src/web/ConnectedWebRendererWorkspace.tsx', import.meta.url),
			'utf8',
		),
	]);
	for (const source of [desktop, browser]) {
		assert.match(source, /new TerminayAiClient/u);
		assert.match(source, /aiTabMetadataClient=/u);
		assert.match(source, /client\.listModels/u);
	}
});

test('connected Parakeet management uses the selected server runtime', async () => {
	const settings = await readFile(
		new URL('../src/components/SettingsWindow.tsx', import.meta.url),
		'utf8',
	);
	assert.match(settings, /serverAiClient\?\.dictationRuntimeStatus\(\)/u);
	assert.match(settings, /serverAiClient\?\.installDictationRuntime\(\)/u);
});

test('connected OpenAI credentials use only the selected server', async () => {
	const settings = await readFile(
		new URL('../src/components/SettingsWindow.tsx', import.meta.url),
		'utf8',
	);
	assert.match(settings, /serverAiClient\?\.dictationCredentialStatus\(\)/u);
	assert.match(settings, /serverAiClient\?\.setDictationCredential/u);
	assert.match(settings, /serverAiClient\?\.clearDictationCredential/u);
});

test('Electron persists only device presentation settings', async () => {
	const [main, terminalSettings, serverDefaults] = await Promise.all([
		readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/terminalSettings.ts', import.meta.url), 'utf8'),
		readFile(
			new URL(
				'../packages/server-core/src/settings/defaults.ts',
				import.meta.url,
			),
			'utf8',
		),
	]);
	assert.match(
		main,
		/JSON\.stringify\(selectDeviceTerminalSettings\(normalized\)/u,
	);
	assert.match(terminalSettings, /SERVER_OWNED_TERMINAL_SETTING_KEYS/u);
	for (const key of [
		'agentIntegration',
		'aiTabMetadata',
		'dictation',
		'recording',
		'remoteAccess',
		'shell',
	]) {
		assert.match(terminalSettings, new RegExp(`'${key}'`, 'u'));
	}
	assert.match(
		terminalSettings,
		/microphoneDeviceId: normalized\.dictation\.microphoneDeviceId/u,
	);
	assert.match(serverDefaults, /provider: ['"]openai['"]/u);
});
