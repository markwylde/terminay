import { createHash, randomBytes } from 'node:crypto'
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** The renamed runtime, so it is never mistaken for Terminay or killed as it. */
export const HOLDER_RUNTIME_EXECUTABLE = 'terminay-session-holder.exe'
const COMPLETE_MARKER = '.complete'

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
	const root = holderRuntimeRoot(options.dataRoot)
	const target = join(root, holderRuntimeKey(options.buildId))
	const runtime = {
		executablePath: join(target, HOLDER_RUNTIME_EXECUTABLE),
		entryPath: join(target, 'app', 'dist-electron', 'sessionHolderEntry.js'),
	}
	if (existsSync(join(target, COMPLETE_MARKER))) return runtime
	mkdirSync(root, { recursive: true })
	const staging = `${target}.${randomBytes(4).toString('hex')}.tmp`
	try {
		copyHolderRuntime(options, staging)
		writeFileSync(join(staging, COMPLETE_MARKER), options.buildId)
		rmSync(target, { recursive: true, force: true })
		renameSync(staging, target)
	} catch (error) {
		rmSync(staging, { recursive: true, force: true })
		// Another server of this build finished first.
		if (existsSync(join(target, COMPLETE_MARKER))) return runtime
		throw error
	}
	return runtime
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
