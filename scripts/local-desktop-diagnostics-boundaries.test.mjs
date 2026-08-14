import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
const preload = await readFile(
	new URL('../electron/serverUiPreload.ts', import.meta.url),
	'utf8',
);
const authority = await readFile(
	new URL('../electron/serverTerminalAuthority.ts', import.meta.url),
	'utf8',
);
const quickPush = await readFile(
	new URL('../electron/quickPush/service.ts', import.meta.url),
	'utf8',
);
const dictation = await readFile(
	new URL('../src/workspace/useDictationController.ts', import.meta.url),
	'utf8',
);

test('diagnostics initialize before Electron readiness, recovery window, and Local server', () => {
	const diagnosticsStart = main.indexOf('await initializeDesktopDiagnostics');
	const ready = main.indexOf('await app.whenReady()', diagnosticsStart);
	const recoveryWindow = main.indexOf(
		'createWindow({ deferCanonicalLaunch: true })',
		ready,
	);
	const localServerConstruction = main.indexOf(
		'new ServerTerminalAuthority',
		recoveryWindow,
	);
	assert.ok(diagnosticsStart > 0);
	assert.ok(ready > diagnosticsStart);
	assert.ok(recoveryWindow > ready);
	assert.ok(localServerConstruction > recoveryWindow);
	assert.ok(
		main.indexOf('DocumentPolicyIncludeJSCallStacksInCrashReports') <
			diagnosticsStart,
	);
	assert.match(main, /crashReporter,/u);
});

test('embedded vault unlock occurs after recovery setup and before Local renderer admission', () => {
	const ready = main.indexOf('app.whenReady().then');
	const embeddedReady = main.indexOf(
		'await embeddedRuntimeReady',
		ready,
	);
	const unlock = main.indexOf('await embeddedVault.unlock', ready);
	const localReady = main.indexOf("event: 'local-server.ready'", ready);
	const launch = main.indexOf(
		'await launchDeferredCanonicalWindow(embeddedStartupWindow)',
		ready,
	);
	assert.ok(ready > 0);
	assert.ok(embeddedReady > ready);
	assert.ok(unlock > embeddedReady);
	assert.ok(localReady > unlock);
	assert.ok(launch > localReady);
	assert.equal(main.indexOf('await embeddedVault.unlock', 0), unlock);
});

test('canonical preload exposes only negotiated host actions and bounded server bytes', () => {
	assert.match(preload, /exposeInMainWorld\('terminayHost', bridge\)/u);
	assert.match(preload, /exposeInMainWorld\('terminayBytes', bytes\)/u);
	assert.match(preload, /parseTerminayHostContext/u);
	assert.match(preload, /parseTerminayHostActionRequest/u);
	assert.match(preload, /parseTerminayHostBytePacket/u);
	assert.doesNotMatch(preload, /terminayDiagnosticsHost|desktop:diagnostics-host/u);
});

test('Local server diagnostics are semantic and PTY data paths never call the sink', () => {
	for (const event of [
		'local-server.starting',
		'local-server.ready',
		'local-server.failed',
		'local-server.connection.failed',
		'local-server.stopping',
		'local-server.stopped',
		'local-server.terminal-congestion',
	]) {
		assert.match(main, new RegExp(`event: '${event.replaceAll('.', '\\.')}'`, 'u'));
	}
	const terminalEventStart = main.indexOf('function handleServerTerminalEvent');
	const terminalEventEnd = main.indexOf('\n}', terminalEventStart) + 2;
	assert.ok(terminalEventStart > 0 && terminalEventEnd > terminalEventStart);
	assert.doesNotMatch(
		main.slice(terminalEventStart, terminalEventEnd),
		/desktopDiagnostics/u,
	);
	const acceptedWriteStart = main.indexOf('onAcceptedWrite:');
	const acceptedResizeStart = main.indexOf('onAcceptedResize:', acceptedWriteStart);
	assert.doesNotMatch(
		main.slice(acceptedWriteStart, acceptedResizeStart),
		/desktopDiagnostics/u,
	);
	assert.doesNotMatch(authority, /desktopDiagnostics/u);
});

test('existing application logs no longer persist raw model output or microphone identity', () => {
	const parserStart = quickPush.indexOf('export function parseQuickPushPlan');
	const parserEnd = quickPush.indexOf('\nexport ', parserStart + 1);
	const parser = quickPush.slice(
		parserStart,
		parserEnd < 0 ? quickPush.length : parserEnd,
	);
	assert.doesNotMatch(parser, /console\.warn\([^)]*raw\.slice/su);
	assert.doesNotMatch(parser, /console\.warn\([^)]*json\.slice/su);
	assert.match(parser, /outputBytes/u);

	for (const privateField of [
		'requestedDeviceId:',
		'trackLabel:',
		'trackSettings:',
	]) {
		assert.equal(dictation.includes(privateField), false, privateField);
	}
});
