/**
 * The desktop session every Terminay desktop runs: one script that starts the
 * same XFCE environment on whichever display it is given.
 *
 * The build copies the script into this package's compiled output, so it
 * travels wherever `dist` does.
 */

import { fileURLToPath } from 'node:url';

/** The directory holding the session script and its configuration. */
export function desktopSessionDirectory(): string {
	return fileURLToPath(new URL('../session-assets/', import.meta.url));
}

/** The session script's file name inside that directory. */
export const DESKTOP_SESSION_SCRIPT = 'terminay-desktop-session';

/**
 * The launcher that starts the display server unable to open a network
 * connection. A Python script, run as `python3 -I <launcher> <program> ...`;
 * `--probe` in place of a program checks that the restriction holds here.
 */
export const DISPLAY_LAUNCHER_SCRIPT = 'terminay-display-launcher';
