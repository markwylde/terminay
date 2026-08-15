import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PROCESS_TABLE_LINE =
	/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S.*?)\s*$/u

export async function resolveTerminalProcessCwd(rootPid: number, signal?: AbortSignal): Promise<string | null> {
	if (!Number.isSafeInteger(rootPid) || rootPid <= 0) return null
	const deepestPid = await resolveDeepestProcessPid(rootPid, signal)
	return (await resolveProcessCwd(deepestPid, signal))
		?? (deepestPid === rootPid ? null : await resolveProcessCwd(rootPid, signal))
}

/** Resolve the process group currently owning the PTY. node-pty's `process`
 * getter is only a best-effort title and is not reliable in packaged Electron
 * on every Unix host; TPGID is the kernel-owned foreground authority. */
export async function resolveTerminalForegroundProcess(rootPid: number, signal?: AbortSignal): Promise<string | null> {
	if (!Number.isSafeInteger(rootPid) || rootPid <= 0 || process.platform === 'win32') return null
	const table = await readHostProcessTable(signal)
	const rootCommand = commandName(table.get(rootPid)?.command) ?? await resolveProcessCommand(rootPid, signal)
	const descendants = resolveTerminalLeafProcesses(rootPid, table)
	// A '+' in ps STAT is the kernel's foreground process-group marker. It
	// remains reliable when a non-job-control shell shares its process group
	// with the current command, where TPGID alone points back to the shell.
	const foregroundDescendants = descendants.filter(
		(entry) => entry.foreground && entry.command !== rootCommand,
	)
	if (foregroundDescendants.length === 1) {
		return foregroundDescendants[0].command
	}
	const nonShellDescendants = descendants.filter(
		(entry) => entry.command !== rootCommand,
	)
	if (nonShellDescendants.length === 1) {
		return nonShellDescendants[0].command
	}
	// node-pty can expose the current foreground child as its pid instead of
	// the long-lived shell on Linux. In that shape the root itself is the
	// authoritative observation; consulting its terminal process group next
	// can incorrectly replace `sleep` with the shell group leader.
	if (descendants.length === 0 && rootCommand !== null) {
		return rootCommand
	}
	try {
		const { stdout: groupOutput } = await execHost('ps', ['-o', 'tpgid=', '-p', String(rootPid)], signal)
		const groupPid = Number.parseInt(groupOutput.trim(), 10)
		const groupCommand = Number.isSafeInteger(groupPid) && groupPid > 0
			? commandName(table.get(groupPid)?.command) ?? await resolveProcessCommand(groupPid, signal)
			: null
		return groupCommand ?? rootCommand
	} catch {
		// TPGID is an enhancement, not a prerequisite: constrained hosts can
		// deny this one ps query while still allowing direct child observation.
		return rootCommand
	}
}

export function parseHostProcessTable(stdout: string): ReadonlyMap<number, HostProcessRow> {
	const table = new Map<number, HostProcessRow>()
	for (const line of stdout.split('\n')) {
		const match = PROCESS_TABLE_LINE.exec(line)
		if (match === null) continue
		const pid = Number.parseInt(match[1], 10)
		const ppid = Number.parseInt(match[2], 10)
		const command = commandName(match[4])
		if (!Number.isSafeInteger(pid) || pid <= 0 || command === null) continue
		table.set(pid, {
			pid,
			ppid: Number.isSafeInteger(ppid) && ppid >= 0 ? ppid : 0,
			stat: match[3],
			command,
		})
	}
	return table
}

interface HostProcessRow {
	readonly pid: number
	readonly ppid: number
	readonly stat: string
	readonly command: string
}

function resolveTerminalLeafProcesses(
	rootPid: number,
	table: ReadonlyMap<number, HostProcessRow>,
): ReadonlyArray<{ command: string; foreground: boolean }> {
	const children = new Map<number, number[]>()
	for (const row of table.values()) {
		const siblings = children.get(row.ppid)
		if (siblings === undefined) children.set(row.ppid, [row.pid])
		else siblings.push(row.pid)
	}
	const pending = [rootPid]
	const visited = new Set<number>([rootPid])
	const leaves: number[] = []
	while (pending.length > 0 && visited.size <= 64) {
		const parent = pending.shift()!
		const next = (children.get(parent) ?? []).filter((pid) => !visited.has(pid))
		if (next.length === 0) {
			if (parent !== rootPid) leaves.push(parent)
			continue
		}
		for (const child of next) {
			visited.add(child)
			pending.push(child)
		}
	}
	return leaves.flatMap((pid) => {
		const row = table.get(pid)
		return row === undefined ? [] : [{ command: row.command, foreground: row.stat.includes('+') }]
	})
}

async function readHostProcessTable(signal?: AbortSignal): Promise<ReadonlyMap<number, HostProcessRow>> {
	try {
		const command = process.platform === 'linux'
			? ['ps', ['-eo', 'pid=,ppid=,stat=,comm=']] as const
			: process.platform === 'darwin'
				? ['ps', ['-axo', 'pid=,ppid=,stat=,comm=']] as const
				: null
		if (command === null) return new Map()
		const { stdout } = await execHost(command[0], command[1], signal)
		return parseHostProcessTable(stdout)
	} catch {
		return new Map()
	}
}

async function resolveProcessCommand(pid: number, signal?: AbortSignal): Promise<string | null> {
	try {
		const { stdout } = await execHost('ps', ['-o', 'comm=', '-p', String(pid)], signal)
		return commandName(stdout)
	} catch {
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
	} catch {
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
	} catch {
		return null
	}
	return null
}

function commandName(value: string | undefined): string | null {
	const command = value?.trim().split(/[\\/]/u).pop()?.trim()
	return command ? command : null
}

async function execHost(
	command: string,
	args: readonly string[],
	signal?: AbortSignal,
): Promise<{ stdout: string }> {
	try {
		return await execFileAsync(command, [...args], signal === undefined ? {} : { signal })
	} catch (error) {
		if (signal?.aborted) throw error
		if (signal !== undefined) return await execFileAsync(command, [...args])
		throw error
	}
}
