import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)

const migratedBoundaries = Object.freeze([
	['src/services/fileViewer/terminayFileGateway.ts', /FileViewerClient/u],
	['src/components/file-viewer/FilePanel.tsx', /disconnectedFilePanelCompatibility/u],
	['src/components/file-viewer/modes/PerformantTextViewer.tsx', /FileViewerClient/u],
	['src/hooks/useTerminalSettings.ts', /TerminalSettingsClientProvider/u],
	['src/components/RecordingsWindow.tsx', /createLegacyRecordingsClient/u],
	['src/services/ai/legacyAiTabMetadataClient.ts', /Compatibility-only|legacy/u],
])

const broadPreloadAccess = /(?:window|globalThis)\s*(?:\.\s*terminay\b|\[\s*['"]terminay['"]\s*\])/u

test('Task 19 migrated boundaries keep preload compatibility explicit and scoped', async () => {
	for (const [path, marker] of migratedBoundaries) {
		const source = await readFile(path, 'utf8')
		assert.match(source, marker, `${path} must retain its explicit compatibility marker`)
	}

	const [filePanel, textViewer, recordings] = await Promise.all([
		readFile('src/components/file-viewer/FilePanel.tsx', 'utf8'),
		readFile('src/components/file-viewer/modes/PerformantTextViewer.tsx', 'utf8'),
		readFile('src/components/RecordingsWindow.tsx', 'utf8'),
	])
	assert.doesNotMatch(filePanel, broadPreloadAccess)
	assert.doesNotMatch(textViewer, broadPreloadAccess)
	assert.doesNotMatch(recordings, broadPreloadAccess)
})

test('Task 19 removes unused compatibility runtime modes rather than retaining a second authority', async () => {
	await assert.rejects(
		readFile('apps/terminay-desktop/src/compatibility/runtime.ts', 'utf8'),
		(error) => error?.code === 'ENOENT',
	)
	await assert.rejects(
		access('apps/terminay-desktop/src/compatibility/index.ts'),
		(error) => error?.code === 'ENOENT',
	)
})

test('Task 19 Desktop renderer remains outside privileged compatibility layers', async () => {
	const renderer = await readFile('apps/terminay-desktop/src/renderer/index.ts', 'utf8')
	assert.doesNotMatch(renderer, /from ['"].*(?:electron|preload|main|legacy-services)/u)
	assert.match(renderer, /hostActions|HostActions|TerminayHost/u)
})

test('Task 19 legacy adapters require an explicit host capability at their named compatibility callers', async () => {
	const adapters = [
		'src/services/recordings/legacyRecordingsClient.ts',
		'src/services/ai/legacyAiTabMetadataClient.ts',
		'src/services/fileViewer/legacyFileViewerTransport.ts',
		'src/services/settings/legacySettingsClient.ts',
		'src/services/macros/legacyMacroSettingsCapability.ts',
	]
	for (const path of adapters) {
		const source = await readFile(path, 'utf8')
		assert.doesNotMatch(source, /=\s*window\.terminay/u, `${path} must not silently capture broad preload authority`)
	}

	const [settingsHook, macroSettingsHook, filePanel, recordingsWindow, recordingController, app, entry] = await Promise.all([
		readFile('src/hooks/useTerminalSettings.ts', 'utf8'),
		readFile('src/hooks/useMacroSettings.ts', 'utf8'),
		readFile('src/components/file-viewer/FilePanel.tsx', 'utf8'),
		readFile('src/components/RecordingsWindow.tsx', 'utf8'),
		readFile('src/workspace/useTerminalRecordingController.ts', 'utf8'),
		readFile('src/App.tsx', 'utf8'),
		Promise.all([
			readFile('src/rendererApp.tsx', 'utf8'),
			readFile('src/rendererRuntime.tsx', 'utf8'),
		]).then((sources) => sources.join('\n')),
	])
	assert.doesNotMatch(filePanel, broadPreloadAccess)
	assert.doesNotMatch(filePanel, /createLegacySettingsClient/u)
	assert.doesNotMatch(recordingsWindow, broadPreloadAccess)
	assert.match(recordingsWindow, /createLegacyRecordingsClient\(window\.terminayRecordingServiceHost\)/u)
	assert.match(
		entry,
		/<RecordingsWindow client=\{serverRecordingsClient\}\s*\/>/u,
	)
	assert.match(app, /createLegacyRecordingsClient\(\s*window\.terminayRecordingServiceHost,?\s*\)/u)
	assert.match(app, /terminalClientContext\?\.applicationClient === undefined\s*\?\s*undefined\s*:\s*new ServerRecordingsClient/u)
	assert.match(recordingController, /const client = serverClient \?\? legacyClient/u)
	assert.match(recordingController, /client\.start/u)
	assert.match(recordingController, /client\.stop/u)
	assert.match(app, /createLegacyAiTabMetadataClient\(window\.terminayAiMetadataHost\)/u)
	assert.doesNotMatch(settingsHook, broadPreloadAccess)
	assert.match(settingsHook, /useContext\(TerminalSettingsClientContext\)/u)
	assert.doesNotMatch(settingsHook, /getLegacySettingsCapability|createLegacySettingsClient/u)
	assert.match(macroSettingsHook, /useContext\(LegacyMacroSettingsContext\)/u)
	assert.doesNotMatch(macroSettingsHook, /getLegacyMacroSettingsCapability/u)
	assert.doesNotMatch(macroSettingsHook, /window\.terminay/u)
	assert.match(app, /useMacroSettings\(serverMacroSettingsClient\)/u)
	const macrosWindow = await readFile('src/components/MacrosWindow.tsx', 'utf8')
	assert.match(macrosWindow, /useMacroSettings\(macroSettingsClient\)/u)
	const gateway = await readFile('src/services/fileViewer/terminayFileGateway.ts', 'utf8')
	assert.doesNotMatch(gateway, broadPreloadAccess)
	assert.doesNotMatch(gateway, /legacyFileGatewayCapability|export let terminayFileGateway/u)
	assert.match(entry, /captureLegacyFileViewerCapability\(\s*window\.terminayFileViewerCompatibilityHost,?\s*\)/u)
	assert.match(entry, /<DisconnectedFileCompatibilityProvider\s+value=\{disconnectedFileCompatibility\}/u)
	assert.match(entry, /createLegacySettingsClient\(\s*window\.terminayTerminalSettingsCompatibilityHost,?\s*\)/u)
	assert.match(entry, /captureLegacyMacroSettingsCapability\(\s*window\.terminayMacroSettingsCompatibilityHost,?\s*\)/u)
	assert.match(entry, /<LegacyMacroSettingsProvider capability=\{legacyMacroSettingsCapability\}>/u)
	assert.doesNotMatch(entry, /configureLegacyRecordingsCompatibility/u)
	assert.doesNotMatch(entry, /configureLegacyAiTabMetadataCompatibility/u)
})

test('Task 19 macro settings compatibility snapshots named host operations', async () => {
	const bundleDirectory = await mkdtemp(path.join(os.tmpdir(), 'terminay-task19-macro-capability-'))
	try {
		await build({
			bundle: true,
			entryPoints: ['src/services/macros/legacyMacroSettingsCapability.ts'],
			format: 'cjs',
			logLevel: 'silent',
			outfile: path.join(bundleDirectory, 'capability.cjs'),
			platform: 'node',
		})
		const { captureLegacyMacroSettingsCapability } = require(path.join(bundleDirectory, 'capability.cjs'))
		const calls = []
		const api = {
			getMacros: async () => { calls.push('getMacros'); return [] },
			getSecrets: async () => { calls.push('getSecrets'); return [] },
			getDecryptedSecret: async (id) => { calls.push(['getDecryptedSecret', id]); return 'secret-value' },
			saveSecret: async (name, value) => { calls.push(['saveSecret', name, value]); return { id: 'secret-1', name } },
			deleteSecret: async (id) => { calls.push(['deleteSecret', id]) },
			updateMacros: async (macros) => { calls.push(['updateMacros', macros]); return macros },
			resetMacros: async () => { calls.push('resetMacros'); return [] },
			onMacrosChanged: (listener) => { calls.push(['onMacrosChanged', listener]); return () => {} },
		}
		const capability = captureLegacyMacroSettingsCapability(api)
		api.getMacros = async () => { throw new Error('replaced broad host method must not be used') }
		api.getSecrets = async () => { throw new Error('replaced broad secret host method must not be used') }
		api.getDecryptedSecret = async () => { throw new Error('replaced broad decrypted-secret method must not be used') }
		assert.equal(Object.isFrozen(capability), true)
		assert.deepEqual(await capability.getMacros(), [])
		assert.deepEqual(await capability.getSecrets(), [])
		assert.equal(await capability.getDecryptedSecret('secret-1'), 'secret-value')
		assert.deepEqual(calls, ['getMacros', 'getSecrets', ['getDecryptedSecret', 'secret-1']])
		assert.throws(
			() => captureLegacyMacroSettingsCapability({ ...api, onMacrosChanged: undefined }),
			/legacy macro settings capability onMacrosChanged is unavailable/u,
		)
	} finally {
		await rm(bundleDirectory, { force: true, recursive: true })
	}
})

test('Task 19 MacrosWindow retains only the named macro compatibility capability', async () => {
	const [windowSource, capability] = await Promise.all([
		readFile('src/components/MacrosWindow.tsx', 'utf8'),
		readFile('src/services/macros/legacyMacroSettingsCapability.ts', 'utf8'),
	])
	assert.doesNotMatch(windowSource, broadPreloadAccess)
	assert.match(windowSource, /useLegacyMacroSettingsCapability\(\)/u)
	for (const operation of ['getSecrets', 'saveSecret', 'deleteSecret', 'updateMacros', 'resetMacros']) {
		assert.match(capability, new RegExp(`${operation}:`, 'u'))
	}
})

test('Task 19 macro compatibility is injected through the renderer provider boundary', async () => {
	const [capability, hook, app, macrosWindow, entry] = await Promise.all([
		readFile('src/services/macros/legacyMacroSettingsCapability.ts', 'utf8'),
		readFile('src/hooks/useMacroSettings.ts', 'utf8'),
		readFile('src/App.tsx', 'utf8'),
		readFile('src/components/MacrosWindow.tsx', 'utf8'),
		readFile('src/rendererApp.tsx', 'utf8'),
	])
	assert.doesNotMatch(capability, /configureLegacyMacroSettingsCompatibility|getLegacyMacroSettingsCapability|legacyMacroSettingsCapability/u)
	assert.match(capability, /export function captureLegacyMacroSettingsCapability/u)
	assert.doesNotMatch(hook, broadPreloadAccess)
	assert.doesNotMatch(app, /useMacroSettings\(window\.terminay\)/u)
	assert.doesNotMatch(macrosWindow, /useMacroSettings\(window\.terminay\)/u)
	assert.doesNotMatch(entry, /configureLegacyMacroSettingsCompatibility/u)
	assert.match(hook, /LegacyMacroSettingsProvider/u)
})

test('Task 19 recordings and AI compatibility clients snapshot their named host operations', async () => {
	const [recordings, ai] = await Promise.all([
		readFile('src/services/recordings/legacyRecordingsClient.ts', 'utf8'),
		readFile('src/services/ai/legacyAiTabMetadataClient.ts', 'utf8'),
	])
	assert.match(recordings, /export function captureLegacyRecordingsCapability/u)
	assert.match(recordings, /const capability = captureLegacyRecordingsCapability\(api\)/u)
	assert.match(recordings, /return Object\.freeze\(\{/u)
	assert.doesNotMatch(recordings, /createLegacyRecordingsClient[\s\S]*?api\.getTerminalRecordingState/u)
	assert.match(ai, /export function captureLegacyAiTabMetadataCapability/u)
	assert.match(ai, /const capability = captureLegacyAiTabMetadataCapability\(api\)/u)
	assert.match(ai, /return Object\.freeze\(\{/u)
	assert.doesNotMatch(ai, /createLegacyAiTabMetadataClient[\s\S]*?api\.generateAiTabMetadata/u)
})

test('Task 19 AI metadata uses its named host without a renderer-global registry', async () => {
	const [entry, preload, declarations, app, settingsWindow] = await Promise.all([
		readFile('src/rendererApp.tsx', 'utf8'),
		readFile('electron/preload.ts', 'utf8'),
		readFile('src/vite-env.d.ts', 'utf8'),
		readFile('src/App.tsx', 'utf8'),
		readFile('src/components/SettingsWindow.tsx', 'utf8'),
	])
	assert.doesNotMatch(entry, /AiTabMetadata/u)
	assert.match(preload, /exposeInMainWorld\(\s*'terminayAiMetadataHost'/u)
	assert.match(declarations, /terminayAiMetadataHost:/u)
	assert.match(app, /createLegacyAiTabMetadataClient\(window\.terminayAiMetadataHost\)/u)
	assert.match(settingsWindow, /createLegacyAiTabMetadataClient\(window\.terminayAiMetadataHost\)/u)
	for (const source of [preload, declarations]) {
		assert.doesNotMatch(source, /terminayAiMetadataCompatibilityHost/u)
	}
	const bundleDirectory = await mkdtemp(path.join(os.tmpdir(), 'terminay-task19-ai-capability-'))
	try {
		await build({
			bundle: true,
			entryPoints: ['src/services/ai/legacyAiTabMetadataClient.ts'],
			format: 'cjs',
			logLevel: 'silent',
			outfile: path.join(bundleDirectory, 'capability.cjs'),
			platform: 'node',
		})
		const { createLegacyAiTabMetadataClient } = require(path.join(bundleDirectory, 'capability.cjs'))
		const calls = []
		const initial = {
			generateAiTabMetadata: async (request) => {
				calls.push(['generate', request])
				return { text: 'initial' }
			},
			listAiTabMetadataModels: async (provider) => {
				calls.push(['models', provider])
				return [{ id: 'model', label: 'Model' }]
			},
		}
		const client = createLegacyAiTabMetadataClient(initial)
		initial.generateAiTabMetadata = async () => ({ text: 'replacement' })
		assert.deepEqual(await client.generate({}), { text: 'initial' })
		assert.deepEqual(await client.listModels('codex'), [{ id: 'model', label: 'Model' }])
		assert.deepEqual(calls, [['generate', {}], ['models', 'codex']])
	} finally {
		await rm(bundleDirectory, { force: true, recursive: true })
	}
})

test('Task 19 file-viewer compatibility captures a frozen narrow capability', async () => {
	const bundleDirectory = await mkdtemp(path.join(os.tmpdir(), 'terminay-task19-file-capability-'))
	try {
		await build({
			bundle: true,
			entryPoints: ['src/services/fileViewer/terminayFileGateway.ts'],
			format: 'cjs',
			logLevel: 'silent',
			outfile: path.join(bundleDirectory, 'gateway.cjs'),
			platform: 'node',
		})
		const { captureLegacyFileViewerCapability } = require(path.join(bundleDirectory, 'gateway.cjs'))
		const calls = []
		const api = Object.fromEntries([
			'deleteEntry', 'getFileInfo', 'getFilePreviewSource', 'getGitDiff', 'getGitRepoInfo',
			'getFileTextMetadata', 'listDirectory', 'mkdir', 'onFileWatchEvent', 'readFileBytes', 'readFileText',
			'readFileTextLines', 'renameEntry', 'saveFile', 'saveSparseFile', 'unwatchFile', 'watchFile',
		].map((name) => [name, (...args) => {
			calls.push([name, args])
			return name === 'onFileWatchEvent' ? () => {} : Promise.resolve(name)
		}]))
		const capability = captureLegacyFileViewerCapability(api)
		api.getFileInfo = () => { throw new Error('replaced broad host method must not be used') }
		assert.equal(Object.isFrozen(capability), true)
		assert.equal(await capability.getFileInfo('/workspace/README.md'), 'getFileInfo')
		assert.deepEqual(calls, [['getFileInfo', ['/workspace/README.md']]])
		assert.throws(
			() => captureLegacyFileViewerCapability({ ...api, watchFile: undefined }),
			/legacy file-viewer capability watchFile is unavailable/u,
		)
	} finally {
		await rm(bundleDirectory, { force: true, recursive: true })
	}
})

test('Task 19 file-viewer compatibility snapshots named host operations without global configuration', async () => {
	const gateway = await readFile('src/services/fileViewer/terminayFileGateway.ts', 'utf8')
	assert.match(gateway, /export function captureLegacyFileViewerCapability/u)
	assert.match(gateway, /return Object\.freeze\(\{/u)
	assert.doesNotMatch(gateway, /legacyFileGatewayCapability|export let terminayFileGateway/u)
	assert.match(gateway, /createLegacyFileViewerClient\(api: LegacyFileGatewayApi\)/u)
})

test('Task 19 settings compatibility snapshots named host operations before global configuration', async () => {
	const capability = await readFile('src/services/settings/legacySettingsCapability.ts', 'utf8')
	assert.doesNotMatch(capability, /configureLegacySettingsCompatibility|getLegacySettingsCapability|legacySettingsCapability/u)
	assert.match(capability, /export function captureLegacySettingsCapability/u)
})

test('Task 19 removes the unused renderer macro-window IPC capability', async () => {
	const [preload, main, types, rendererSources] = await Promise.all([
		readFile('electron/preload.ts', 'utf8'),
		readFile('electron/main.ts', 'utf8'),
		readFile('src/types/terminay.ts', 'utf8'),
		Promise.all([
			readFile('src/App.tsx', 'utf8'),
			readFile('src/main.tsx', 'utf8'),
		]),
	])

	assert.doesNotMatch(main, /app:open-macros/u)
	for (const source of [preload, types, ...rendererSources]) {
		assert.doesNotMatch(source, /(?:app:open-macros|openMacrosWindow)/u)
	}
})
