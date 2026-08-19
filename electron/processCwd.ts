import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PROCESS_TABLE_LINE =
	/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S.*?)\s*$/u
const SESSION_PROCESS_LIMIT = 64

export async function resolveTerminalProcessCwd(rootPid: number, signal?: AbortSignal): Promise<string | null> {
	if (!Number.isSafeInteger(rootPid) || rootPid <= 0) return null
	const deepestPid = await resolveDeepestProcessPid(rootPid, signal)
	return (await resolveProcessCwd(deepestPid, signal))
		?? (deepestPid === rootPid ? null : await resolveProcessCwd(rootPid, signal))
}

/** Resolve the process group currently owning the PTY. node-pty's `process`
 * getter is only a best-effort title and is not reliable in packaged Electron
 * on every Unix host; TPGID is the kernel-owned foreground authority.
 *
 * Selection walks only the session process tree. The host process table is one
 * snapshot so a bushy TUI cannot spend the close-observation deadline on
 * per-pid process walks. */
export async function resolveTerminalForegroundProcess(rootPid: number, signal?: AbortSignal): Promise<string | null> {
	if (!Number.isSafeInteger(rootPid) || rootPid <= 0 || process.platform === 'win32') return null
	throwIfAborted(signal)
	const table = await readHostProcessTable(signal)
	const rootCommand = commandName(table.get(rootPid)?.command) ?? await resolveProcessCommand(rootPid, signal)
	const selected = selectForegroundProcessFromTable(rootPid, table, rootCommand)
	if (selected.command !== rootCommand) return selected.command
	if (!selected.consultProcessGroup) return rootCommand
	const groupCommand = await resolveTerminalProcessGroupCommand(rootPid, table, signal)
	if (groupCommand !== null && groupCommand !== rootCommand) return groupCommand
	return rootCommand
}

export function parseHostProcessTable(stdout: string): ReadonlyMap<number, HostProcessRow> {
	const table = new Map<number, HostProcessRow>()
	for (const line of stdout.split('\n')) {
		const match = PROCESS_TABLE_LINE.exec(line)
		if (match === null) continue
		const pid = Number.parseInt(match[1], 10)
		const ppid = Number.parseInt(match[2], 10)
		const pgid = Number.parseInt(match[3], 10)
		const command = commandName(match[5])
		if (!Number.isSafeInteger(pid) || pid <= 0 || command === null) continue
		table.set(pid, {
			pid,
			ppid: Number.isSafeInteger(ppid) && ppid >= 0 ? ppid : 0,
			pgid: Number.isSafeInteger(pgid) && pgid > 0 ? pgid : pid,
			stat: match[4],
			command,
		})
	}
	return table
}

/** Choose the foreground command from an already-scoped process table.
 * A non-shell process that currently owns the TTY wins even when it has helper
 * children. Job-control shells mark that group with `+`; non-job-control shells
 * share their process group with the running command, so same-PGID descendants
 * are still foreground work. */
export function selectForegroundProcessFromTable(
	rootPid: number,
	table: ReadonlyMap<number, HostProcessRow>,
	rootCommand: string | null,
): { readonly command: string | null; readonly consultProcessGroup: boolean } {
	const descendants = resolveSessionDescendants(rootPid, table)
	const foregroundDescendants = descendants.filter(
		(entry) => entry.foreground && entry.command !== rootCommand,
	)
	if (foregroundDescendants.length === 1) {
		return { command: foregroundDescendants[0].command, consultProcessGroup: false }
	}
	if (foregroundDescendants.length > 1) {
		return {
			command: nearestDescendant(foregroundDescendants).command,
			consultProcessGroup: true,
		}
	}
	const rootPgid = table.get(rootPid)?.pgid ?? rootPid
	const groupedDescendants = descendants.filter(
		(entry) => entry.command !== rootCommand && (entry.pgid === rootPgid || entry.pgid === rootPid),
	)
	if (groupedDescendants.length === 1) {
		return { command: groupedDescendants[0].command, consultProcessGroup: false }
	}
	if (groupedDescendants.length > 1) {
		return {
			command: nearestDescendant(groupedDescendants).command,
			consultProcessGroup: true,
		}
	}
	return {
		command: rootCommand,
		consultProcessGroup: descendants.length > 0,
	}
}

export interface HostProcessRow {
	readonly pid: number
	readonly ppid: number
	readonly pgid: number
	readonly stat: string
	readonly command: string
}

function resolveSessionDescendants(
	rootPid: number,
	table: ReadonlyMap<number, HostProcessRow>,
): ReadonlyArray<{ command: string; foreground: boolean; depth: number; pgid: number }> {
	const children = new Map<number, number[]>()
	for (const row of table.values()) {
		const siblings = children.get(row.ppid)
		if (siblings === undefined) children.set(row.ppid, [row.pid])
		else siblings.push(row.pid)
	}
	const pending: Array<{ pid: number; depth: number }> = [{ pid: rootPid, depth: 0 }]
	const visited = new Set<number>([rootPid])
	const descendants: Array<{ command: string; foreground: boolean; depth: number; pgid: number }> = []
	while (pending.length > 0 && visited.size <= SESSION_PROCESS_LIMIT) {
		const current = pending.shift()!
		const next = (children.get(current.pid) ?? []).filter((pid) => !visited.has(pid))
		for (const pid of next) {
			visited.add(pid)
			pending.push({ pid, depth: current.depth + 1 })
			const row = table.get(pid)
			if (row === undefined) continue
			descendants.push({
				command: row.command,
				foreground: row.stat.includes('+'),
				depth: current.depth + 1,
				pgid: row.pgid,
			})
		}
	}
	return descendants
}

function nearestDescendant<T extends { depth: number }>(entries: readonly T[]): T {
	return entries.reduce((nearest, entry) => (entry.depth < nearest.depth ? entry : nearest))
}

async function readHostProcessTable(signal?: AbortSignal): Promise<ReadonlyMap<number, HostProcessRow>> {
	try {
		const command = process.platform === 'linux'
			? ['ps', ['-eo', 'pid=,ppid=,pgid=,stat=,comm=']] as const
			: process.platform === 'darwin'
				? ['ps', ['-axo', 'pid=,ppid=,pgid=,stat=,comm=']] as const
				: null
		if (command === null) return new Map()
		const { stdout } = await execHost(command[0], command[1], signal)
		return parseHostProcessTable(stdout)
	} catch (error) {
		throwIfAborted(signal, error)
		return new Map()
	}
}

async function resolveTerminalProcessGroupCommand(
	rootPid: number,
	table: ReadonlyMap<number, HostProcessRow>,
	signal?: AbortSignal,
): Promise<string | null> {
	try {
		const { stdout: groupOutput } = await execHost('ps', ['-o', 'tpgid=', '-p', String(rootPid)], signal)
		const groupPid = Number.parseInt(groupOutput.trim(), 10)
		if (!Number.isSafeInteger(groupPid) || groupPid <= 0 || groupPid === rootPid) return null
		return commandName(table.get(groupPid)?.command) ?? await resolveProcessCommand(groupPid, signal)
	} catch (error) {
		throwIfAborted(signal, error)
		// TPGID is an enhancement, not a prerequisite: constrained hosts can
		// deny this one ps query while still allowing direct child observation.
		return null
	}
}

async function resolveProcessCommand(pid: number, signal?: AbortSignal): Promise<string | null> {
	try {
		const { stdout } = await execHost('ps', ['-o', 'comm=', '-p', String(pid)], signal)
		return commandName(stdout)
	} catch (error) {
		throwIfAborted(signal, error)
		return null
	}
}

async function resolveDeepestProcessPid(rootPid: number, signal?: AbortSignal): Promise<number> {
	let current = rootPid
	for (let depth = 0; depth < 32; depth += 1) {
		const children = await childProcessIds(current, signal)
		if (children.length !== 1) return current
		current = children[0]
	}
	return current
}

async function childProcessIds(pid: number, signal?: AbortSignal): Promise<number[]> {
	try {
		const command = process.platform === 'linux'
			? ['ps', ['-o', 'pid=', '--ppid', String(pid)]] as const
			: process.platform === 'darwin'
				? ['pgrep', ['-P', String(pid)]] as const
				: null
		if (command === null) return []
		const { stdout } = await execHost(command[0], command[1], signal)
		return stdout.split('\n').map((value) => Number.parseInt(value.trim(), 10))
			.filter((value) => Number.isSafeInteger(value) && value > 0)
	} catch (error) {
		throwIfAborted(signal, error)
		return []
	}
}

async function resolveProcessCwd(pid: number, signal?: AbortSignal): Promise<string | null> {
	try {
		if (process.platform === 'linux') {
			const { stdout } = await execHost('readlink', [`/proc/${pid}/cwd`], signal)
			return stdout.trim() || null
		}
		if (process.platform === 'darwin') {
			const { stdout } = await execHost('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fn', '-p', String(pid)], signal)
			return stdout.split('\n').find((line) => line.startsWith('n'))?.slice(1).trim() || null
		}
	} catch (error) {
		throwIfAborted(signal, error)
		return null
	}
	return null
}

function commandName(value: string | undefined): string | null {
	const command = value?.trim().split(/[\\/]/u).pop()?.trim()
	if (!command) return null
	return command.startsWith('-') ? command.slice(1) || command : command
}

async function execHost(
	command: string,
	args: readonly string[],
	signal?: AbortSignal,
): Promise<{ stdout: string }> {
	throwIfAborted(signal)
	try {
		return await execFileAsync(command, [...args], signal === undefined ? {} : { signal })
	} catch (error) {
		throwIfAborted(signal, error)
		throw error
	}
}

function throwIfAborted(signal?: AbortSignal, error?: unknown): void {
	if (signal?.aborted) throw error ?? signal.reason ?? new Error('foreground observation aborted')
	if (error !== undefined && isAbortError(error)) throw error
}

function isAbortError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false
	const value = error as { name?: unknown; code?: unknown }
	return value.name === 'AbortError' || value.code === 'ABORT_ERR'
}
