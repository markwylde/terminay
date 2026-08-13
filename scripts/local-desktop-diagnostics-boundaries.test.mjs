import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
const preload = await readFile(
	new URL('../electron/preload.ts', import.meta.url),
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

test('diagnostics, Crashpad, and hang stack collection initialize before Local server and renderers', () => {
	const diagnosticsStart = main.indexOf('await initializeDesktopDiagnostics');
	const localServerConstruction = main.indexOf(
		'new ServerTerminalAuthority',
		diagnosticsStart,
	);
	const ready = main.indexOf('app.whenReady()');
	assert.ok(diagnosticsStart > 0);
	assert.ok(localServerConstruction > diagnosticsStart);
	assert.ok(ready > localServerConstruction);
	assert.ok(
		main.indexOf('DocumentPolicyIncludeJSCallStacksInCrashReports') <
			diagnosticsStart,
	);
	assert.match(main, /crashReporter,/u);
});

test('embedded vault unlock occurs after Electron readiness and before Local server admission', () => {
	const ready = main.indexOf('app.whenReady().then');
	const unlock = main.indexOf('await embeddedVault.unlock', ready);
	const localReady = main.indexOf("event: 'local-server.ready'", ready);
	const firstWindow = main.indexOf('createWindow();', ready);
	assert.ok(ready > 0);
	assert.ok(unlock > ready);
	assert.ok(localReady > unlock);
	assert.ok(firstWindow > localReady);
	assert.equal(main.indexOf('await embeddedVault.unlock', 0), unlock);
});

test('renderer root reporting is a narrow versioned and trusted semantic channel', () => {
	assert.match(
		preload,
		/contextBridge\.exposeInMainWorld\(\s*'terminayDiagnosticsHost'/u,
	);
	assert.match(
		preload,
		/'desktop:diagnostics-host:report-root-error'/u,
	);
	assert.doesNotMatch(
		preload,
		/terminayDiagnosticsHost[\s\S]{0,800}(?:readFile|writeFile|openPath|clear|reveal)/u,
	);
	const handler = main.slice(
		main.indexOf("'desktop:diagnostics-host:report-root-error'"),
		main.indexOf("app.on('browser-window-created'"),
	);
	assert.match(handler, /assertTrustedAppSender\(event\)/u);
	assert.match(handler, /rendererRootDiagnosticKeys/u);
	assert.match(handler, /event: 'renderer.root-error'/u);
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

test('terminal recovery diagnostics are metadata-only and trusted', () => {
	assert.match(preload, /reportTerminalRecovery/u);
	assert.match(preload, /desktop:diagnostics-host:report-terminal-recovery/u);
	assert.match(main, /terminal\.recovery\.recovered/u);
	const handlerStart = main.indexOf("'desktop:diagnostics-host:report-terminal-recovery'");
	const handlerEnd = main.indexOf("app.on('browser-window-created'", handlerStart);
	const handler = main.slice(handlerStart, handlerEnd);
	assert.match(handler, /assertTrustedAppSender\(event\)/u);
	for (const forbidden of ['sessionId', 'projectId', 'terminalTitle', 'bytes', 'outputText']) assert.equal(handler.includes(forbidden), false, forbidden);
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
