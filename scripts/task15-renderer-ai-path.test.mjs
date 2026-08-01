import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { TerminayAiClient } from '@terminay/client-core'

const bundleDirectory = await mkdtemp(join(process.cwd(), '.task15-renderer-'))
const bundlePath = join(bundleDirectory, 'server-dictation-capture.mjs')
const componentBundlePath = join(bundleDirectory, 'ServerDictationCapture.mjs')
await build({
	entryPoints: ['src/components/DictationCaptureController.ts'],
	bundle: true,
	format: 'esm',
	platform: 'node',
	packages: 'external',
	outfile: bundlePath,
	logLevel: 'silent',
})
await build({
	entryPoints: ['src/components/ServerDictationCapture.tsx'],
	bundle: true,
	format: 'esm',
	platform: 'browser',
	packages: 'external',
	outfile: componentBundlePath,
	logLevel: 'silent',
})
const module = await import(`${bundlePath}?test=${Date.now()}`)

const target = {
	serverId: 'server-a',
	projectId: 'project-a',
	panelId: 'panel-a',
	sessionId: 'session-a',
}
const disclosure = {
	serverLabel: 'Local Desktop',
	provider: 'openai',
	credentialStatus: 'configured',
	confirmed: true,
}

function createRuntime({ level = 0.2, getUserMediaError, clock = () => 1_250, schedule, cancelSchedule } = {}) {
	const tracks = [{ stopped: false, stop() { this.stopped = true } }]
	let recorder
	let stopCalls = 0
	let meterClosed = false
	return {
		tracks,
		get recorder() { return recorder },
		get stopCalls() { return stopCalls },
		get meterClosed() { return meterClosed },
		runtime: {
			mediaDevices: {
				getUserMedia: async () => {
					if (getUserMediaError !== undefined) throw getUserMediaError
					return { getTracks: () => tracks }
				},
			},
			createRecorder: (_stream, mimeType) => {
				const listeners = { data: null, stop: null, error: null }
				recorder = {
					state: 'inactive',
					mimeType,
					ondataavailable: null,
					onstop: null,
					onerror: null,
					start() { this.state = 'recording' },
					stop() {
						stopCalls += 1
						this.state = 'inactive'
						this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: mimeType }) })
						this.onstop?.()
					},
				}
				void listeners
				return recorder
				},
				createMeter: () => ({ readLevel: () => level, close: () => { meterClosed = true } }),
				now: clock,
				...(schedule === undefined ? {} : { schedule }),
				...(cancelSchedule === undefined ? {} : { cancelSchedule }),
			},
		}
}

test('renderer capture sends immutable target and bounded audio through the shared AI protocol operation', async () => {
	const calls = []
	const aiClient = new TerminayAiClient({
		query: async () => null,
		command: async () => ({ cancelled: false }),
		commandWithBody: async (operation, payload, body) => {
			calls.push({ operation, payload, audio: new Uint8Array(body) })
			return { text: '  ls -la  ' }
		},
	})
	const runtimeState = createRuntime()
	const controller = new module.DictationCaptureController({
		client: aiClient,
		target,
		disclosure,
		runtime: runtimeState.runtime,
		capture: { now: () => 0, createRequestId: () => 'dictation-renderer-a' },
	})
	await controller.start()
	assert.equal(controller.snapshot().status, 'recording')
	controller.stop()
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(controller.snapshot().status, 'complete')
	assert.equal(controller.snapshot().transcript, 'ls -la')
	assert.equal(calls.length, 1)
	assert.equal(calls[0].operation, 'ai.dictation.transcribe')
	assert.deepEqual(calls[0].payload.target, target)
	assert.deepEqual([...calls[0].audio], [1, 2, 3])
	assert.equal(calls[0].payload.mimeType, 'audio/webm;codecs=opus')
	assert.equal('disclosure' in calls[0].payload, false)
	assert.equal(runtimeState.tracks[0].stopped, true)
	assert.equal(runtimeState.meterClosed, true)
})

test('silence detection stops capture without changing its target', () => {
	const detector = new module.DictationSilenceDetector(100, 0.1)
	assert.equal(detector.observe(0.01, 10), false)
	assert.equal(detector.observe(0.02, 109), false)
	assert.equal(detector.observe(0.02, 110), true)
	detector.reset()
	assert.equal(detector.observe(0.02, 200), false)
	assert.equal(detector.observe(0.2, 250), false)
	assert.equal(detector.observe(0.01, 300), false)
})

test('the renderer stops MediaRecorder after the configured silence interval', async () => {
	let now = 1_250
	let scheduled
	const runtimeState = createRuntime({
		level: 0,
		clock: () => now,
		schedule: (callback) => {
			scheduled = callback
			return 1
		},
		cancelSchedule: () => {},
	})
	const controller = new module.DictationCaptureController({
		client: { async transcribe() { return { text: 'silence stopped' } }, async cancel() {} },
		target,
		disclosure,
		runtime: runtimeState.runtime,
		silenceStopMs: 100,
		capture: { now: () => 0, createRequestId: () => 'dictation-renderer-silence' },
	})

	await controller.start()
	assert.equal(controller.snapshot().status, 'recording')
	assert.equal(typeof scheduled, 'function')
	now += 100
	scheduled()
	assert.equal(runtimeState.stopCalls, 1)
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(controller.snapshot().status, 'complete')
})

test('microphone permission denial fails in the renderer before creating a recorder', async () => {
	const runtimeState = createRuntime({ getUserMediaError: new DOMException('denied', 'NotAllowedError') })
	const controller = new module.DictationCaptureController({
		client: { async transcribe() { throw new Error('must not upload') }, async cancel() {} },
		target,
		disclosure,
		runtime: runtimeState.runtime,
		capture: { now: () => 0, createRequestId: () => 'dictation-renderer-permission' },
	})
	await controller.start()
	assert.equal(controller.snapshot().status, 'failure')
	assert.match(controller.snapshot().error, /permission/u)
	assert.equal(runtimeState.recorder, undefined)
})

test('Cancel stops local tracks, clears the request, and never uploads audio', async () => {
	let uploads = 0
	const cancelledRequests = []
	const aiClient = {
		async transcribe() { uploads += 1; return { text: 'unexpected' } },
		async cancel(requestId) { cancelledRequests.push(requestId) },
	}
	const runtimeState = createRuntime()
	const controller = new module.DictationCaptureController({
		client: aiClient,
		target,
		disclosure,
		runtime: runtimeState.runtime,
		capture: { now: () => 0, createRequestId: () => 'dictation-renderer-cancel' },
	})
	await controller.start()
	controller.cancel()
	assert.equal(controller.snapshot().status, 'cancelled')
	assert.equal(uploads, 0)
	assert.deepEqual(cancelledRequests, ['dictation-renderer-cancel'])
	assert.equal(runtimeState.tracks[0].stopped, true)
})

test('renderer disconnect aborts an uploaded request and releases capture resources', async () => {
	let uploadSignal
	const aiClient = {
		async transcribe(_request, options = {}) {
			uploadSignal = options.signal
			return new Promise((_, reject) => {
				options.signal?.addEventListener('abort', () => reject({ code: 'disconnected' }), { once: true })
			})
		},
		async cancel() {},
	}
	const runtimeState = createRuntime()
	const controller = new module.DictationCaptureController({
		client: aiClient,
		target,
		disclosure,
		runtime: runtimeState.runtime,
		capture: { now: () => 0, createRequestId: () => 'dictation-renderer-disconnect' },
	})
	await controller.start()
	controller.stop()
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(controller.snapshot().status, 'transcribing')
	controller.cancel()
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(controller.snapshot().status, 'cancelled')
	assert.equal(uploadSignal.aborted, true)
	assert.equal(runtimeState.tracks[0].stopped, true)
	assert.equal(runtimeState.meterClosed, true)
})

test('renderer rejects malformed or oversized provider output before presenting a transcript', () => {
	assert.throws(
		() => module.readDictationTranscript({ text: '\u0000provider output' }),
		/transcription response was invalid/u,
	)
	assert.throws(
		() => module.readDictationTranscript({ text: 'x'.repeat(32_001) }),
		/transcription response was invalid/u,
	)
	assert.equal(module.readDictationTranscript({ text: '  safe provider output  ' }), 'safe provider output')
})

test('the production component uses shared client AI APIs and has no preload dependency', async () => {
	const source = await readFile('src/components/ServerDictationCapture.tsx', 'utf8')
	assert.match(source, /TerminayAiClient/u)
	assert.match(source, /DictationCaptureController/u)
	assert.match(source, /DictationOverlay/u)
	assert.doesNotMatch(source, /window\.terminay/u)
	const overlay = await readFile('src/components/DictationOverlay.tsx', 'utf8')
	assert.match(overlay, /Cancel dictation/u)
})

await rm(bundleDirectory, { recursive: true, force: true })
