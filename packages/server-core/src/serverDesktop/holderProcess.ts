import { closeSync, writeSync } from 'node:fs';
import { DesktopHolder, DesktopHolderLockedError } from './holder.js';

/**
 * Environment a server passes to the desktop holder it starts. Everything
 * the holder needs arrives here. None of it is a secret: the credential and
 * the passwords are files the holder reads or writes itself.
 */
export const DESKTOP_HOLDER_ENV = Object.freeze({
	directory: 'TERMINAY_DESKTOP_HOLDER_DIRECTORY',
	dataRoot: 'TERMINAY_DESKTOP_HOLDER_DATA_ROOT',
	home: 'TERMINAY_DESKTOP_HOLDER_HOME',
	displayServer: 'TERMINAY_DESKTOP_HOLDER_DISPLAY_SERVER',
	passwordTool: 'TERMINAY_DESKTOP_HOLDER_PASSWORD_TOOL',
	python: 'TERMINAY_DESKTOP_HOLDER_PYTHON',
	shell: 'TERMINAY_DESKTOP_HOLDER_SHELL',
	launcher: 'TERMINAY_DESKTOP_HOLDER_LAUNCHER',
	sessionScript: 'TERMINAY_DESKTOP_HOLDER_SESSION',
	preferredDisplay: 'TERMINAY_DESKTOP_HOLDER_PREFERRED_DISPLAY',
	/**
	 * A descriptor the launcher holds the other end of. The holder closes it
	 * once its control socket is listening, or writes why it could not start.
	 */
	readyFd: 'TERMINAY_DESKTOP_HOLDER_READY_FD',
});

/** What a holder writes to the readiness descriptor when the lock is held. */
export const DESKTOP_HOLDER_LOCKED = 'locked';

/** Run this process as the desktop holder until it is told to stop. */
export async function runDesktopHolderProcess(
	env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
	const read = (name: string): string => {
		const value = env[name];
		if (typeof value !== 'string' || value.length === 0)
			throw new Error('desktop holder environment is incomplete');
		return value;
	};
	const readyFd = Number(env[DESKTOP_HOLDER_ENV.readyFd]);
	const report = (text?: string) => {
		if (!Number.isSafeInteger(readyFd) || readyFd <= 2) return;
		try {
			if (text !== undefined) writeSync(readyFd, text.slice(0, 2048));
			closeSync(readyFd);
		} catch {
			/* a launcher that has gone is told nothing */
		}
	};
	process.umask(0o077);
	try {
		const options = {
			directory: read(DESKTOP_HOLDER_ENV.directory),
			dataRoot: read(DESKTOP_HOLDER_ENV.dataRoot),
			home: read(DESKTOP_HOLDER_ENV.home),
			programs: {
				displayServer: read(DESKTOP_HOLDER_ENV.displayServer),
				passwordTool: read(DESKTOP_HOLDER_ENV.passwordTool),
				python: read(DESKTOP_HOLDER_ENV.python),
				shell: read(DESKTOP_HOLDER_ENV.shell),
			},
			launcher: read(DESKTOP_HOLDER_ENV.launcher),
			sessionScript: read(DESKTOP_HOLDER_ENV.sessionScript),
		};
		const preferred = Number(env[DESKTOP_HOLDER_ENV.preferredDisplay]);
		const sessionEnv = { ...env };
		// The launch variables describe this holder, not the desktop's programs.
		for (const name of Object.values(DESKTOP_HOLDER_ENV)) {
			delete sessionEnv[name];
			delete process.env[name];
		}
		const holder = await DesktopHolder.start({
			...options,
			env: sessionEnv,
			...(Number.isSafeInteger(preferred) && preferred > 0
				? { preferredDisplay: preferred }
				: {}),
			onClosed: () => process.exit(0),
		});
		report();
		// Logout and shutdown arrive as SIGTERM: end the desktop, then exit.
		for (const signal of ['SIGTERM', 'SIGINT'] as const)
			process.on(signal, () => void holder.close());
		// A holder has no terminal of its own to hang up on.
		process.on('SIGHUP', () => undefined);
	} catch (error) {
		report(
			error instanceof DesktopHolderLockedError
				? DESKTOP_HOLDER_LOCKED
				: error instanceof Error
					? error.message
					: String(error),
		);
		process.exitCode = 1;
	}
}
