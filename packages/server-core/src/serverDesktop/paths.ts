import { join } from 'node:path';

/**
 * Where the server desktop keeps its files.
 *
 * Everything is derived from the desktop directory, an owner-only directory
 * the host chooses so that its socket paths fit (ADR-0054). Nothing is read
 * from a record to find a socket: a path written in a file is a path anyone
 * running as the account could have written.
 */

/** The display number Terminay asks for first. */
export const SERVER_DESKTOP_PREFERRED_DISPLAY = 765;
/** How far above the preferred number a free one is looked for. */
export const SERVER_DESKTOP_DISPLAY_SCAN = 64;
/** A unix socket path's limit, as for the session holder. */
export const SERVER_DESKTOP_MAX_SOCKET_PATH_BYTES = 103;

export interface ServerDesktopPaths {
	readonly directory: string;
	/** The holder's control socket. */
	readonly control: string;
	/** The display server's RFB socket, mode 0600. */
	readonly rfb: string;
	/** The MIT cookie programs present to the display. */
	readonly cookie: string;
	/** The display server's VNC password file. */
	readonly passwords: string;
	/** The credential the server and the holder prove to each other. */
	readonly secret: string;
	/** The lock the kernel holds for the one live holder. */
	readonly lock: string;
	/** The session's generated configuration. */
	readonly state: string;
	readonly config: string;
	readonly cache: string;
	readonly runtime: string;
	readonly displayLog: string;
	readonly sessionLog: string;
	readonly holderLog: string;
}

export function serverDesktopPaths(directory: string): ServerDesktopPaths {
	return {
		directory,
		control: join(directory, 'holder.sock'),
		rfb: join(directory, 'rfb.sock'),
		cookie: join(directory, 'Xauthority'),
		passwords: join(directory, 'passwd'),
		secret: join(directory, 'secret'),
		lock: join(directory, 'lock.sqlite'),
		state: join(directory, 'state'),
		config: join(directory, 'config'),
		cache: join(directory, 'cache'),
		runtime: join(directory, 'xdg'),
		displayLog: join(directory, 'display.log'),
		sessionLog: join(directory, 'session.log'),
		holderLog: join(directory, 'holder.log'),
	};
}

/** Whether both sockets fit in this directory. */
export function serverDesktopDirectoryFits(directory: string): boolean {
	const paths = serverDesktopPaths(directory);
	return [paths.control, paths.rfb].every(
		(path) => Buffer.byteLength(path) <= SERVER_DESKTOP_MAX_SOCKET_PATH_BYTES,
	);
}

/** Where the chosen display number is remembered, so restarts reuse it. */
export function serverDesktopDisplayRecord(dataRoot: string): string {
	return join(dataRoot, 'server-desktop-display');
}

/** Where "turned off" is remembered. Its own file, never a setting. */
export function serverDesktopOffRecord(dataRoot: string): string {
	return join(dataRoot, 'server-desktop-off');
}

/** The X socket and lock file for a display number. These two are the only
 * desktop files outside Terminay's own directories: `DISPLAY=:<n>` looks
 * nowhere else. */
export function xDisplayFiles(display: number): {
	readonly socket: string;
	readonly lock: string;
} {
	return {
		socket: `/tmp/.X11-unix/X${display}`,
		lock: `/tmp/.X${display}-lock`,
	};
}
