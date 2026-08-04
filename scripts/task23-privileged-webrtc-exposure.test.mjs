import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Desktop WebRTC bootstrap runs in the privileged selected runtime without a hidden renderer', async () => {
	const [adapter, main, packageJson] = await Promise.all([
		readFile('electron/remote/privilegedWebRtcExposure.ts', 'utf8'),
		readFile('electron/main.ts', 'utf8'),
		readFile('package.json', 'utf8'),
	]);
	assert.match(adapter, /loadSelectedSecureWeriftRuntime/u);
	assert.match(adapter, /runHost/u);
	assert.match(adapter, /if \(!this\.service\.getStatus\(\)\.isRunning\) await this\.loadRuntime\(\)/u);
	assert.match(adapter, /createPrivilegedPeerConnection\(runtime, configuration\)/u);
	assert.match(adapter, /remoteDescriptionInstalled/u);
	assert.doesNotMatch(adapter, /from ['"]electron['"]|BrowserWindow|ipcMain|preload/u);
	assert.match(main, /resolveDesktopWebRtcRuntimeRoot/u);
	assert.match(main, /new PrivilegedWebRtcExposure/u);
	assert.match(main, /privilegedWebRtcExposure\?\.service\.appendSessionData/u);
	assert.match(main, /privilegedWebRtcExposure!\.toggle\(\)/u);
	const scripts = JSON.parse(packageJson).scripts;
	assert.match(scripts.dev, /^npm run build:shared && npm run build:server-ui/u);
	assert.match(scripts.dev, /stage-selected-secure-werift-runtime\.mjs/u);
	assert.match(scripts.dev, /TERMINAY_WEBRTC_RUNTIME_ROOT/u);
});
