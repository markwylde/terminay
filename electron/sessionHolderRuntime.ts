import { createHash, randomBytes } from 'node:crypto'
import {
	closeSync,
	cpSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	renameSync,
	rmSync,
	statSync,
} from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { writeFileDurablySync } from '../packages/server-core/src/durableFile.ts'

/** The renamed runtime, so it is never mistaken for Terminay or killed as it. */
export const HOLDER_RUNTIME_EXECUTABLE = 'terminay-session-holder.exe'
const COMPLETE_MARKER = '.complete'
const MANIFEST = 'manifest.json'

export interface HolderRuntimeOptions {
	/** The installed `Terminay.exe`. */
	readonly executablePath: string
	/** The installation's `resources` directory. */
	readonly resourcesPath: string
	readonly dataRoot: string
	readonly buildId: string
}

export interface HolderRuntime {
	readonly executablePath: string
	readonly entryPath: string
	/** How this launch obtained the copy, and how long checking it took. */
	readonly verification: {
		readonly outcome: 'reused' | 'copied' | 'recopied-corrupt'
		readonly durationMs: number
	}
}

interface ManifestEntry {
	readonly path: string
	readonly size: number
	readonly sha256: string
}

/**
 * Windows: the runtime a holder runs from, copied out of the installation
 * (persistent-terminal-sessions, design decision 4). A running image cannot be
 * replaced, so a holder run from the installation would block every update,
 * and the installer kills processes by Terminay's name. The copy holds the
 * executable and its runtime files, the holder bundle, and the unpacked
 * `node-pty`. One copy serves every holder of a build; it is made beside its
 * final name and renamed into place, so a half-made copy is never run.
 */
export function prepareHolderRuntime(options: HolderRuntimeOptions): HolderRuntime {
	const started = Date.now()
	const root = holderRuntimeRoot(options.dataRoot)
	const target = join(root, holderRuntimeKey(options.buildId))
	const paths = {
		executablePath: join(target, HOLDER_RUNTIME_EXECUTABLE),
		entryPath: join(target, 'app', 'dist-electron', 'sessionHolderEntry.js'),
	}
	const done = (outcome: HolderRuntime['verification']['outcome']): HolderRuntime => ({
		...paths,
		verification: { outcome, durationMs: Date.now() - started },
	})
	let outcome: HolderRuntime['verification']['outcome'] = 'copied'
	if (existsSync(join(target, COMPLETE_MARKER))) {
		// ADR-0088: a copy proves itself before it runs. After a power loss its
		// files can be the right size and all zeros.
		if (verifyHolderRuntime(target, options.buildId)) return done('reused')
		renameSync(target, `${target}.corrupt-${Date.now()}`)
		outcome = 'recopied-corrupt'
	}
	mkdirSync(root, { recursive: true })
	const staging = `${target}.${randomBytes(4).toString('hex')}.tmp`
	try {
		copyHolderRuntime(options, staging)
		const files = listFiles(staging)
		const manifest: ManifestEntry[] = files.map((path) => ({
			path: relative(staging, path).split(sep).join('/'),
			size: statSync(path).size,
			sha256: hashFile(path),
		}))
		// Flush every copied file and directory before the copy is marked
		// complete, so the marker can never outlive the bytes it vouches for.
		for (const path of files) flushFile(path)
		writeFileDurablySync(
			join(staging, MANIFEST),
			JSON.stringify({ buildId: options.buildId, files: manifest }),
		)
		writeFileDurablySync(join(staging, COMPLETE_MARKER), options.buildId)
		flushDirectories(staging)
		rmSync(target, { recursive: true, force: true })
		renameSync(staging, target)
		flushDirectory(root)
	} catch (error) {
		rmSync(staging, { recursive: true, force: true })
		// Another server of this build finished first.
		if (verifyHolderRuntime(target, options.buildId)) return done('reused')
		throw error
	}
	return done(outcome)
}

/** True when every file the copy's manifest lists has its recorded size and
 * digest. A missing or unreadable manifest fails, so the copy is made again. */
export function verifyHolderRuntime(target: string, buildId: string): boolean {
	let manifest: { buildId?: unknown; files?: unknown }
	try {
		manifest = JSON.parse(readFileSync(join(target, MANIFEST), 'utf8'))
	} catch {
		return false
	}
	if (manifest.buildId !== buildId || !Array.isArray(manifest.files)) return false
	if (manifest.files.length === 0) return false
	for (const entry of manifest.files as ManifestEntry[]) {
		if (typeof entry?.path !== 'string' || entry.path.includes('..')) return false
		const path = join(target, ...entry.path.split('/'))
		try {
			if (statSync(path).size !== entry.size) return false
			if (hashFile(path) !== entry.sha256) return false
		} catch {
			return false
		}
	}
	return true
}

function listFiles(directory: string): string[] {
	const files: string[] = []
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name)
		if (entry.isDirectory()) files.push(...listFiles(path))
		else if (entry.isFile()) files.push(path)
	}
	return files.sort()
}

function hashFile(path: string): string {
	const hash = createHash('sha256')
	const fd = openSync(path, 'r')
	try {
		const buffer = Buffer.allocUnsafe(1 << 20)
		for (;;) {
			const read = readSync(fd, buffer, 0, buffer.length, null)
			if (read === 0) break
			hash.update(buffer.subarray(0, read))
		}
	} finally {
		closeSync(fd)
	}
	return hash.digest('hex')
}

function flushFile(path: string): void {
	// Windows flushes a file only through a handle that may write it.
	const fd = openSync(path, 'r+')
	try {
		fsyncSync(fd)
	} finally {
		closeSync(fd)
	}
}

function flushDirectory(directory: string): void {
	if (process.platform === 'win32') return
	try {
		const fd = openSync(directory, 'r')
		try {
			fsyncSync(fd)
		} finally {
			closeSync(fd)
		}
	} catch {
		/* a directory flush is not available everywhere */
	}
}

function flushDirectories(directory: string): void {
	for (const entry of readdirSync(directory, { withFileTypes: true }))
		if (entry.isDirectory()) flushDirectories(join(directory, entry.name))
	flushDirectory(directory)
}

/**
 * Remove every other build's copy whose holder has gone. Windows refuses to
 * delete an image a process is running, so the executable is removed first,
 * and a copy whose executable will not go is still in use and kept whole.
 */
export function pruneHolderRuntimes(dataRoot: string, keepBuildId: string): void {
	const root = holderRuntimeRoot(dataRoot)
	const keep = holderRuntimeKey(keepBuildId)
	let names: string[]
	try {
		names = readdirSync(root)
	} catch {
		return
	}
	for (const name of names) {
		if (name === keep) continue
		const directory = join(root, name)
		try {
			rmSync(join(directory, HOLDER_RUNTIME_EXECUTABLE), { force: true })
		} catch {
			continue
		}
		rmSync(directory, { recursive: true, force: true })
	}
}

export function holderRuntimeRoot(dataRoot: string): string {
	return join(dataRoot, 'holder-runtime')
}

function holderRuntimeKey(buildId: string): string {
	return createHash('sha256').update(buildId).digest('hex').slice(0, 16)
}

function copyHolderRuntime(options: HolderRuntimeOptions, target: string): void {
	const installation = dirname(options.executablePath)
	const executable = basename(options.executablePath).toLowerCase()
	mkdirSync(target, { recursive: true })
	// The executable's own directory holds the runtime it needs as plain Node:
	// its DLLs, ICU data and V8 snapshots. Folders hold the app and its locales.
	for (const name of readdirSync(installation)) {
		const source = join(installation, name)
		if (!statSync(source).isFile()) continue
		const lower = name.toLowerCase()
		if (lower.startsWith('uninstall')) continue
		cpSync(
			source,
			join(target, lower === executable ? HOLDER_RUNTIME_EXECUTABLE : name),
		)
	}
	const unpacked = join(options.resourcesPath, 'app.asar.unpacked')
	const app = join(target, 'app')
	cpSync(join(unpacked, 'dist-electron'), join(app, 'dist-electron'), {
		recursive: true,
	})
	cpSync(
		join(unpacked, 'node_modules', 'node-pty'),
		join(app, 'node_modules', 'node-pty'),
		{ recursive: true },
	)
}
