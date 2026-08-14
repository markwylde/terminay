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
	try {
		const { stdout: groupOutput } = await execFileAsync('ps', ['-o', 'tpgid=', '-p', String(rootPid)], { signal })
		const groupPid = Number.parseInt(groupOutput.trim(), 10)
		if (Number.isSafeInteger(groupPid) && groupPid > 0 && groupPid !== rootPid) {
			const command = await resolveProcessCommand(groupPid, signal)
			if (command !== null) return command
		}

		// Some PTY hosts keep the shell and its foreground job in one process
		// group. In that case TPGID points back to the shell and cannot identify
		// the destructive foreground child. Follow the single-child shell chain
		// before falling back to the shell title reported by node-pty.
		const deepestPid = await resolveDeepestProcessPid(rootPid, signal)
		if (deepestPid !== rootPid) {
			const command = await resolveProcessCommand(deepestPid, signal)
			if (command !== null) return command
		}
		return groupPid === rootPid ? await resolveProcessCommand(rootPid, signal) : null
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
			? ['ps', ['-o', 'pid=', '--ppid', String(pid)]] as const
			: process.platform === 'darwin'
				? ['pgrep', ['-P', String(pid)]] as const
				: null
		if (command === null) return []
		const { stdout } = await execFileAsync(command[0], command[1], { signal })
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
