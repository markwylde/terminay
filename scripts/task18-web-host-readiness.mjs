import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const TASK18_WEB_MANAGER_ORIGIN = 'https://app.terminay.com'
const WEB_PACKAGE = 'apps/terminay-web'
const ARTIFACTS = ['dist/index.js', 'dist/index.d.ts']

/**
 * Validate only the locally reproducible web-host release contract. This
 * deliberately does not perform network requests or claim public deployment,
 * DNS, TLS, or CDN verification.
 */
export async function inspectTask18WebHostReadiness(root = process.cwd()) {
	const packageRoot = join(root, WEB_PACKAGE)
	const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
	if (packageJson.name !== '@terminay/web') throw new Error('web host package name is invalid')
	if (packageJson.type !== 'module') throw new Error('web host must be an ES module')
	if (packageJson.exports?.['.']?.import !== './dist/index.js') throw new Error('web host import export must point to dist/index.js')
	if (packageJson.exports?.['.']?.types !== './dist/index.d.ts') throw new Error('web host type export must point to dist/index.d.ts')
	if (!Array.isArray(packageJson.files) || !packageJson.files.includes('dist')) throw new Error('web host package must publish dist')

	const artifactEntries = []
	for (const relativePath of ARTIFACTS) {
		const absolutePath = join(packageRoot, relativePath)
		const details = await stat(absolutePath)
		if (!details.isFile() || details.size === 0) throw new Error(`web host artifact is missing or empty: ${relativePath}`)
		const bytes = await readFile(absolutePath)
		artifactEntries.push({ path: `${WEB_PACKAGE}/${relativePath}`, bytes: bytes.length, sha256: sha256(bytes) })
	}

	const moduleUrl = `${pathToFileURL(join(packageRoot, 'dist/index.js')).href}?task18=${artifactEntries[0].sha256}`
	const webHost = await import(moduleUrl)
	if (webHost.WEB_MANAGER_ORIGIN !== TASK18_WEB_MANAGER_ORIGIN) throw new Error('web host manager origin is not the stable origin')
	if (typeof webHost.WebConnectionHost !== 'function') throw new Error('web connection host export is missing')

	const host = new webHost.WebConnectionHost({ storage: memoryStorage() })
	const initial = host.snapshot()
	if (initial.profiles.profiles.some((profile) => profile.isLocal === true)) throw new Error('web host must not invent a Local profile')
	if (host.openManager() !== TASK18_WEB_MANAGER_ORIGIN) throw new Error('web host manager navigation is not stable')
	const profile = host.addConnection({
		id: 'task18-readiness',
		serverId: 'task18-server',
		label: 'Task 18 readiness',
		origin: 'https://task18-session.example.test',
		status: 'connected',
	})
	const opened = host.open(profile.id, { route: 'settings', projectId: 'task18-project' })
	if (opened.url !== 'https://task18-session.example.test/?route=settings&project=task18-project') {
		throw new Error('web host session navigation is not exact-origin and route-only')
	}

	return {
		schemaVersion: 1,
		package: { name: packageJson.name, version: packageJson.version, import: packageJson.exports['.'].import, types: packageJson.exports['.'].types },
		managerOrigin: TASK18_WEB_MANAGER_ORIGIN,
		artifacts: artifactEntries,
		localProfilePresent: false,
		exactOriginRouteNavigation: true,
		externalDeploymentVerified: false,
		publicDnsVerified: false,
		verificationScope: 'local package, build output, and host contract only',
	}
}

function memoryStorage() {
	const values = new Map()
	return {
		getItem(key) { return values.has(key) ? values.get(key) : null },
		setItem(key, value) { values.set(key, value) },
		removeItem(key) { values.delete(key) },
	}
}

function sha256(value) {
	return createHash('sha256').update(value).digest('hex')
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const root = process.cwd()
	const readiness = await inspectTask18WebHostReadiness(root)
	const outputPath = process.env.TERMINAY_TASK18_READINESS_OUTPUT
	if (outputPath) await writeFile(resolve(outputPath), `${JSON.stringify(readiness, null, 2)}\n`)
	console.log(JSON.stringify(readiness))
}
