/**
 * Foreground selection for a Windows terminal session (terminal-workspace,
 * design decision 5). Windows has no controlling terminal or process group, so
 * the foreground is read from the shape of the session's process tree in one
 * snapshot. Pure: the snapshot is gathered elsewhere, through `koffi`.
 */

/** One row of a Toolhelp process snapshot, with the process's start time. */
export interface WindowsProcessRow {
	readonly pid: number;
	readonly ppid: number;
	/** The executable's file name, as Toolhelp reports it (`node.exe`). */
	readonly exe: string;
	/** Creation time in milliseconds since the epoch. */
	readonly createdAt: number;
}

export type WindowsForegroundSelection =
	| {
			readonly kind: 'process';
			readonly pid: number;
			/** The command name without its extension (`node`). */
			readonly command: string;
	  }
	| { readonly kind: 'limited'; readonly reason: 'wsl' | 'no-root' };

const SESSION_PROCESS_LIMIT = 64;
/** Console plumbing that sits beside a shell and is never its work. */
const CONSOLE_HELPERS = new Set(['conhost.exe', 'openconsole.exe']);
/** A WSL session's processes run in the distribution's VM, out of sight. */
const WSL_ROOTS = new Set(['wsl.exe', 'wslhost.exe']);

/**
 * The shell's newest child is its foreground work: a background job started
 * earlier is older. Below that, a single-child chain is unwrapped
 * (`cmd -> npx -> node`), and a branch stops the walk, so a TUI's helpers never
 * replace the TUI. A row whose parent started after it is a reused pid, not a
 * child.
 */
export function selectWindowsForegroundProcess(
	rootPid: number,
	rows: readonly WindowsProcessRow[],
): WindowsForegroundSelection {
	const byPid = new Map<number, WindowsProcessRow>();
	const children = new Map<number, WindowsProcessRow[]>();
	for (const row of rows) byPid.set(row.pid, row);
	for (const row of rows) {
		if (row.pid === row.ppid) continue;
		const parent = byPid.get(row.ppid);
		if (parent === undefined || parent.createdAt > row.createdAt) continue;
		if (CONSOLE_HELPERS.has(row.exe.toLowerCase())) continue;
		const siblings = children.get(row.ppid);
		if (siblings === undefined) children.set(row.ppid, [row]);
		else siblings.push(row);
	}
	const root = byPid.get(rootPid);
	if (root === undefined) return { kind: 'limited', reason: 'no-root' };
	if (WSL_ROOTS.has(root.exe.toLowerCase()))
		return { kind: 'limited', reason: 'wsl' };

	const shellChildren = children.get(root.pid) ?? [];
	if (shellChildren.length === 0) return selected(root);
	let current = shellChildren.reduce((newest, row) =>
		row.createdAt > newest.createdAt ? row : newest,
	);
	for (let depth = 1; depth < SESSION_PROCESS_LIMIT; depth += 1) {
		const next = children.get(current.pid) ?? [];
		if (next.length !== 1) break;
		const only = next[0];
		if (only === undefined) break;
		current = only;
	}
	return selected(current);
}

function selected(row: WindowsProcessRow): WindowsForegroundSelection {
	return { kind: 'process', pid: row.pid, command: commandName(row.exe) };
}

function commandName(exe: string): string {
	const base = exe.split(/[\\/]/u).pop() ?? exe;
	return base.replace(/\.(exe|com|bat|cmd)$/iu, '');
}
