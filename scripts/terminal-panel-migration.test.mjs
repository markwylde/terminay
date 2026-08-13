import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const terminalPanel = await readFile(
	new URL('../src/components/TerminalPanel.tsx', import.meta.url),
	'utf8',
);
const terminalPanelInputQueue = await readFile(
	new URL('../src/components/terminalPanelInputQueue.ts', import.meta.url),
	'utf8',
);
const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const terminalAdoptionController = await readFile(
	new URL('../src/workspace/useTerminalAdoptionController.ts', import.meta.url),
	'utf8',
);
const dockviewLifecycle = await readFile(
	new URL('../src/workspace/useDockviewPanelLifecycle.ts', import.meta.url),
	'utf8',
);
const preload = await readFile(
	new URL('../electron/preload.ts', import.meta.url),
	'utf8',
);
const main = await readFile(
	new URL('../electron/main.ts', import.meta.url),
	'utf8',
);
const dictationController = await readFile(
	new URL('../src/workspace/useDictationController.ts', import.meta.url),
	'utf8',
);

function sourceBetween(source, start, end) {
	const startIndex = source.indexOf(start);
	assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
	const endIndex = source.indexOf(end, startIndex + start.length);
	assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
	return source.slice(startIndex, endIndex);
}

const panelSetup = sourceBetween(
	terminalPanel,
	'    const panelClient = resolvedTerminalClient.panelClient',
	'    terminalPanelResizeRef.current = resizePanel',
);
const panelInteractionHelpers = sourceBetween(
	terminalPanel,
	'    const writePanelInput = (data: string) => {',
	'    terminalPanelResizeRef.current = resizePanel',
);
const serverPath = sourceBetween(
	terminalPanel,
	'    if (useServerTerminal && panelClient !== undefined && panelIdentity !== undefined && panelClientId !== undefined) {',
	'    } else {\n      // A terminal surface',
);
const unavailablePath = sourceBetween(
	terminalPanel,
	'    } else {\n      // A terminal surface',
	'    const zoomDisposer = window.terminayTerminalPresentationHost?.subscribeZoom',
);
const serverPanelCleanup = sourceBetween(
	terminalPanel,
	'    return () => {',
	'\n  }, [\n    announceTerminalFocus',
);
const dockviewPanelRemoveHandler = sourceBetween(
	dockviewLifecycle,
	'\t\tevent.api.onDidRemovePanel((panel) => {',
	'\n\n\t\tevent.api.onDidActivePanelChange(() => {',
);

const terminalApplicationIpcMethods = new Set([
	'getTerminalBuffer',
	'onTerminalData',
	'onTerminalExit',
	'writeTerminal',
	'resizeTerminal',
	'killTerminal',
]);

function legacyTerminalCalls(source) {
	return [...source.matchAll(/window\.terminay\s*\.\s*([A-Za-z0-9_]+)\s*\(/g)]
		.map(([, method]) => method)
		.filter((method) => terminalApplicationIpcMethods.has(method));
}

test('server-backed TerminalPanel routes raw stream events through xterm and the attachment', () => {
	assert.match(terminalPanel, /isTerminalHydrating/u);
	assert.match(terminalPanel, /setIsTerminalHydrating\(true\)/);
	assert.match(terminalPanel, /setIsTerminalHydrating\(false\)/);
	assert.match(terminalPanel, /className="terminal-panel-loading"/u);
	assert.match(terminalPanel, /Loading terminal…/u);
	assert.match(
		panelSetup,
		/const useServerTerminal = panelClient !== undefined && panelIdentity !== undefined && panelClientId !== undefined/,
	);
	assert.match(panelSetup, /serverInputQueue\?\.enqueue\(data\)/);
	assert.match(
		terminalPanelInputQueue,
		/await attachment\.write\(item\.data\)/,
	);
	assert.match(terminalPanelInputQueue, /MAX_PANEL_INPUT_QUEUE_BYTES/);
	assert.match(panelSetup, /void panelAttachment\.resize\(next\)/);

	assert.match(
		serverPath,
		/const mode = props\.params\.terminalClientMode \?\? 'attach'/,
	);
	assert.match(
		serverPath,
		/const request = \{[\s\S]*serverId: panelIdentity\.serverId[\s\S]*projectId: panelIdentity\.projectId[\s\S]*sessionId,[\s\S]*clientId: panelClientId/,
	);
	assert.match(serverPath, /forceResume \|\| mode === 'resume'/);
	assert.match(
		serverPath,
		/panelClient\.resume\(nextRequest\) : panelClient\.attach\(nextRequest\)/,
	);
	assert.match(serverPath, /for \(const event of attachment\.initialEvents\)/);

	assert.match(
		serverPath,
		/renderTerminalOutput\(event\.bytes, event\.nextPosition, attachment\)/,
	);
	assert.match(
		terminalPanel,
		/attachment\.ack\(nextPosition\)\.catch\(failServerTransport\)/,
	);
	assert.match(
		serverPath,
		/event\.type === 'checkpoint'[\s\S]*terminal\.resize\(event\.checkpointDimensions\.cols, event\.checkpointDimensions\.rows\)[\s\S]*await writeTerminalPresentation\(event\.bytes\)[\s\S]*renderedPositionRef\.current = event\.position/,
	);
	assert.match(
		serverPath,
		/let terminalRenderQueue = Promise\.resolve\(\)[\s\S]*event\.type === 'checkpoint_resize'[\s\S]*terminal\.resize\(event\.dimensions\.cols, event\.dimensions\.rows\)[\s\S]*event\.type === 'output'[\s\S]*await renderTerminalOutput\(event\.bytes, event\.nextPosition, attachment\)/,
	);
	assert.match(
		serverPath,
		/panelEventDisposer = \([\s\S]*\)\.onEvent\(renderServerEvent\)/,
	);
	assert.ok(
		serverPath.indexOf('.onEvent(renderServerEvent)') <
			serverPath.indexOf('for (const event of attachment.initialEvents)'),
		'the lossless catch-all listener must be installed before initial replay is consumed',
	);
	assert.match(
		serverPath,
		/attachServerTerminal\(\{ fromPosition: 0, freshPresentation: true, forceResume: true, recovery: true \}\)/,
	);
	assert.match(
		serverPath,
		/serverInputQueue = new ServerTerminalInputQueue\(failServerTransport\)/,
	);
	assert.match(
		serverPath,
		/renderTerminalExit\(event\.exitCode, event\.signal\)/,
	);
	assert.match(serverPath, /beginTerminalResync\(event\)/);
	assert.doesNotMatch(
		serverPath,
		/Terminal output history is no longer available/u,
	);
	assert.doesNotMatch(serverPath, /window\.terminay\./);
	assert.match(serverPath, /failServerTransport\(error\)/);
});

test('server-backed terminal transport stays isolated from application IPC', () => {
	assert.deepEqual(
		legacyTerminalCalls(serverPath),
		[],
		'the server-backed panel must not regress to terminal preload methods',
	);
	assert.match(serverPath, /serverInputQueue\?\.attach\(attachment\)/);
	assert.match(
		serverPath,
		/props\.api\.isActive[\s\S]*activeElement === document\.body[\s\S]*root\.contains\(activeElement\)[\s\S]*terminal\.focus\(\)/,
	);
	assert.match(serverPath, /attachment\.resize\(/);
	assert.match(serverPath, /\.onEvent\(renderServerEvent\)/);
	assert.match(serverPath, /attachment\.detach\(/);
	assert.doesNotMatch(serverPath, /compatibility replay/u);
	assert.doesNotMatch(
		serverPath,
		/getTerminalBuffer|onTerminalData|onTerminalExit/u,
	);
});

test('connected terminal pointerdown does not override xterm focus or selection', () => {
	assert.doesNotMatch(terminalPanel, /activatePanelFromPointer/u);
	assert.doesNotMatch(
		terminalPanel,
		/root\.addEventListener\('pointerdown', [^)]*focus/u,
	);
	assert.doesNotMatch(
		terminalPanel,
		/root\.addEventListener\('pointerdown', [^)]*setActive/u,
	);
});

test('server-backed input and resize fail closed without terminal application IPC', () => {
	assert.match(
		panelInteractionHelpers,
		/if \(!useServerTerminal \|\| serverAttachmentFailed \|\| !terminalPresentationControllerRef\.current\) return/,
	);
	assert.match(panelInteractionHelpers, /serverInputQueue\?\.enqueue\(data\)/);
	assert.match(panelInteractionHelpers, /panelAttachment\.resize\(next\)/);
	assert.deepEqual(
		[...new Set(legacyTerminalCalls(panelInteractionHelpers))],
		[],
	);

	const resizeEffect = sourceBetween(
		terminalPanel,
		'      const useServerTerminal =\n        resolvedTerminalClient.panelClient !== undefined',
		'  }, [props.params.color',
	);
	assert.match(
		resizeEffect,
		/if \(useServerTerminal\) \{\s+terminalPanelResizeRef\.current\(/,
	);
	assert.doesNotMatch(resizeEffect, /window\.terminay\.resizeTerminal/);
});

test('presentation ownership stays silent for controllers and exposes every read-only recovery state', () => {
	assert.match(
		terminalPanel,
		/terminalPresentation\?\.role === 'read_only' && !presentationUnavailable/,
	);
	assert.match(
		terminalPanel,
		/Another device is controlling this terminal\./,
	);
	assert.match(terminalPanel, /No device currently controls this terminal\./);
	assert.match(terminalPanel, /currentPresentation\.holder === undefined \? 'acquire' : 'takeover'/);
	assert.match(terminalPanel, /Take control/);
	assert.match(terminalPanel, /Take back control/);
	assert.doesNotMatch(terminalPanel, />Terminal controller</);
	assert.doesNotMatch(terminalPanel, />Terminal read-only</);
	assert.match(
		panelInteractionHelpers,
		/pendingPanelResize = \{ cols, rows \}[\s\S]*panelAttachment !== null && terminalPresentationControllerRef\.current/,
	);
	assert.match(serverPath, /if \(becameController\) fitAndResize\(true\)/);
});

test('clipboard paste remains on xterm input and tolerates a clipboard read failure', () => {
	const pasteShortcut = sourceBetween(
		terminalPanel,
		'      if (isPasteShortcut) {',
		'      const terminalSwitcherDirection = getTerminalSwitcherDirection(event)',
	);

	assert.match(
		pasteShortcut,
		/window\.terminayClipboardHost\?\.readText\(\)\s*\?\?\s*Promise\.resolve\(''\)/u,
	);
	assert.match(
		pasteShortcut,
		/paste:\s*\(text\)\s*=>\s*terminal\.paste\(text\)/u,
	);
	assert.match(pasteShortcut, /focus:\s*\(\)\s*=>\s*terminal\.focus\(\)/u);
	assert.doesNotMatch(pasteShortcut, /window\.terminay\.writeTerminal/u);

	const xtermInput = sourceBetween(
		terminalPanel,
		'    const dataDisposer = terminal.onData((data) => {',
		'    const resizeDisposer = props.api.onDidDimensionsChange',
	);
	assert.match(xtermInput, /writePanelInput\(data\)/u);
});

test('explorer path drops use the same server-backed input queue and ignore other sessions', () => {
	const dropHandler = sourceBetween(
		terminalPanel,
		'    const handleExplorerPathDrop = (event: Event) => {',
		'    const resizeObserver = new ResizeObserver',
	);
	assert.match(dropHandler, /customEvent\.detail\?\.sessionId !== sessionId/u);
	assert.match(dropHandler, /!customEvent\.detail\.path/u);
	assert.match(
		dropHandler,
		/writePanelInput\(`\$\{escapeTerminalPathForShell\(customEvent\.detail\.path\)\} `\)/u,
	);
	assert.match(dropHandler, /terminal\.focus\(\)/u);
	assert.doesNotMatch(dropHandler, /window\.terminay\.writeTerminal/u);
	assert.match(panelInteractionHelpers, /serverInputQueue\?\.enqueue\(data\)/u);
});

test('server-backed dictation input uses the exact panel attachment queue', () => {
	const panelInputHandler = sourceBetween(
		terminalPanel,
		'    const handlePanelInput = (event: Event) => {',
		'    const dragListenerOptions = { capture: true } as const',
	);
	const dictationInsert = sourceBetween(
		dictationController,
		'\tconst insertTranscript = useCallback(',
		'\n\n\tconst startDictation = useCallback',
	);

	assert.match(panelInputHandler, /detail\?\.sessionId !== sessionId/u);
	assert.match(panelInputHandler, /typeof detail\.data !== 'string'/u);
	assert.match(panelInputHandler, /writePanelInput\(detail\.data\)/u);
	assert.doesNotMatch(panelInputHandler, /window\.terminay\.writeTerminal/u);
	assert.match(
		terminalPanel,
		/window\.addEventListener\(TERMINAL_PANEL_INPUT_EVENT, handlePanelInput\)/u,
	);
	assert.match(
		terminalPanel,
		/window\.removeEventListener\(TERMINAL_PANEL_INPUT_EVENT, handlePanelInput\)/u,
	);

	assert.match(
		dictationInsert,
		/sendTerminalInput\(sessionId, formatDictationTranscriptForTerminal\(transcript\)\)/u,
	);
	assert.doesNotMatch(dictationInsert, /window\.terminay\.writeTerminal/u);
	assert.match(app, /sendTerminalInput: sendTerminalPanelInput/u);
});

test('server-backed panel teardown detaches the exact attachment without killing the session', () => {
	assert.match(serverPanelCleanup, /serverInputQueue\?\.close\(\)/);
	assert.match(
		serverPanelCleanup,
		/const attachmentToDetach = panelAttachment/,
	);
	assert.match(serverPanelCleanup, /panelAttachment = null/);
	assert.match(serverPanelCleanup, /attachmentToDetach\.detach\(\)/);
	assert.doesNotMatch(serverPanelCleanup, /attachmentToDetach\.kill\(/);
	assert.doesNotMatch(serverPanelCleanup, /window\.terminay\.killTerminal\(/);
});

test('Dockview panel removal detaches without terminal application IPC', () => {
	assert.match(
		dockviewPanelRemoveHandler,
		/const isMoving =\s+latest\.movingTerminalSessionIdsRef\.current\.delete\(sessionId\)/,
	);
	assert.match(
		dockviewPanelRemoveHandler,
		/if \(!isMoving\) latest\.cancelMacroRunsForSession\(sessionId\)/,
	);
	assert.match(
		dockviewPanelRemoveHandler,
		/if \(!isMoving\) latest\.closeServerPanel\?\.\(panel\.id\)/,
	);
	assert.match(
		dockviewPanelRemoveHandler,
		/latest\.closeServerPanel\?\.\(panel\.id\)/,
	);
	assert.match(
		dockviewPanelRemoveHandler,
		/latest\.clearActivitySession\(sessionId\)/,
	);
	assert.doesNotMatch(
		dockviewPanelRemoveHandler,
		/window\.terminay\.killTerminal/,
	);
});

test('server-owned terminal panels keep the server panel id through close', () => {
	assert.match(
		terminalAdoptionController,
		/const panelId = movedTerminal\.panelId \?\? `terminal-\$\{terminalCounterRef\.current\}`/,
	);
		assert.match(
			terminalAdoptionController,
			/acceptServerTerminal = useCallback\(\s*\(\s*panelId: string,\s*sessionId: string,\s*title\?: string,\s*cwd\?: string\s*\)/,
		);
		assert.match(terminalAdoptionController, /cwd: movedTerminal\.cwd/);
		assert.match(
			terminalAdoptionController,
			/cwd,\s*\n\s*panelId,\s*\n\s*serverProjectId: project\.id,\s*\n\s*sessionId,/,
		);
		assert.match(app, /acceptServerTerminal\(\s*serverPanel\.id,\s*session\.id,\s*serverPanel\.title,\s*serverPanel\.cwd,\s*\)/);
		assert.match(app, /workspace\.acceptServerTerminal\(\s*panel\.id,\s*session\.id,\s*panel\.title,\s*panel\.cwd,\s*\)/);
		assert.match(terminalPanel, /MAX_INITIAL_SERVER_TERMINAL_REPLAY_BYTES = 32 \* 1024/);
		assert.match(terminalPanel, /maxInitialReplayBytes: MAX_INITIAL_SERVER_TERMINAL_REPLAY_BYTES/);
		assert.match(terminalPanel, /freshPresentation: true/);
		assert.match(terminalPanel, /complete safe recovery boundary is no longer retained/);
	assert.match(app, /const panel = store\?\.snapshot\?\.panels\[panelId\]/);
	assert.match(app, /void store\.closePanel\(panelId\)/);
	assert.doesNotMatch(app, /pending:\$\{sessionId\}/);
});

test('the unavailable panel state and Electron bridge cannot recreate terminal IPC', () => {
	assert.match(unavailablePath, /server terminal client is unavailable/);
	const forbiddenBridge =
		/window\.terminay\.(?:getTerminalCwd|getTerminalBuffer|onTerminalData|onTerminalExit|writeTerminal|resizeTerminal|killTerminal)/u;
	assert.doesNotMatch(terminalPanel, forbiddenBridge);
	assert.doesNotMatch(app, forbiddenBridge);
	assert.doesNotMatch(
		preload,
		/(?:getTerminalCwd|getTerminalBuffer|onTerminalData|onTerminalExit|writeTerminal|resizeTerminal|killTerminal):/u,
	);
	assert.doesNotMatch(
		main,
		/terminal:(?:get-cwd|get-buffer|write|resize|kill)/u,
	);
});
