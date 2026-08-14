import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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
	const rootCommand = await resolveProcessCommand(rootPid, signal)
	const descendants = await resolveTerminalLeafProcesses(rootPid, signal)
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
		const { stdout: groupOutput } = await execFileAsync('ps', ['-o', 'tpgid=', '-p', String(rootPid)], { signal })
		const groupPid = Number.parseInt(groupOutput.trim(), 10)
		const groupCommand = Number.isSafeInteger(groupPid) && groupPid > 0
			? await resolveProcessCommand(groupPid, signal)
			: null
		return groupCommand ?? rootCommand
	} catch {
		// TPGID is an enhancement, not a prerequisite: constrained hosts can
		// deny this one ps query while still allowing direct child observation.
		return rootCommand
	}
}

async function resolveTerminalLeafProcesses(
	rootPid: number,
	signal?: AbortSignal,
): Promise<ReadonlyArray<{ command: string; foreground: boolean }>> {
	const pending = [rootPid]
	const visited = new Set<number>([rootPid])
	const leaves: number[] = []
	while (pending.length > 0 && visited.size <= 64) {
		const parent = pending.shift()!
		const children = (await childProcessIds(parent, signal)).filter(
			(pid) => !visited.has(pid),
		)
		if (children.length === 0) {
			if (parent !== rootPid) leaves.push(parent)
			continue
		}
		for (const child of children) {
			visited.add(child)
			pending.push(child)
		}
	}
	return (
		await Promise.all(leaves.map((pid) => resolveProcessObservation(pid, signal)))
	).filter((entry): entry is { command: string; foreground: boolean } => entry !== null)
}

async function resolveProcessObservation(
	pid: number,
	signal?: AbortSignal,
): Promise<{ command: string; foreground: boolean } | null> {
	try {
		const { stdout } = await execFileAsync('ps', ['-o', 'stat=,comm=', '-p', String(pid)], { signal })
		const line = stdout.trim()
		const match = /^(\S+)\s+(.+)$/u.exec(line)
		if (match === null) return null
		const command = match[2].trim().split(/[\\/]/u).pop()?.trim()
		return command ? { command, foreground: match[1].includes('+') } : null
	} catch {
		return null
	}
}

async function resolveProcessCommand(pid: number, signal?: AbortSignal): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync('ps', ['-o', 'comm=', '-p', String(pid)], { signal })
		const command = stdout.trim().split(/[\\/]/u).pop()?.trim()
		return command || null
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
			? ['ps', ['-eo', 'pid=,ppid=']] as const
			: process.platform === 'darwin'
				? ['pgrep', ['-P', String(pid)]] as const
				: null
		if (command === null) return []
		const { stdout } = await execFileAsync(command[0], command[1], { signal })
		if (process.platform === 'linux') {
			return stdout
				.split('\n')
				.flatMap((value) => {
					const match = /^(\d+)\s+(\d+)$/u.exec(value.trim())
					if (match === null) return []
					const childPid = Number.parseInt(match[1], 10)
					const parentPid = Number.parseInt(match[2], 10)
					return Number.isSafeInteger(childPid) && parentPid === pid
						? [childPid]
						: []
				})
		}
		return stdout.split('\n').map((value) => Number.parseInt(value.trim(), 10))
			.filter((value) => Number.isSafeInteger(value) && value > 0)
	} catch {
		return []
	}
}

async function resolveProcessCwd(pid: number, signal?: AbortSignal): Promise<string | null> {
	try {
		if (process.platform === 'linux') {
			const { stdout } = await execFileAsync('readlink', [`/proc/${pid}/cwd`], { signal })
			return stdout.trim() || null
		}
		if (process.platform === 'darwin') {
			const { stdout } = await execFileAsync('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fn', '-p', String(pid)], { signal })
			return stdout.split('\n').find((line) => line.startsWith('n'))?.slice(1).trim() || null
		}
	} catch {
		return null
	}
	return null
}
