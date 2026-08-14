import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const [settings, controller, declarations, main, connectedWorkspace] =
	await Promise.all([
		readFile('src/components/SettingsWindow.tsx', 'utf8'),
		readFile('src/workspace/useDictationController.ts', 'utf8'),
		readFile('src/vite-env.d.ts', 'utf8'),
		readFile('electron/main.ts', 'utf8'),
		readFile('src/web/ConnectedWebRendererWorkspace.tsx', 'utf8'),
	]);

test('AI metadata and dictation use selected-server clients without legacy globals', () => {
	const renderer = `${settings}\n${controller}\n${connectedWorkspace}`;
	assert.doesNotMatch(
		renderer,
		/terminayAiMetadataHost|terminayDictationHost/u,
	);
	assert.doesNotMatch(
		declarations,
		/terminayAiMetadataHost|terminayDictationHost/u,
	);
	assert.match(settings, /serverAiClient\?\.dictationCredentialStatus\(\)/u);
	assert.match(settings, /serverAiClient\s*\?\.dictationRuntimeStatus\(\)/u);
	assert.match(settings, /serverAiClient\.installDictationRuntime\(\)/u);
	assert.match(controller, /aiClient\.transcribe\(/u);
	assert.match(controller, /new DictationCaptureClient/u);
	assert.match(connectedWorkspace, /new TerminayAiClient/u);
});

test('Electron does not register legacy AI or dictation IPC adapters', async () => {
	assert.doesNotMatch(
		main,
		/registerAiTabMetadataIpcHandlers|registerDictationIpcHandlers/u,
	);
	for (const path of [
		'electron/aiTabMetadata/ipc.ts',
		'electron/dictation/ipc.ts',
		'electron/dictation/parakeetRuntime.ts',
		'electron/dictation/service.ts',
		'src/services/ai/legacyAiTabMetadataClient.ts',
	]) {
		await assert.rejects(access(path));
	}
});

test('microphone capture stays a browser media capability', () => {
	assert.match(settings, /navigator\.mediaDevices\?\.getUserMedia/u);
	assert.match(controller, /navigator\.mediaDevices\?\.getUserMedia/u);
	assert.doesNotMatch(main, /askForMediaAccess\('microphone'\)/u);
});
