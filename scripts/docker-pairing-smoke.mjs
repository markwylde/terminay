import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

export const DEFAULT_DOCKER_IMAGE = 'terminay-server:local'
export const DEFAULT_SERVER_ID = 'docker-pairing-smoke'
export const DEFAULT_SERVER_ORIGIN = 'https://docker-pairing-smoke.example.test'
export const DEFAULT_SERVER_VERSION = '1.2.3'
export const DEFAULT_HEALTH_HOST = '127.0.0.1'
export const DEFAULT_HEALTH_PORT = 8080

export function redactPairingUrl(value) {
	const url = new URL(value)
	const length = url.hash.length > 0 ? url.hash.slice(1).length : 0
	url.hash = ''
	return `${url.toString()}#<redacted:${length}>`
}

export function inspectServerHandoff(readiness, expected = {}) {
	if (!readiness || typeof readiness !== 'object') throw new TypeError('server readiness must be an object')
	if (readiness.ready !== true) throw new Error('server readiness record is not ready')
	if (readiness.serverId !== (expected.serverId ?? DEFAULT_SERVER_ID)) throw new Error('server handoff server identity does not match')
	if (readiness.version !== (expected.version ?? DEFAULT_SERVER_VERSION)) throw new Error('server readiness version does not match')
	if (readiness.endpoint !== 'loopback') throw new Error('Docker smoke must use the loopback endpoint policy')
	if (readiness.healthEndpoint !== (expected.healthEndpoint ?? `http://${DEFAULT_HEALTH_HOST}:${DEFAULT_HEALTH_PORT}`)) throw new Error('server readiness health endpoint does not match')
	const handoff = readiness.pairing
	if (!handoff || typeof handoff !== 'object') throw new Error('server readiness pairing handoff is missing')
	if (typeof handoff.pairingSessionId !== 'string' || !/^pair-[A-Za-z0-9_-]+$/u.test(handoff.pairingSessionId)) throw new Error('server handoff pairing session id is invalid')
	if (Object.hasOwn(handoff, 'pairingToken')) throw new Error('server readiness must not expose the pairing token outside the URL fragment')
	if (typeof handoff.pairingExpiresAt !== 'string' || !Number.isFinite(Date.parse(handoff.pairingExpiresAt))) throw new Error('server handoff pairing expiry is invalid')
	if (!Number.isSafeInteger(handoff.expiresInSeconds) || handoff.expiresInSeconds < 1) throw new Error('server handoff expiry duration is invalid')
	if (handoff.requiresApproval !== true) throw new Error('server handoff must require approval')
	if (typeof handoff.pairingUrl !== 'string') throw new Error('server handoff pairing URL is missing')
	const url = new URL(handoff.pairingUrl)
	if (url.protocol !== 'https:' || url.origin !== (expected.origin ?? DEFAULT_SERVER_ORIGIN)) throw new Error('server handoff origin does not match')
	if (url.username || url.password || url.search || url.pathname !== '/') throw new Error('server handoff URL contains unexpected authority data')
	if (url.hash.length < 2) throw new Error('server handoff URL has no structured fragment')
	const fragment = new URLSearchParams(url.hash.slice(1))
	const expectedKeys = ['pairingExpiresAt', 'pairingSessionId', 'pairingToken']
	if (fragment.size !== expectedKeys.length || expectedKeys.some((key) => fragment.getAll(key).length !== 1)) throw new Error('server handoff URL does not contain exactly one structured pairing field set')
	if (fragment.get('pairingSessionId') !== handoff.pairingSessionId) throw new Error('server handoff session id does not match its URL')
	const pairingToken = fragment.get('pairingToken')
	if (pairingToken === null || pairingToken.length === 0) throw new Error('server handoff URL pairing token is missing')
	if (fragment.get('pairingExpiresAt') !== handoff.pairingExpiresAt) throw new Error('server handoff expiry does not match its URL')
	return Object.freeze({
		serverId: readiness.serverId,
		version: readiness.version,
		healthEndpoint: readiness.healthEndpoint,
		pairingSessionId: handoff.pairingSessionId,
		origin: url.origin,
		fragmentLength: url.hash.slice(1).length,
		tokenLength: pairingToken.length,
		expiresAt: handoff.pairingExpiresAt,
		pairingUrl: redactPairingUrl(handoff.pairingUrl),
	})
}

export function inspectServerHealth(probes, expected = {}) {
	if (!Array.isArray(probes) || probes.length !== 2) throw new Error('Docker health probe did not return both endpoints')
	const expectedServerId = expected.serverId ?? DEFAULT_SERVER_ID
	const expectedVersion = expected.version ?? DEFAULT_SERVER_VERSION
	const expectedBody = () => ({
		status: 'ok',
		ready: true,
		phase: 'ready',
		serverId: expectedServerId,
		version: expectedVersion,
	})
	for (const path of ['/healthz', '/readyz']) {
		const probe = probes.find((candidate) => candidate?.path === path)
		if (probe?.status !== 200) throw new Error(`Docker ${path} health probe was not successful`)
		const body = probe?.body
		if (!body || typeof body !== 'object') throw new Error(`Docker ${path} health response is not an object`)
		const actualKeys = Object.keys(body).sort()
		const expectedKeys = Object.keys(expectedBody()).sort()
		if (actualKeys.join('\u0000') !== expectedKeys.join('\u0000')) throw new Error(`Docker ${path} health response exposed an unexpected field`)
		for (const [key, value] of Object.entries(expectedBody())) {
			if (body[key] !== value) throw new Error(`Docker ${path} health response field ${key} does not match`)
		}
	}
	return Object.freeze({
		status: 'passed',
		phase: 'ready',
		serverId: expectedServerId,
		version: expectedVersion,
		endpoints: Object.freeze(['/healthz', '/readyz']),
	})
}

export function dockerPreflight(docker = 'docker') {
	const result = spawnSync(docker, ['version', '--format', '{{.Server.Version}}'], {
		encoding: 'utf8',
		timeout: 10_000,
	})
	if (result.error || result.status !== 0) {
		return Object.freeze({
			available: false,
			executable: docker,
			reason: result.error?.message ?? commandError(result, 'docker version failed'),
		})
	}
	return Object.freeze({
		available: true,
		executable: docker,
		serverVersion: result.stdout.trim() || 'unknown',
	})
}

function dockerImageAvailable(docker, image) {
	const result = spawnSync(docker, ['image', 'inspect', image], {
		encoding: 'utf8',
		timeout: 10_000,
	})
	return result.status === 0
}

export function runDockerServerPairing({
	docker = 'docker',
	image = DEFAULT_DOCKER_IMAGE,
	serverId = DEFAULT_SERVER_ID,
	origin = DEFAULT_SERVER_ORIGIN,
	version = DEFAULT_SERVER_VERSION,
} = {}) {
	const preflight = dockerPreflight(docker)
	if (!preflight.available) return Object.freeze({ status: 'blocked', blocker: 'docker-unavailable', preflight })
	if (!dockerImageAvailable(docker, image)) return Object.freeze({ status: 'blocked', blocker: 'docker-image-unavailable', image, preflight })

	const containerName = `terminay-docker-pairing-smoke-${process.pid}-${randomUUID().slice(0, 8)}`
	let containerId
	try {
		const started = spawnSync(docker, [
			'run', '--detach', '--init', '--pull=never', '--name', containerName,
			'--network', 'none', '--read-only',
			'--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
			'-e', `TERMINAY_SERVER_VERSION=${version}`,
			image,
			'--server-id', serverId,
			'--data-root', '/tmp/terminay-docker-pairing-smoke',
			'--endpoint', 'loopback',
			'--public-origin', origin,
			'--health-host', DEFAULT_HEALTH_HOST,
			'--health-port', String(DEFAULT_HEALTH_PORT),
		], { encoding: 'utf8', timeout: 10_000 })
		if (started.error || started.status !== 0) throw new DockerSmokeError('docker-server-start-failed', commandError(started, 'Docker server container failed to start'))
		containerId = started.stdout.trim()
		if (!containerId) throw new DockerSmokeError('docker-server-start-failed', 'Docker server container returned no id')

		const readiness = waitForDockerReadiness(docker, containerId)
		let handoff
		try {
			handoff = inspectServerHandoff(readiness, {
				serverId,
				origin,
				version,
				healthEndpoint: `http://${DEFAULT_HEALTH_HOST}:${DEFAULT_HEALTH_PORT}`,
			})
		} catch (error) {
			throw new DockerSmokeError('docker-server-handoff-invalid', error instanceof Error ? error.message : 'invalid server readiness handoff')
		}

		if (inspectContainerState(docker, containerId) !== 'running') throw new DockerSmokeError('docker-server-foreground-exited', 'Docker server exited after reporting readiness')
		const healthProbes = readDockerHealth(docker, containerId)
		let health
		try {
			health = inspectServerHealth(healthProbes, { serverId, version })
		} catch (error) {
			throw new DockerSmokeError('docker-server-health-invalid', error instanceof Error ? error.message : 'invalid Docker health response')
		}

		const stopped = spawnSync(docker, ['stop', '--time', '10', containerId], {
			encoding: 'utf8',
			timeout: 15_000,
		})
		if (stopped.error || stopped.status !== 0) throw new DockerSmokeError('docker-server-shutdown-failed', commandError(stopped, 'Docker server did not stop cleanly'))
		const exit = spawnSync(docker, ['wait', containerId], {
			encoding: 'utf8',
			timeout: 5_000,
		})
		if (exit.error || exit.status !== 0 || exit.stdout.trim() !== '0') throw new DockerSmokeError('docker-server-shutdown-failed', `Docker server exited with ${exit.stdout.trim() || 'an unknown status'}`)

		const response = {
			status: 'passed',
			handoff,
			health,
			lifecycle: Object.freeze({ foreground: true, runningAfterReadiness: true, stopSignal: 'SIGTERM', exitCode: 0 }),
			preflight,
			image,
		}
		Object.defineProperty(response, 'clientPairingUrl', { value: readiness.pairing.pairingUrl, enumerable: false })
		return Object.freeze(response)
	} catch (error) {
		return Object.freeze({
			status: 'blocked',
			blocker: error instanceof DockerSmokeError ? error.blocker : 'docker-server-smoke-failed',
			reason: error instanceof Error ? error.message : 'Docker server smoke failed',
			preflight,
		})
	} finally {
		if (containerId) spawnSync(docker, ['rm', '--force', containerId], { encoding: 'utf8', timeout: 10_000 })
	}
}

/** Run the actual client parser, bundled from the checked-in client source. */
export async function probeClientPairingParser(pairingUrl, root = process.cwd()) {
	const outputDirectory = await mkdtemp(join(tmpdir(), 'terminay-docker-pairing-client-'))
	const outputFile = join(outputDirectory, 'pairing.mjs')
	try {
		await build({
			bundle: true,
			entryPoints: [join(root, 'src/remote/services/pairing.ts')],
			format: 'esm',
			logLevel: 'silent',
			outfile: outputFile,
			platform: 'node',
		})
		const client = await import(pathToFileURL(outputFile).href)
		try {
			const clientUrl = new URL(pairingUrl)
			globalThis.window = { location: { href: pairingUrl, hash: clientUrl.hash, search: clientUrl.search } }
			const bootstrap = client.parsePairingBootstrap(pairingUrl)
			return Object.freeze({
				status: 'passed',
				bootstrap: Object.freeze({
					pairingExpiresAt: bootstrap.pairingExpiresAt,
					pairingSessionId: bootstrap.pairingSessionId,
					pairingTokenLength: bootstrap.pairingToken.length,
				}),
			})
		} catch (error) {
			return Object.freeze({
				status: 'blocked',
				blocker: 'client-pairing-schema-mismatch',
				reason: error instanceof Error ? error.message : 'client rejected pairing URL',
			})
		} finally {
			delete globalThis.window
		}
	} finally {
		await rm(outputDirectory, { force: true, recursive: true })
	}
}

export async function runDockerPairingSmoke(options = {}) {
	const root = resolve(options.root ?? process.cwd())
	try {
		await access(join(root, 'apps/terminay-server/dist/cli.js'))
	} catch {
		return Object.freeze({ status: 'blocked', blocker: 'server-build-missing', command: 'npm run build --workspace @terminay/server' })
	}
	const server = runDockerServerPairing({ ...options, root })
	if (server.status !== 'passed') return Object.freeze({ status: 'blocked', docker: server, client: null, blockers: [server.blocker] })
	const client = await probeClientPairingParser(server.clientPairingUrl, root)
	const blockers = client.status === 'passed' ? [] : [client.blocker]
	return Object.freeze({
		status: blockers.length === 0 ? 'passed' : 'blocked',
		docker: server,
		client,
		blockers,
		limitations: [
			'The smoke proves the foreground handoff, client bootstrap parser, and orchestration health lifecycle; it does not open an authenticated application transport or exercise hosted signaling, TURN, or WebRTC.',
		],
	})
}

class DockerSmokeError extends Error {
	constructor(blocker, message) {
		super(message)
		this.blocker = blocker
	}
}

function waitForDockerReadiness(docker, containerId) {
	const deadline = Date.now() + 10_000
	while (Date.now() < deadline) {
		const logs = spawnSync(docker, ['logs', containerId], { encoding: 'utf8', timeout: 5_000 })
		for (const line of (logs.stdout ?? '').split('\n').map((value) => value.trim()).filter(Boolean)) {
			try {
				const record = JSON.parse(line)
				if (record && typeof record === 'object' && Object.hasOwn(record, 'ready')) return record
			} catch {
				// The CLI's readiness record is the only JSON line consumed here.
			}
		}
		const state = inspectContainerState(docker, containerId)
		if (state !== 'running') throw new DockerSmokeError('docker-server-readiness-failed', `Docker server exited before readiness (${state})`)
		sleep(100)
	}
	throw new DockerSmokeError('docker-server-readiness-failed', 'Docker server readiness timed out')
}

function inspectContainerState(docker, containerId) {
	const result = spawnSync(docker, ['inspect', '--format', '{{.State.Status}}', containerId], {
		encoding: 'utf8',
		timeout: 5_000,
	})
	return result.status === 0 ? result.stdout.trim() : 'unknown'
}

function readDockerHealth(docker, containerId) {
	const script = `const paths = ['/healthz', '/readyz']; Promise.all(paths.map(async (path) => { const response = await fetch('http://${DEFAULT_HEALTH_HOST}:${DEFAULT_HEALTH_PORT}' + path); return { path, status: response.status, body: await response.json() }; })).then((value) => process.stdout.write(JSON.stringify(value))).catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });`
	const result = spawnSync(docker, ['exec', containerId, 'node', '-e', script], {
		encoding: 'utf8',
		timeout: 10_000,
	})
	if (result.error || result.status !== 0) throw new DockerSmokeError('docker-server-health-failed', commandError(result, 'Docker health probe failed'))
	try {
		return JSON.parse(result.stdout)
	} catch {
		throw new DockerSmokeError('docker-server-health-failed', 'Docker health probe returned invalid JSON')
	}
}

function commandError(result, fallback) {
	if (result.error) return result.error.message
	const lines = (result.stderr ?? '').trim().split('\n').filter(Boolean)
	return lines.at(-1) ?? fallback
}

function sleep(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	try {
		const report = await runDockerPairingSmoke()
		console.log(JSON.stringify(report, null, 2))
		if (process.argv.includes('--strict') && report.status !== 'passed') process.exitCode = 1
	} catch (error) {
		console.error(error instanceof Error ? error.message : error)
		process.exitCode = 1
	}
}
