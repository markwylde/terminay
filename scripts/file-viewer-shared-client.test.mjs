import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const bundleDirectory = await mkdtemp(
	path.join(os.tmpdir(), 'terminay-file-viewer-client-'),
);

await build({
	bundle: true,
	entryPoints: {
		capabilities: 'src/services/fileViewer/capabilities.ts',
		serverFileGateway: 'src/services/fileViewer/serverFileGateway.ts',
		sharedDraftTransition:
			'src/components/file-viewer/modes/sharedDraftTransition.ts',
		terminayFileGateway: 'src/services/fileViewer/terminayFileGateway.ts',
	},
	format: 'cjs',
	logLevel: 'silent',
	outdir: bundleDirectory,
	platform: 'node',
});

const { createTerminayFileGateway } = require(
	path.join(bundleDirectory, 'terminayFileGateway.js'),
);
const { createServerFileGateway, toProjectRelativePath } = require(
	path.join(bundleDirectory, 'serverFileGateway.js'),
);
const {
	MAX_MONACO_FILE_BYTES,
	detectFileCapabilities,
	isFileViewerModeAvailable,
	resolveFileViewerEngine,
	resolveFileViewerMode,
} = require(path.join(bundleDirectory, 'capabilities.js'));
const { materializeCanonicalPerformantDraft } = require(
	path.join(bundleDirectory, 'sharedDraftTransition.js'),
);

test.after(async () => {
	await rm(bundleDirectory, { force: true, recursive: true });
});

test('workspace directory listing uses the shared FileViewerClient boundary', async () => {
	const [app, controller, adapter] = await Promise.all([
		readFile('src/App.tsx', 'utf8'),
		readFile('src/workspace/useFileExplorerController.ts', 'utf8'),
		readFile('src/services/fileViewer/legacyFileViewerTransport.ts', 'utf8'),
	]);
	assert.match(
		app,
		/useFileExplorerController\(\{[\s\S]*?fileViewerClient,[\s\S]*?isServerFileViewer:\s*serverFileViewerClient !== undefined,/,
	);
	assert.match(
		controller,
		/fileViewerClient\.listFolder\(\s*clientPath\(dirPath\),\s*clientProjectId,/,
	);
	assert.doesNotMatch(controller, /window\.terminay\.listDirectory/);
	assert.match(adapter, /operation === 'files\.list'/);
	assert.match(adapter, /api\.listDirectory\(path\)/);
	assert.match(
		controller,
		/fileViewerClient\.renameEntry\(\s*clientPath\(oldPath\),\s*clientPath\(`\$\{parent\}\$\{next\}`\),\s*clientProjectId,/,
	);
	assert.match(
		controller,
		/fileViewerClient\.deleteEntry\(\s*clientPath\(path\),\s*true,\s*clientProjectId,/,
	);
	assert.match(
		controller,
		/fileViewerClient\.createDirectory\(\s*clientPath\(joinPath\(dirPath, name\)\),\s*clientProjectId,/,
	);
	assert.match(
		controller,
		/fileViewerClient\.createFile\(\s*clientPath\(path\),\s*new Uint8Array\(\),\s*clientProjectId,/,
	);
	assert.match(app, /fileViewerClient\s*\.searchFolder\(/);
	assert.doesNotMatch(
		controller,
		/window\.terminay\.(?:renameEntry|deleteEntry|mkdir)/,
	);
});

test('FilePanel gateway uses validated shared capabilities for deterministic mode selection', async () => {
	const calls = [];
	globalThis.window = {
		terminay: {
			async getFileInfo(filePath) {
				return {
					birthtimeMs: null,
					ctimeMs: null,
					exists: true,
					extension: '.txt',
					ino: 7,
					isDirectory: false,
					isFile: true,
					isSymbolicLink: false,
					mtimeMs: 10,
					name: 'notes.txt',
					path: filePath,
					size: 12,
				};
			},
		},
	};

	const gateway = createTerminayFileGateway(globalThis.window.terminay, {
		async getCapabilities(filePath) {
			calls.push(filePath);
			return {
				relativePath: filePath,
				size: 12,
				mtimeMs: 11,
				previewKind: 'text',
				preferredMode: 'text',
				isBinary: false,
				isLargeFile: false,
				safePreview: false,
				canEditText: true,
				canEditHex: true,
				inspectedBytes: 12,
				inspectionTruncated: false,
			};
		},
	});

	const file = await gateway.getFileInfo('/workspace/notes.txt');
	assert.deepEqual(calls, ['/workspace/notes.txt']);
	assert.equal(file.viewerCapabilities.preferredMode, 'text');
	assert.equal(file.mtimeMs, 11);
	assert.equal(detectFileCapabilities(file).defaultMode, 'text');
});

test('legacy Electron metadata is translated through the real FileViewerClient contract', async () => {
	globalThis.window = {
		terminay: {
			async getFileInfo(filePath) {
				return {
					birthtimeMs: null,
					ctimeMs: null,
					exists: true,
					extension: '.md',
					ino: 8,
					isDirectory: false,
					isFile: true,
					isSymbolicLink: false,
					mtimeMs: 20,
					name: 'README.md',
					path: filePath,
					size: 24,
				};
			},
		},
	};

	const file = await createTerminayFileGateway(
		globalThis.window.terminay,
	).getFileInfo('/workspace/README.md');
	assert.equal(file.viewerCapabilities.previewKind, 'markdown');
	assert.equal(detectFileCapabilities(file).defaultMode, 'preview');
});

test('connected FilePanel reads use canonical server paths and never preload file reads', async () => {
	const calls = [];
	let legacyRead = 0;
	let watchListener;
	let stoppedWatch;
	const gateway = createServerFileGateway({
		client: {
			async getCapabilities(path, projectId) {
				calls.push(['capabilities', path, projectId]);
				return {
					relativePath: path,
					size: 5,
					mtimeMs: 42,
					previewKind: 'text',
					preferredMode: 'text',
					isBinary: false,
					isLargeFile: false,
					safePreview: true,
					canEditText: true,
					canEditHex: true,
					inspectedBytes: 5,
					inspectionTruncated: false,
				};
			},
			async readContentRange(path, offset, length, projectId) {
				calls.push(['range', path, offset, length, projectId]);
				return {
					bytes: new TextEncoder()
						.encode('hello')
						.slice(offset, offset + length),
					truncated: false,
				};
			},
		},
		observationClient: {
			async startWatch(projectId, resource) {
				calls.push(['watch-start', projectId, resource]);
				return { cursor: 0, projectId, resource, subscriptionId: 'watch-a' };
			},
			async subscribeWatch(_handle, listener) {
				watchListener = listener;
				return () => {};
			},
			async stopWatch(subscriptionId) {
				stoppedWatch = subscriptionId;
			},
		},
		projectId: 'project-a',
		projectRoot: '/workspace/project-a',
		compatibilityGateway: {
			aggregateFolderMarkdownTasks: async () => {
				throw new Error('unexpected legacy task call');
			},
			getFileDiff: async () => {
				throw new Error('unexpected legacy diff call');
			},
			getFileInfo: async () => {
				legacyRead += 1;
				throw new Error('unexpected preload metadata call');
			},
			getGitRepoInfo: async () => ({ canDiff: false }),
			getPreviewSource: async () => null,
			onFileWatchEvent: () => () => {},
			readFileBytes: async () => {
				legacyRead += 1;
				throw new Error('unexpected preload byte read');
			},
			readFileText: async () => {
				legacyRead += 1;
				throw new Error('unexpected preload text read');
			},
			readFileTextWindow: async () => {
				legacyRead += 1;
				throw new Error('unexpected preload text-window read');
			},
			saveFile: async () => {
				throw new Error('unexpected legacy save call');
			},
			unwatchFile: async () => {},
			watchFile: async () => {},
		},
	});

	const info = await gateway.getFileInfo(
		'/workspace/project-a/docs/readme.txt',
	);
	const text = await gateway.readFileText(
		'/workspace/project-a/docs/readme.txt',
	);
	const watchEvents = [];
	const removeWatchListener = gateway.onFileWatchEvent((event) =>
		watchEvents.push(event),
	);
	await gateway.watchFile('/workspace/project-a/docs/readme.txt');
	watchListener({
		kind: 'changed',
		projectId: 'project-a',
		resource: 'docs/readme.txt',
		sequence: 1,
	});
	await new Promise((resolve) => setTimeout(resolve, 0));
	await gateway.unwatchFile('/workspace/project-a/docs/readme.txt');
	removeWatchListener();
	assert.equal(info.path, '/workspace/project-a/docs/readme.txt');
	assert.equal(info.name, 'readme.txt');
	assert.equal(text, 'hello');
	assert.deepEqual(calls, [
		['capabilities', 'docs/readme.txt', 'project-a'],
		['capabilities', 'docs/readme.txt', 'project-a'],
		['range', 'docs/readme.txt', 0, 5, 'project-a'],
		['watch-start', 'project-a', 'docs/readme.txt'],
		['capabilities', 'docs/readme.txt', 'project-a'],
	]);
	assert.equal(stoppedWatch, 'watch-a');
	assert.equal(watchEvents[0]?.type, 'updated');
	assert.equal(legacyRead, 0);
});

test('canonical Monaco handoff orders concurrent chunks and preserves split UTF-8 plus sparse overlays', async () => {
	const boundary = 2 * 1024 * 1024;
	const source = new Uint8Array(boundary + 32).fill('a'.charCodeAt(0));
	const snow = new TextEncoder().encode('雪');
	source.set(snow, boundary - 1);
	let active = 0;
	let peakActive = 0;
	const calls = [];
	const draft = await materializeCanonicalPerformantDraft(
		{
			async readContentRange(path, offset, length, projectId, { signal }) {
				active += 1;
				peakActive = Math.max(peakActive, active);
				calls.push([path, offset, length, projectId]);
				await new Promise((resolve, reject) => {
					const timer = setTimeout(resolve, offset === 0 ? 8 : 0);
					signal.addEventListener(
						'abort',
						() => {
							clearTimeout(timer);
							reject(signal.reason);
						},
						{ once: true },
					);
				});
				active -= 1;
				return { bytes: source.slice(offset, offset + length) };
			},
		},
		'large.txt',
		'project-a',
		source.byteLength,
		[
			{
				dataBase64: Buffer.from('XYZ').toString('base64'),
				start: boundary + 4,
				end: boundary + 7,
			},
		],
		new AbortController().signal,
	);
	assert.ok(peakActive > 1);
	assert.ok(peakActive <= 2);
	assert.deepEqual(
		calls.map((call) => call[1]),
		[0, boundary],
	);
	assert.match(draft.originalText.slice(boundary - 1, boundary + 2), /^雪/u);
	assert.match(draft.text.slice(boundary - 2, boundary + 8), /雪aaXYZ/u);
	assert.equal(draft.dirty, true);
});

test('canonical Monaco handoff cancels every in-flight range worker', async () => {
	const controller = new AbortController();
	const materializing = materializeCanonicalPerformantDraft(
		{
			readContentRange(_path, _offset, _length, _projectId, { signal }) {
				return new Promise((_resolve, reject) => {
					signal.addEventListener('abort', () => reject(signal.reason), {
						once: true,
					});
				});
			},
		},
		'large.txt',
		'project-a',
		2 * 1024 * 1024,
		[],
		controller.signal,
	);
	controller.abort(new Error('cancelled'));
	await assert.rejects(materializing, /cancelled/u);
	await assert.rejects(
		materializeCanonicalPerformantDraft(
			{ readContentRange: async () => assert.fail('must remain bounded') },
			'too-large.txt',
			'project-a',
			128 * 1024 * 1024 + 1,
			[],
			new AbortController().signal,
		),
		/bounded Monaco materialization limit/u,
	);
	const transition = await readFile(
		'src/components/file-viewer/modes/sharedDraftTransition.ts',
		'utf8',
	);
	assert.match(transition, /const MONACO_RANGE_CONCURRENCY = 2/u);
	assert.match(
		transition,
		/const MONACO_RANGE_BYTES = MAX_FILE_CONTENT_RANGE_BYTES/u,
	);
	assert.equal(Math.ceil((101 * 1024 * 1024) / (2 * 1024 * 1024)), 51);
	const base64RangeBytes = 4 * Math.ceil((2 * 1024 * 1024) / 3);
	assert.ok(base64RangeBytes < 8 * 1024 * 1024 - 64 * 1024 - 14);
	assert.ok(base64RangeBytes * 4 < 16 * 1024 * 1024);
	assert.match(
		transition,
		/operationController\.abort\(error\);\s*await Promise\.allSettled\(pending\);/u,
	);
	assert.match(
		transition,
		/batchStart \+= MONACO_RANGE_CONCURRENCY[\s\S]*?baselineDecoder\.decode\(\)[\s\S]*?projectedDecoder\.decode\(\)/u,
	);
});

test('connected FilePanel path conversion rejects paths outside the selected project', () => {
	assert.equal(
		toProjectRelativePath(
			'/workspace/project-a',
			'/workspace/project-a/docs/readme.txt',
		),
		'docs/readme.txt',
	);
	assert.equal(
		toProjectRelativePath('/workspace/project-a', 'docs/readme.txt'),
		'docs/readme.txt',
	);
	assert.throws(
		() =>
			toProjectRelativePath(
				'/workspace/project-a',
				'/workspace/other/secret.txt',
			),
		/outside the project root/,
	);
	assert.throws(
		() => toProjectRelativePath('/workspace/project-a', '../secret.txt'),
		/outside the project root/,
	);
});

test('server-denied viewer modes are unavailable and resolve to the bounded fallback', () => {
	const capabilities = detectFileCapabilities({
		birthtimeMs: null,
		ctimeMs: null,
		exists: true,
		extension: '.bin',
		ino: 9,
		isBinary: true,
		isDirectory: false,
		isFile: true,
		isLargeFile: false,
		isSymbolicLink: false,
		mimeType: 'application/octet-stream',
		mtimeMs: 30,
		name: 'archive.bin',
		path: '/workspace/archive.bin',
		size: 12,
		viewerCapabilities: {
			canEditHex: true,
			canEditText: false,
			inspectedBytes: 12,
			inspectionTruncated: false,
			isBinary: true,
			isLargeFile: false,
			preferredMode: 'hex',
			previewKind: 'hex',
			relativePath: 'archive.bin',
			safePreview: false,
			size: 12,
		},
	});

	assert.equal(isFileViewerModeAvailable(capabilities, 'hex'), true);
	assert.equal(isFileViewerModeAvailable(capabilities, 'text'), false);
	assert.equal(isFileViewerModeAvailable(capabilities, 'preview'), false);
	assert.equal(resolveFileViewerMode(capabilities, 'text'), 'hex');
	assert.equal(resolveFileViewerMode(capabilities, 'preview'), 'hex');
});

test('large text chooser offers Monaco only inside the bounded rich-editor budget', () => {
	const largeText = (size) => ({
		birthtimeMs: null,
		ctimeMs: null,
		exists: true,
		extension: '.txt',
		ino: 10,
		isBinary: false,
		isDirectory: false,
		isFile: true,
		isLargeFile: size > 100 * 1024 * 1024,
		isSymbolicLink: false,
		mimeType: 'text/plain',
		mtimeMs: 40,
		name: 'large.txt',
		path: '/workspace/large.txt',
		size,
	});

	const chooserFile = largeText(100 * 1024 * 1024 + 1);
	const chooserCapabilities = detectFileCapabilities(chooserFile);
	assert.equal(chooserCapabilities.canUseMonaco, true);
	assert.equal(chooserCapabilities.shouldPromptForEngineChoice, true);
	assert.equal(
		resolveFileViewerEngine(chooserFile, chooserCapabilities, 'auto'),
		'auto',
	);

	const rangedFile = largeText(MAX_MONACO_FILE_BYTES + 1);
	const rangedCapabilities = detectFileCapabilities(rangedFile);
	assert.equal(rangedCapabilities.canUseMonaco, false);
	assert.equal(rangedCapabilities.shouldPromptForEngineChoice, false);
	assert.equal(
		resolveFileViewerEngine(rangedFile, rangedCapabilities, 'auto'),
		'performant',
	);
	assert.equal(
		resolveFileViewerEngine(rangedFile, rangedCapabilities, 'monaco'),
		'performant',
	);
});

test('Monaco uses the bundled runtime under the renderer content-security policy', async () => {
	const viewer = await readFile(
		'src/components/file-viewer/modes/TextViewer.tsx',
		'utf8',
	);
	assert.match(
		viewer,
		/import Editor, \{ loader \} from '@monaco-editor\/react'/u,
	);
	assert.match(viewer, /import \* as monaco from 'monaco-editor'/u);
	assert.match(viewer, /loader\.config\(\{ monaco \}\)/u);
	assert.match(viewer, /Object\.assign\(window, \{ monaco \}\)/u);
});

test('connected performant text windows stay bounded and cancellable on the canonical client', async () => {
	const viewer = await readFile(
		'src/components/file-viewer/modes/PerformantTextViewer.tsx',
		'utf8',
	);
	assert.match(viewer, /toProjectRelativePath\(projectRoot, filePath\)/u);
	assert.match(
		viewer,
		/getServerTextMetadata\(\s*canonicalFilePath,\s*projectId,/u,
	);
	assert.match(
		viewer,
		/readCanonicalTextPage\(\s*fileViewerClient,\s*canonicalFilePath,\s*projectId,\s*page,/u,
	);
	assert.match(
		viewer,
		/client\.readServerTextLines\(\s*filePath,\s*requestedStartLine,\s*PAGE_LINES,\s*projectId,\s*\{ signal \},?\s*\)/u,
	);
	assert.match(viewer, /if \(result\.windowComplete\) \{\s*return result;/u);
	assert.match(viewer, /if \(signal\.aborted\) \{\s*throw signal\.reason;/u);
	assert.match(
		viewer,
		/attempt < MAX_WINDOW_INDEX_ATTEMPTS[\s\S]*?INDEX_CONTINUATION_DELAY_MS/u,
	);
	assert.match(viewer, /controller\.abort\(\)/u);
	assert.doesNotMatch(viewer, /averageLineBytes|estimatedOffset/u);
	assert.doesNotMatch(viewer, /estimateCanonicalTextMetadata/u);
	assert.doesNotMatch(viewer, /client\.readContentText\(/u);
	assert.match(
		viewer,
		/fileViewerClient\.readTextLines\(\s*filePath,\s*projectRoot,/u,
	);
	assert.match(viewer, /const reservedPages = new Map<number, symbol>\(\)/u);
	assert.match(
		viewer,
		/for \(const \[page, reservation\] of reservedPages\) \{\s*if \(loadingPagesRef\.current\.get\(page\) === reservation\) \{\s*loadingPagesRef\.current\.delete\(page\);\s*\}\s*\}\s*controller\.abort\(\)/u,
	);
	assert.match(
		viewer,
		/generationRef\.current === generation &&\s*!controller\.signal\.aborted/u,
	);
	assert.match(
		viewer,
		/generationRef\.current !== generation \|\|\s*controller\.signal\.aborted/u,
	);
	assert.ok(
		viewer.indexOf('const nextPage = toTextPage(page, [...result.lines]);') <
			viewer.indexOf('loadedPagesRef.current.add(page);'),
		'an empty or aborted ranged response must not poison the loaded-page cache',
	);
	assert.match(
		viewer,
		/generationRef\.current === generation &&\s*visiblePages\.includes\(page\) &&\s*!loadedPagesRef\.current\.has\(page\) &&\s*!loadingPagesRef\.current\.has\(page\)[\s\S]*?setPageRequestVersion\(\(version\) => version \+ 1\)/u,
	);
	assert.match(viewer, /pageRequestVersion,\s*projectId,/u);
});

test('FilePanel preserves an explicit large-file engine choice and does not throttle canonical watch events', async () => {
	const panel = await readFile(
		'src/components/file-viewer/FilePanel.tsx',
		'utf8',
	);
	assert.match(
		panel,
		/engineRef\.current === 'auto' \? preferredEngine : engineRef\.current/u,
	);
	assert.ok(
		panel.indexOf("engineRef.current = 'monaco';") <
			panel.indexOf("setEngine('monaco');"),
		'the large-file handoff must latch Monaco before its React transition',
	);
	const monacoHandoff = panel.slice(
		panel.indexOf('const handleSwitchToMonaco'),
		panel.indexOf('useEffect(() =>', panel.indexOf('const handleSwitchToMonaco')),
	);
	assert.doesNotMatch(
		monacoHandoff,
		/sparseEditsRef\.current = new Map|setSparseEdits\(new Map/u,
		'the sparse journal remains the bounded save authority after Monaco hydration',
	);
	assert.match(
		panel,
		/acknowledgedWatchRevisionRef\.current = \{\s*mtimeMs: nextInfo\.mtimeMs,\s*path: nextInfo\.path,\s*size: nextInfo\.size,/u,
	);
	assert.ok(
		panel.indexOf(
			'const acknowledged = acknowledgedWatchRevisionRef.current;',
		) < panel.indexOf('if (isDirtyRef.current)'),
		'an acknowledged own-save watch revision must be consumed before conflict classification',
	);
	assert.match(
		panel,
		/onChoose=\{\(choice\) => \{\s*engineRef\.current = choice;\s*setEngine\(choice\)/u,
	);
	assert.match(
		panel,
		/refreshTimeoutId = window\.setTimeout\(\(\) => runRefresh\(true\), 0\)/u,
	);
	assert.doesNotMatch(panel, /elapsedSinceLastRefresh/u);
});

test('Desktop file observation treats every atomic inode replacement as authoritative', async () => {
	const watcher = await readFile(
		'electron/fileViewer/fileWatchService.ts',
		'utf8',
	);
	assert.match(watcher, /const directoryPath = path\.dirname\(resolvedPath\)/u);
	assert.match(watcher, /watch\(directoryPath,\s*\{ persistent: false \}/u);
	assert.match(watcher, /ino: info\.ino/u);
	assert.match(
		watcher,
		/left\.ino === right\.ino/u,
		'consecutive same-size, same-mtime atomic saves must not be coalesced away',
	);
});

test('connected sparse saves fail closed instead of using disconnected preload revision authority', async () => {
	const panel = await readFile(
		'src/components/file-viewer/FilePanel.tsx',
		'utf8',
	);
	assert.match(
		panel,
		/const activeDisconnectedFilePanelCompatibility =\s*terminalClientContext === null \? disconnectedFilePanelCompatibility : null/u,
	);
	assert.match(
		panel,
		/currentFileInfo\.ino === null \|\| currentFileInfo\.mtimeMs === null\s*\?\s*await activeDisconnectedFilePanelCompatibility\?\.getMutationRevision\(\s*currentFileInfo\.path,\s*\)/u,
	);
	assert.match(panel, /const expectedIno = mutationRevision\.ino/u);
	assert.match(panel, /const expectedMtimeMs = mutationRevision\.mtimeMs/u);
	assert.match(panel, /expectedSize: mutationRevision\.size/u);
	assert.doesNotMatch(panel, /compatibilityGateway: disconnectedFilePanelCompatibility/u);
	assert.doesNotMatch(panel, /window\.terminay\b/u);
});

test('connected FolderPanel derives size and refresh state from the server file client', async () => {
	const panel = await readFile(
		'src/components/folder-viewer/FolderPanel.tsx',
		'utf8',
	);
	assert.match(panel, /async function observeServerFolderSize\(/u);
	assert.match(panel, /client\.startFolderSize\(/u);
	assert.match(panel, /client\s*\.subscribeFolderSize\(/u);
	assert.match(panel, /fileObservationClient!\s*\.startWatch\(/u);
	assert.match(panel, /fileObservationClient!\s*\.subscribeWatch\(/u);
	assert.doesNotMatch(panel, /terminayFileExplorerHost/u);
	assert.match(
		panel,
		/if \(terminalClientContext !== null\) return undefined;\s*return disconnectedFileCompatibility\?\.folderPanel\.createClient\(\)/u,
	);
});

test('embedded Desktop composes canonical file observations with the shared journal', async () => {
	const authority = await readFile(
		'electron/serverTerminalAuthority.ts',
		'utf8',
	);
	assert.match(authority, /new ServerFileObservationAdapter\(/u);
	assert.match(authority, /fileObservations,/u);
	assert.match(authority, /eventJournal,/u);
	assert.match(authority, /watchFileSystem\(/u);
	assert.match(
		authority,
		/targetStats\.isDirectory\(\)\s*\?\s*target\s*:\s*dirname\(target\)/u,
	);
	assert.match(authority, /signal\.addEventListener\('abort'/u);
});
