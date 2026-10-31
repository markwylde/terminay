/**
 * What a Windows terminal is doing, from one process snapshot: its foreground
 * command and its working directory (terminal-workspace, design decision 5).
 * The Win32 reads are injected so the composition is tested on any host.
 */
import { readWindowsProcessCwd, readWindowsProcessTable } from './windows.js';
import {
	selectWindowsForegroundProcess,
	type WindowsProcessRow,
} from './windowsSelection.js';

export interface WindowsTerminalObservationHost {
	readonly readProcessTable: () => readonly WindowsProcessRow[] | null;
	readonly readProcessCwd: (pid: number) => string | null;
}

export const DEFAULT_WINDOWS_TERMINAL_HOST: WindowsTerminalObservationHost = {
	readProcessTable: readWindowsProcessTable,
	readProcessCwd: readWindowsProcessCwd,
};

/** The foreground command, or `null` when the terminal cannot be observed. */
export function windowsTerminalForegroundCommand(
	rootPid: number,
	host: WindowsTerminalObservationHost = DEFAULT_WINDOWS_TERMINAL_HOST,
): string | null {
	const rows = host.readProcessTable();
	if (rows === null) return null;
	const selection = selectWindowsForegroundProcess(rootPid, rows);
	return selection.kind === 'process' ? selection.command : null;
}

/**
 * The foreground process's directory, falling back to the shell's. A WSL
 * terminal reports `null`: its directory lives inside the distribution.
 */
export function windowsTerminalCwd(
	rootPid: number,
	host: WindowsTerminalObservationHost = DEFAULT_WINDOWS_TERMINAL_HOST,
): string | null {
	const rows = host.readProcessTable();
	if (rows === null) return null;
	const selection = selectWindowsForegroundProcess(rootPid, rows);
	if (selection.kind === 'limited') return null;
	return (
		host.readProcessCwd(selection.pid) ??
		(selection.pid === rootPid ? null : host.readProcessCwd(rootPid))
	);
}
