import { readlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Why this launch is exiting without a window: another Terminay holds the
 * data directory's single-instance lock. On Linux and macOS Chromium's lock
 * is a `SingletonLock` symlink naming `<host>-<pid>`, so the message names the
 * process to look for. Windows keeps no such file.
 */
export function singleInstanceRefusalMessage(
	userDataPath: string,
	readLink: (path: string) => string = readlinkSync,
): string {
	let owner: string | undefined;
	try {
		const match = /^(.*)-(\d+)$/u.exec(readLink(join(userDataPath, 'SingletonLock')));
		if (match) owner = `process ${match[2]} on ${match[1]}`;
	} catch {
		/* no lock file to read on this platform */
	}
	return [
		`[main] Another Terminay is already running with ${userDataPath}${owner ? ` (${owner})` : ''}.`,
		'It was asked to bring its window forward, and this launch is exiting.',
		'If no window appears, that process is not showing one: end it and launch again.',
	].join(' ');
}
