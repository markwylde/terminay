import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(
	new URL('../electron/main.ts', import.meta.url),
	'utf8',
);
const preload = await readFile(
	new URL('../electron/serverUiPreload.ts', import.meta.url),
	'utf8',
);
const startupLoadingDocument = await readFile(
	new URL('../electron/startupLoadingDocument.ts', import.meta.url),
	'utf8',
);
const serverDocument = await readFile(
	new URL('../server.html', import.meta.url),
	'utf8',
);
const browserHostStyles = await readFile(
	new URL('../src/web/index.css', import.meta.url),
	'utf8',
);
const authority = await readFile(
	new URL('../electron/serverTerminalAuthority.ts', import.meta.url),
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
	const startupLoading = main.indexOf(
		'loadURL(desktopStartupLoadingDocument())',
		recoveryWindow,
	);
	const workspace = main.indexOf(
		'openEmbeddedWorkspaceWithRecovery(',
		startupLoading,
	);
	const localServerConstruction = main.indexOf(
		'new ServerTerminalAuthority',
		workspace,
	);
	assert.ok(diagnosticsStart > 0);
	assert.ok(ready > diagnosticsStart);
	assert.ok(recoveryWindow > ready);
	assert.ok(startupLoading > recoveryWindow);
	assert.ok(workspace > startupLoading);
	assert.ok(localServerConstruction > workspace);
	assert.ok(
		main.indexOf('DocumentPolicyIncludeJSCallStacksInCrashReports') <
			diagnosticsStart,
	);
	assert.match(main, /crashReporter,/u);
	assert.match(
		main,
		/await embeddedStartupWindow\.loadURL\(desktopStartupLoadingDocument\(\)\)/u,
	);
	assert.doesNotMatch(
		main,
		/void embeddedStartupWindow[\s\S]{0,80}loadURL\(desktopStartupLoadingDocument\(\)\)/u,
	);
});

test('the pre-server Desktop loading document is self-contained and branded', () => {
	assert.match(startupLoadingDocument, /desktopStartupLoadingDocument/u);
	assert.match(
		startupLoadingDocument,
		/default-src 'none'; style-src 'unsafe-inline'/u,
	);
	assert.match(startupLoadingDocument, /aria-label="Starting Terminay"/u);
	assert.match(startupLoadingDocument, /<svg class="logo"/u);
	assert.match(
		startupLoadingDocument,
		/<span><\/span><span><\/span><span><\/span><span><\/span><span><\/span>/u,
	);
});

test('loading-dot motion stays in phase through the bootstrap handoff', () => {
	for (const source of [
		startupLoadingDocument,
		serverDocument,
		browserHostStyles,
	]) {
		assert.match(source, /--terminay-loading-phase/u);
	}
	assert.match(startupLoadingDocument, /Date\.now\(\) % 1600/u);
	assert.match(serverDocument, /Date\.now\(\) % 1600/u);
	assert.match(
		browserHostStyles,
		/animation-delay: var\(--terminay-loading-phase, 0ms\)/u,
	);
});

test('the verified bootstrap loader keeps the native loader’s viewport centre', () => {
	assert.match(
		serverDocument,
		/\.terminay-bootstrap-loading \{\s*box-sizing: border-box;[\s\S]*?min-height: 100vh;[\s\S]*?padding: 32px;/u,
	);
});

test('embedded vault unlock occurs after recovery setup and before Local renderer admission', () => {
	const ready = main.indexOf('async function completeDesktopStartup');
	const embeddedReady = main.indexOf('await embeddedRuntimeReady', ready);
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

test('a close while the early loading document is visible tolerates unpublished Remote services', () => {
	assert.match(main, /desktopRemoteExposure\?\.shutdown\(\)/u);
});

test('canonical preload exposes only negotiated host actions and bounded server bytes', () => {
	assert.match(preload, /exposeInMainWorld\('terminayHost', bridge\)/u);
	assert.match(preload, /exposeInMainWorld\('terminayBytes', bytes\)/u);
	assert.match(preload, /parseTerminayHostContext/u);
	assert.match(preload, /parseTerminayHostActionRequest/u);
	assert.match(preload, /parseTerminayHostBytePacket/u);
	assert.doesNotMatch(
		preload,
		/terminayDiagnosticsHost|desktop:diagnostics-host/u,
	);
});

test('Local server diagnostics are semantic and PTY data paths never call the sink', () => {
	for (const event of [
		'local-server.starting',
		'local-server.ready',
		'local-server.failed',
		'local-server.file-operation.failed',
		'local-server.stopping',
		'local-server.stopped',
		'local-server.terminal-congestion',
	]) {
		assert.match(
			main,
			new RegExp(`event: '${event.replaceAll('.', '\\.')}'`, 'u'),
		);
	}
	const terminalEventStart = main.indexOf('function handleServerTerminalEvent');
	const terminalEventEnd = main.indexOf('\n}', terminalEventStart) + 2;
	assert.ok(terminalEventStart > 0 && terminalEventEnd > terminalEventStart);
	assert.doesNotMatch(
		main.slice(terminalEventStart, terminalEventEnd),
		/desktopDiagnostics/u,
	);
	const acceptedWriteStart = main.indexOf('onAcceptedWrite:');
	const acceptedResizeStart = main.indexOf(
		'onAcceptedResize:',
		acceptedWriteStart,
	);
	assert.doesNotMatch(
		main.slice(acceptedWriteStart, acceptedResizeStart),
		/desktopDiagnostics/u,
	);
	assert.doesNotMatch(authority, /desktopDiagnostics/u);
	const fileFailureStart = main.indexOf('onFileOperationFailure:');
	const fileFailureEnd = main.indexOf(
		'// These callbacks run',
		fileFailureStart,
	);
	assert.ok(fileFailureStart > 0 && fileFailureEnd > fileFailureStart);
	const fileFailure = main.slice(fileFailureStart, fileFailureEnd);
	assert.match(fileFailure, /operation: failure\.operation/u);
	assert.match(fileFailure, /code: failure\.code/u);
	assert.doesNotMatch(fileFailure, /projectId|projectRoot|path:/u);
});

test('hosted remote pairing diagnostics are named events without pairing URLs', async () => {
	const diagnostics = await readFile(
		new URL('../electron/diagnostics/core.ts', import.meta.url),
		'utf8',
	);
	const mapper = await readFile(
		new URL('../electron/remote/hostedPairingDiagnostics.ts', import.meta.url),
		'utf8',
	);
	const host = await readFile(
		new URL(
			'../apps/terminay-server/src/remote/hostedPairingHost.ts',
			import.meta.url,
		),
		'utf8',
	);
	for (const event of [
		'local-server.remote-pairing.advertised',
		'local-server.remote-pairing.registered',
		'local-server.remote-pairing.signaling-closed',
		'local-server.remote-pairing.rotated',
		'local-server.remote-pairing.reregistered',
		'local-server.remote-pairing.client-join',
		'local-server.remote-pairing.failed',
		'local-server.remote-webrtc.peer-state',
		'local-server.remote-webrtc.ice-grace',
		'local-server.remote-webrtc.channel-state',
		'local-server.remote-webrtc.application-lane',
		'local-server.remote-webrtc.peer-closed',
	]) {
		assert.match(
			diagnostics,
			new RegExp(`'${event.replaceAll('.', '\\.')}'`, 'u'),
		);
		assert.match(mapper, new RegExp(`'${event.replaceAll('.', '\\.')}'`, 'u'));
	}
	assert.match(host, /rotateHandoff/u);
	assert.match(host, /refreshPairing\('socket-closed'\)/u);
	assert.match(host, /refreshPairing\('consumed'\)/u);
	assert.match(host, /mintPairing/u);
	assert.doesNotMatch(
		host,
		/pairingSocket\.once\('close', \(\) => \{\s*if \(!closed\) void close\(\);/u,
	);
	assert.doesNotMatch(mapper, /pairingUrl|qrSecret|relayJoinToken/u);
	assert.match(host, /createHostedStreamDiagnostics/u);
	assert.match(mapper, /stallClass: event\.stallClass/u);
	assert.match(mapper, /stallIgnored: event\.stallIgnored/u);
	assert.match(mapper, /liveGenerationCount: event\.liveGenerationCount/u);
	assert.match(mapper, /firstOutboundAgeMs: event\.firstOutboundAgeMs/u);
	assert.match(mapper, /source: stream \? 'remote-webrtc' : 'remote-pairing'/u);
});

test('application logs do not persist microphone identity', () => {
	for (const privateField of [
		'requestedDeviceId:',
		'trackLabel:',
		'trackSettings:',
	]) {
		assert.equal(dictation.includes(privateField), false, privateField);
	}
});
