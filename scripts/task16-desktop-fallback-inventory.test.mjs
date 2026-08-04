import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile('src/rendererRuntime.tsx', 'utf8');
const main = await readFile('electron/main.ts', 'utf8');

test('Desktop production routes have no feature fallback or retired WebRTC host', () => {
	assert.doesNotMatch(source, /WebRtcHost|webrtc-host/u);
	assert.doesNotMatch(main, /TERMINAY_ENABLE_LEGACY_REMOTE_ACCESS/u);
	assert.doesNotMatch(main, /remote-webrtc-host|RemoteAccessService/u);
	assert.match(source, /<RecordingsWindow\b/u);
	assert.match(source, /<SettingsWindow\b/u);
	assert.match(source, /<MacrosWindow\b/u);
	assert.match(source, /<EditTabWindow\b/u);
	assert.match(
		source,
		/<RecordingsWindow client=\{serverRecordingsClient\}/u,
	);
	assert.match(source, /<MacrosWindow[\s\S]*macroSettingsClient=/u);
	assert.match(source, /<EditTabWindow\s+client=/u);
	assert.doesNotMatch(source, /Server(?:Recordings|Settings|Macros|EditWindow)Route/u);
});
