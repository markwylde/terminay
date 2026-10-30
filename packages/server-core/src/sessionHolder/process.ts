import { closeSync, writeSync } from 'node:fs';
import type { NodePtyModuleLike } from '../terminalService/nodePty.js';
import { SessionHolder } from './holder.js';
import { isSessionHolderGeneration, type SessionHolderAddressing } from './paths.js';

/**
 * Environment a server passes to the holder process it starts. Everything a
 * holder needs arrives here, so it reads nothing else from its installation
 * after start-up (ADR-0035).
 */
export const SESSION_HOLDER_ENV = Object.freeze({
	dataRoot: 'TERMINAY_SESSION_HOLDER_DATA_ROOT',
	generation: 'TERMINAY_SESSION_HOLDER_GENERATION',
	buildId: 'TERMINAY_SESSION_HOLDER_BUILD_ID',
	limitMs: 'TERMINAY_SESSION_HOLDER_LIMIT_MS',
	/** Windows: the user's SID, which names the holder's pipe. */
	userSid: 'TERMINAY_SESSION_HOLDER_USER_SID',
	/**
	 * A descriptor the launcher holds the other end of. The holder closes it
	 * once its record is in place, which is how the launcher hears it is
	 * ready: a directory watch can miss the record on a loaded machine.
	 */
	readyFd: 'TERMINAY_SESSION_HOLDER_READY_FD',
});

/**
 * Run this process as a session holder until it has nothing left to hold.
 * The host entry point supplies its own `node-pty`, loaded eagerly.
 */
export async function runSessionHolderProcess(
	nodePty: NodePtyModuleLike,
	env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
	const dataRoot = env[SESSION_HOLDER_ENV.dataRoot];
	const generation = env[SESSION_HOLDER_ENV.generation];
	const buildId = env[SESSION_HOLDER_ENV.buildId];
	if (
		typeof dataRoot !== 'string' ||
		dataRoot.length === 0 ||
		typeof generation !== 'string' ||
		!isSessionHolderGeneration(generation) ||
		typeof buildId !== 'string' ||
		buildId.length === 0
	)
		throw new Error('session holder environment is incomplete');
	const addressing = holderAddressing(env[SESSION_HOLDER_ENV.userSid]);
	const readyFd = Number(env[SESSION_HOLDER_ENV.readyFd]);
	process.umask(0o077);
	// The launch variables describe this holder, not the shells it starts.
	for (const name of Object.values(SESSION_HOLDER_ENV)) delete process.env[name];
	const holder = await SessionHolder.start({
		dataRoot,
		generation,
		buildId,
		nodePty,
		limitMs: parseLimit(env[SESSION_HOLDER_ENV.limitMs]),
		// A Windows pipe name can be taken first by anyone (ADR-0083 §3).
		requireMutualProof: process.platform === 'win32',
		addressing,
		onClosed: () => process.exit(0),
	});
	// The record is in place: say so, and leave no shell this descriptor.
	readinessClosed = true;
	if (Number.isSafeInteger(readyFd) && readyFd > 2)
		try {
			closeSync(readyFd);
		} catch {
			/* a launcher that gave none, or has gone, is told nothing */
		}
	// Logout and shutdown arrive as SIGTERM: save tails, then end sessions.
	for (const signal of ['SIGTERM', 'SIGINT'] as const)
		process.on(signal, () => void holder.close('signal', { signal }));
	// Observed, not handled: the process still dies of the error.
	process.on('uncaughtExceptionMonitor', (error) => holder.recordCrash(error));
	// A holder has no terminal of its own to hang up on.
	process.on('SIGHUP', () => undefined);
}

/** Longest start-up failure reason sent to the launcher, in bytes. */
export const SESSION_HOLDER_FAILURE_REASON_BYTES = 2048;

// Once closed, the readiness descriptor's number may belong to anything.
let readinessClosed = false;

/**
 * Tell the launcher why this holder cannot start, over the readiness
 * descriptor it is waiting on. A detached holder's own output is read by no
 * one, so this is how the reason reaches the server's diagnostics. `env` is the
 * environment the holder was launched with: the launch variables are removed
 * from `process.env` once start-up begins.
 */
export function reportSessionHolderStartupFailure(
	reason: string,
	env: NodeJS.ProcessEnv,
): void {
	const readyFd = Number(env[SESSION_HOLDER_ENV.readyFd]);
	if (readinessClosed || !Number.isSafeInteger(readyFd) || readyFd <= 2)
		return;
	try {
		writeSync(readyFd, boundedUtf8(reason, SESSION_HOLDER_FAILURE_REASON_BYTES));
	} catch {
		/* a launcher that has gone is told nothing */
	}
}

/**
 * Why a native module could not be loaded. A loader that searches several
 * places often reports only the last one, which on Linux names a prebuild that
 * was never shipped. The operating system's error for each addon that is
 * present says what is actually wrong, such as a glibc version the host lacks.
 */
export function describeNativeModuleLoadFailure(
	error: unknown,
	load: (path: string) => unknown,
	presentAddons: readonly string[],
): string {
	const reasons = [errorMessage(error)];
	for (const addon of presentAddons) {
		try {
			load(addon);
		} catch (addonError) {
			const message = errorMessage(addonError);
			if (!reasons.some((reason) => reason.includes(message)))
				reasons.push(`${addon}: ${message}`);
		}
	}
	return reasons.join('; ');
}

function errorMessage(error: unknown): string {
	return (error instanceof Error ? error.message : String(error))
		.split('\n', 1)[0]
		?.trim() ?? '';
}

function boundedUtf8(text: string, maxBytes: number): Buffer {
	const bytes = Buffer.from(text, 'utf8');
	if (bytes.length <= maxBytes) return bytes;
	let end = maxBytes;
	// Never cut inside a multi-byte character.
	while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
	return bytes.subarray(0, end);
}

/**
 * A Windows holder's pipe is named for its user. The launching server, which
 * runs as the same user, says who that is, so the holder loads no Win32
 * bindings of its own.
 */
function holderAddressing(
	userSid: string | undefined,
): SessionHolderAddressing {
	if (process.platform !== 'win32') return { platform: process.platform };
	if (userSid === undefined || userSid === '')
		throw new Error('session holder environment is incomplete');
	return { platform: 'win32', userSid };
}

function parseLimit(value: string | undefined): number | null {
	if (value === undefined || value === '' || value === 'none') return null;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0)
		throw new Error('session holder limit is invalid');
	return parsed;
}
