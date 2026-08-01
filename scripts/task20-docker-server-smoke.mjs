import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const DEFAULT_IMAGE_PREFIX = 'terminay-server-task20'
export const DEFAULT_SERVER_ID = 'task20-docker-server'
export const DEFAULT_SERVER_VERSION = 'task20-local'
export const DEFAULT_HEALTH_PORT = 8080

export function redactPairingUrl(value) {
	const url = new URL(value)
	const fragmentLength = url.hash.length > 0 ? url.hash.slice(1).length : 0
	url.hash = ''
	return `${url.toString()}#<redacted:${fragmentLength}>`
}

export function inspectDockerReadiness(readiness, expected = {}) {
	if (!readiness || typeof readiness !== 'object') throw new TypeError('readiness must be an object')
	if (readiness.ready !== true) throw new Error('readiness did not report ready')
	if (readiness.serverId !== (expected.serverId ?? DEFAULT_SERVER_ID)) throw new Error('server id did not match')
	if (readiness.version !== (expected.version ?? DEFAULT_SERVER_VERSION)) throw new Error('server version did not match')
	if (readiness.endpoint !== 'loopback') throw new Error('endpoint policy did not match loopback')
	if (readiness.healthEndpoint !== 'http://0.0.0.0:8080') throw new Error('health endpoint did not match container bind contract')
	if (typeof readiness.dataRoot === 'string' && readiness.dataRoot !== '/var/lib/terminay') throw new Error('data root did not match container volume')

	const handoff = readiness.pairing
	if (!handoff || typeof handoff !== 'object') throw new Error('pairing handoff is missing')
	if (Object.hasOwn(handoff, 'pairingToken')) throw new Error('pairing token must not be exposed outside the URL fragment')
	if (handoff.requiresApproval !== true) throw new Error('pairing handoff must require approval')
	if (typeof handoff.pairingSessionId !== 'string' || !handoff.pairingSessionId.startsWith('pair-')) throw new Error('pairing session id is invalid')
	if (typeof handoff.pairingExpiresAt !== 'string' || !Number.isFinite(Date.parse(handoff.pairingExpiresAt))) throw new Error('pairing expiry is invalid')
	if (typeof handoff.pairingUrl !== 'string') throw new Error('pairing URL is missing')

	const url = new URL(handoff.pairingUrl)
	if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('pairing URL must be HTTP(S)')
	if (url.username || url.password || url.search !== '') throw new Error('pairing URL contains credential or query material')
	const fragment = new URLSearchParams(url.hash.slice(1))
	const token = fragment.get('pairingToken')
	if (!token) throw new Error('pairing URL fragment did not contain a token')
	if (fragment.get('pairingSessionId') !== handoff.pairingSessionId) throw new Error('pairing URL session id did not match readiness')
	if (fragment.get('pairingExpiresAt') !== handoff.pairingExpiresAt) throw new Error('pairing URL expiry did not match readiness')

	return Object.freeze({
		serverId: readiness.serverId,
		version: readiness.version,
		endpoint: readiness.endpoint,
		healthEndpoint: readiness.healthEndpoint,
		dataRoot: readiness.dataRoot,
		pairingSessionId: handoff.pairingSessionId,
		pairingUrl: redactPairingUrl(handoff.pairingUrl),
		tokenLength: token.length,
		fragmentLength: url.hash.slice(1).length,
		expiresAt: handoff.pairingExpiresAt,
	})
}

export function inspectDockerHealthResponses(responses, expected = {}) {
	if (!Array.isArray(responses) || responses.length !== 3) throw new Error('expected GET /healthz, GET /readyz, and HEAD /readyz probes')
	const expectedServerId = expected.serverId ?? DEFAULT_SERVER_ID
	const expectedVersion = expected.version ?? DEFAULT_SERVER_VERSION
	const expectedBody = {
		status: 'ok',
		ready: true,
		phase: 'ready',
		serverId: expectedServerId,
		version: expectedVersion,
	}
	for (const path of ['/healthz', '/readyz']) {
		const probe = responses.find((candidate) => candidate?.method === 'GET' && candidate?.path === path)
		if (probe?.status !== 200) throw new Error(`${path} did not return 200`)
		if (!probe.body || typeof probe.body !== 'object') throw new Error(`${path} body was not an object`)
		assertExactObject(probe.body, expectedBody, `${path} body`)
	}
	const head = responses.find((candidate) => candidate?.method === 'HEAD' && candidate?.path === '/readyz')
	if (head?.status !== 200) throw new Error('HEAD /readyz did not return 200')
	if (head.bodyLength !== 0) throw new Error('HEAD /readyz returned a body')
	return Object.freeze({
		status: 'passed',
		endpoints: ['/healthz', '/readyz'],
		headReadyz: true,
		unauthenticated: true,
		serverId: expectedServerId,
		version: expectedVersion,
	})
}

export function inspectRuntimeHardening(hardening) {
	if (!hardening || typeof hardening !== 'object') throw new TypeError('hardening report must be an object')
	if (hardening.uid !== '10001' || hardening.gid !== '10001') throw new Error('container process is not running as UID/GID 10001')
	if (hardening.readOnlyRootfs !== true) throw new Error('container root filesystem is not read-only')
	if (hardening.noNewPrivileges !== true) throw new Error('container does not have no-new-privileges enabled')
	if (hardening.capDropAll !== true) throw new Error('container did not drop all Linux capabilities')
	if (hardening.tmpfsTmp !== true) throw new Error('/tmp tmpfs hardening is missing')
	if (hardening.dataRootWritable !== true) throw new Error('data root volume is not writable by the non-root server')
	if (hardening.rootWriteBlocked !== true) throw new Error('read-only root write probe unexpectedly succeeded')
	return Object.freeze({
		uid: hardening.uid,
		gid: hardening.gid,
		readOnlyRootfs: true,
		noNewPrivileges: true,
		capDropAll: true,
		tmpfsTmp: true,
		dataRootWritable: true,
		rootWriteBlocked: true,
	})
}

export function dockerPreflight(docker = 'docker') {
	const result = spawnSync(docker, ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', timeout: 15_000 })
	if (result.error || result.status !== 0) return blocked('docker-unavailable', commandError(result, 'docker version failed'))
	return Object.freeze({ status: 'available', executable: docker, serverVersion: result.stdout.trim() || 'unknown' })
}

export async function runTask20DockerServerSmoke({
	root = process.cwd(),
	docker = 'docker',
	image = `${DEFAULT_IMAGE_PREFIX}:${process.pid}-${randomUUID().slice(0, 8)}`,
	serverId = DEFAULT_SERVER_ID,
	version = DEFAULT_SERVER_VERSION,
} = {}) {
	const preflight = dockerPreflight(docker)
	if (preflight.status !== 'available') return preflight

	const containerName = `terminay-task20-server-${process.pid}-${randomUUID().slice(0, 8)}`
	const volumeName = `${containerName}-data`
	let containerId = ''
	try {
		const build = spawnSync(docker, ['build', '--pull=false', '--file', 'apps/terminay-server/Dockerfile', '--tag', image, '.'], {
			cwd: root,
			encoding: 'utf8',
			timeout: 900_000,
			maxBuffer: 16 * 1024 * 1024,
		})
		if (build.error || build.status !== 0) return blocked('docker-build-failed', commandError(build, 'server image build failed'), preflight)

		const volume = spawnSync(docker, ['volume', 'create', volumeName], { encoding: 'utf8', timeout: 15_000 })
		if (volume.error || volume.status !== 0) return blocked('docker-volume-create-failed', commandError(volume, 'data volume create failed'), preflight)

		const run = spawnSync(docker, [
			'run', '--detach', '--init', '--name', containerName,
			'--read-only',
			'--cap-drop', 'ALL',
			'--security-opt', 'no-new-privileges',
			'--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
			'--volume', `${volumeName}:/var/lib/terminay`,
			'--env', `TERMINAY_SERVER_ID=${serverId}`,
			'--env', `TERMINAY_SERVER_VERSION=${version}`,
			'--env', 'TERMINAY_DATA_ROOT=/var/lib/terminay',
			'--env', 'TERMINAY_ENDPOINT=loopback',
			'--env', 'TERMINAY_HEALTH_HOST=0.0.0.0',
			'--env', String(`TERMINAY_HEALTH_PORT=${DEFAULT_HEALTH_PORT}`),
			image,
		], { encoding: 'utf8', timeout: 30_000 })
		if (run.error || run.status !== 0) return blocked('docker-run-failed', commandError(run, 'server image run failed'), preflight)
		containerId = run.stdout.trim()
		if (containerId.length === 0) return blocked('docker-run-failed', 'server image run returned no container id', preflight)

		const readiness = waitForReadinessLog(docker, containerId)
		const publicReadiness = inspectDockerReadiness(readiness, { serverId, version })
		const health = inspectDockerHealthResponses(readHealthResponses(docker, containerId), { serverId, version })
		const hardening = inspectRuntimeHardening(readRuntimeHardening(docker, containerId))
		const imageUser = inspectImageUser(docker, image)
		if (imageUser !== '10001:10001') throw new DockerSmokeError('docker-image-user-invalid', `image user was ${imageUser || '<empty>'}`)
		const containerState = inspectContainerState(docker, containerId)
		if (containerState !== 'running') throw new DockerSmokeError('docker-container-not-running', `container state was ${containerState}`)

		const stop = spawnSync(docker, ['stop', '--time', '10', containerId], { encoding: 'utf8', timeout: 20_000 })
		if (stop.error || stop.status !== 0) throw new DockerSmokeError('docker-stop-failed', commandError(stop, 'container stop failed'))
		const exit = spawnSync(docker, ['wait', containerId], { encoding: 'utf8', timeout: 10_000 })
		if (exit.error || exit.status !== 0 || exit.stdout.trim() !== '0') throw new DockerSmokeError('docker-stop-failed', `container exit code was ${exit.stdout.trim() || '<unknown>'}`)

		return Object.freeze({
			status: 'passed',
			preflight,
			image,
			imageUser,
			readiness: publicReadiness,
			health,
			hardening,
			lifecycle: Object.freeze({ foreground: true, stopSignal: 'SIGTERM', exitCode: 0 }),
			limitations: [
				'This proves local image lifecycle, non-root/read-only-root hardening, and unauthenticated liveness/readiness only.',
				'It does not prove signed publication, hosted deployment, WebRTC/TURN, or authenticated remote-client connectivity.',
			],
		})
	} catch (error) {
		return blocked(error instanceof DockerSmokeError ? error.blocker : 'docker-smoke-failed', error instanceof Error ? error.message : 'Docker smoke failed', preflight)
	} finally {
		if (containerId.length > 0) spawnSync(docker, ['rm', '--force', containerId], { encoding: 'utf8', timeout: 15_000 })
		spawnSync(docker, ['volume', 'rm', '--force', volumeName], { encoding: 'utf8', timeout: 15_000 })
	}
}

class DockerSmokeError extends Error {
	constructor(blocker, message) {
		super(message)
		this.blocker = blocker
	}
}

function waitForReadinessLog(docker, containerId) {
	const deadline = Date.now() + 60_000
	let lastState = 'unknown'
	while (Date.now() < deadline) {
		const logs = spawnSync(docker, ['logs', containerId], { encoding: 'utf8', timeout: 10_000 })
		for (const line of String(logs.stdout ?? '').split('\n').map((value) => value.trim()).filter(Boolean)) {
			try {
				const record = JSON.parse(line)
				if (record?.ready === true && record?.pairing?.pairingUrl) return record
			} catch {
				// Non-JSON logs are ignored.
			}
		}
		lastState = inspectContainerState(docker, containerId)
		if (lastState !== 'running') throw new DockerSmokeError('docker-readiness-failed', `container exited before readiness (${lastState})`)
		sleep(250)
	}
	throw new DockerSmokeError('docker-readiness-timeout', `timed out waiting for readiness; last state ${lastState}`)
}

function readHealthResponses(docker, containerId) {
	const script = `
const paths = ['/healthz', '/readyz'];
const out = [];
for (const path of paths) {
	const response = await fetch('http://127.0.0.1:${DEFAULT_HEALTH_PORT}' + path);
	out.push({ method: 'GET', path, status: response.status, body: await response.json() });
}
const head = await fetch('http://127.0.0.1:${DEFAULT_HEALTH_PORT}/readyz', { method: 'HEAD' });
out.push({ method: 'HEAD', path: '/readyz', status: head.status, bodyLength: (await head.text()).length });
process.stdout.write(JSON.stringify(out));
`
	const result = spawnSync(docker, ['exec', containerId, 'node', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 15_000 })
	if (result.error || result.status !== 0) throw new DockerSmokeError('docker-health-failed', commandError(result, 'health probes failed'))
	try {
		return JSON.parse(result.stdout)
	} catch {
		throw new DockerSmokeError('docker-health-failed', 'health probes returned invalid JSON')
	}
}

function readRuntimeHardening(docker, containerId) {
	const execReport = spawnSync(docker, ['exec', containerId, 'sh', '-lc', [
		'uid=$(id -u)',
		'gid=$(id -g)',
		'test -w /var/lib/terminay && dataRootWritable=true || dataRootWritable=false',
		'touch /root-write-probe 2>/dev/null && rootWriteBlocked=false || rootWriteBlocked=true',
		'printf \'{"uid":"%s","gid":"%s","dataRootWritable":%s,"rootWriteBlocked":%s}\\n\' "$uid" "$gid" "$dataRootWritable" "$rootWriteBlocked"',
	].join('; ')], { encoding: 'utf8', timeout: 15_000 })
	if (execReport.error || execReport.status !== 0) throw new DockerSmokeError('docker-hardening-exec-failed', commandError(execReport, 'hardening exec failed'))
	let report
	try {
		report = JSON.parse(execReport.stdout)
	} catch {
		throw new DockerSmokeError('docker-hardening-exec-failed', 'hardening exec returned invalid JSON')
	}
	const inspect = spawnSync(docker, ['inspect', '--format', '{{json .HostConfig}}', containerId], { encoding: 'utf8', timeout: 10_000 })
	if (inspect.error || inspect.status !== 0) throw new DockerSmokeError('docker-hardening-inspect-failed', commandError(inspect, 'container inspect failed'))
	let hostConfig
	try {
		hostConfig = JSON.parse(inspect.stdout)
	} catch {
		throw new DockerSmokeError('docker-hardening-inspect-failed', 'container inspect returned invalid JSON')
	}
	const securityOpt = Array.isArray(hostConfig.SecurityOpt) ? hostConfig.SecurityOpt : []
	const capDrop = Array.isArray(hostConfig.CapDrop) ? hostConfig.CapDrop : []
	const tmpfs = hostConfig.Tmpfs && typeof hostConfig.Tmpfs === 'object' ? hostConfig.Tmpfs : {}
	return Object.freeze({
		...report,
		readOnlyRootfs: hostConfig.ReadonlyRootfs === true,
		noNewPrivileges: securityOpt.includes('no-new-privileges'),
		capDropAll: capDrop.includes('ALL') || REQUIRED_DROPPED_CAPABILITIES.every((capability) => capDrop.includes(capability)),
		tmpfsTmp: Object.hasOwn(tmpfs, '/tmp'),
	})
}

function inspectImageUser(docker, image) {
	const result = spawnSync(docker, ['image', 'inspect', '--format', '{{.Config.User}}', image], { encoding: 'utf8', timeout: 10_000 })
	if (result.error || result.status !== 0) throw new DockerSmokeError('docker-image-inspect-failed', commandError(result, 'image inspect failed'))
	return result.stdout.trim()
}

function inspectContainerState(docker, containerId) {
	const result = spawnSync(docker, ['inspect', '--format', '{{.State.Status}}', containerId], { encoding: 'utf8', timeout: 10_000 })
	return result.status === 0 ? result.stdout.trim() : 'unknown'
}

function assertExactObject(actual, expected, label) {
	const actualKeys = Object.keys(actual).sort()
	const expectedKeys = Object.keys(expected).sort()
	if (actualKeys.join('\0') !== expectedKeys.join('\0')) throw new Error(`${label} exposed unexpected fields`)
	for (const [key, value] of Object.entries(expected)) {
		if (actual[key] !== value) throw new Error(`${label}.${key} did not match`)
	}
}

const REQUIRED_DROPPED_CAPABILITIES = Object.freeze([
	'CAP_CHOWN',
	'CAP_DAC_OVERRIDE',
	'CAP_FOWNER',
	'CAP_FSETID',
	'CAP_KILL',
	'CAP_NET_BIND_SERVICE',
	'CAP_SETFCAP',
	'CAP_SETGID',
	'CAP_SETPCAP',
	'CAP_SETUID',
	'CAP_SYS_CHROOT',
])

function blocked(blocker, reason, preflight) {
	return Object.freeze({ status: 'blocked', blocker, reason, ...(preflight === undefined ? {} : { preflight }) })
}

function commandError(result, fallback) {
	if (result.error) return result.error.message
	const lines = `${result.stderr ?? ''}\n${result.stdout ?? ''}`.trim().split('\n').filter(Boolean)
	return lines.at(-1) ?? fallback
}

function sleep(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const report = await runTask20DockerServerSmoke()
	console.log(JSON.stringify(report, null, 2))
	if (process.argv.includes('--strict') && report.status !== 'passed') process.exitCode = 1
}
