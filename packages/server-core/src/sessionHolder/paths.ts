import { join } from 'node:path';

/** Session ids are filenames here, so the server's id grammar is enforced. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const GENERATION_PATTERN = /^[a-f0-9]{8,32}$/;

/**
 * macOS limits a Unix socket path to 104 bytes including its terminator and
 * Linux to 108. A data root too deep for that cannot host a holder.
 */
export const SESSION_HOLDER_MAX_SOCKET_PATH_BYTES = 103;

export function sessionHolderDirectory(dataRoot: string): string {
	return join(dataRoot, 'session-holder');
}

export function sessionHolderSocketPath(
	dataRoot: string,
	generation: string,
): string {
	assertGeneration(generation);
	return join(sessionHolderDirectory(dataRoot), `${generation}.sock`);
}

export function sessionHolderRecordPath(
	dataRoot: string,
	generation: string,
): string {
	assertGeneration(generation);
	return join(sessionHolderDirectory(dataRoot), `${generation}.json`);
}

export const SESSION_HOLDER_CLOSE_RECORD_SUFFIX = '.closed';

/**
 * Where a holder leaves the reason it closed. The name is not a holder
 * record's, so a server looking for holders never reads it as one.
 */
export function sessionHolderCloseRecordPath(
	dataRoot: string,
	generation: string,
): string {
	assertGeneration(generation);
	return join(
		sessionHolderDirectory(dataRoot),
		`${generation}${SESSION_HOLDER_CLOSE_RECORD_SUFFIX}`,
	);
}

export function sessionTailsDirectory(dataRoot: string): string {
	return join(dataRoot, 'session-tails');
}

export function sessionTailPath(dataRoot: string, sessionId: string): string {
	assertSessionId(sessionId);
	return join(sessionTailsDirectory(dataRoot), sessionId);
}

export function isSessionHolderGeneration(value: string): boolean {
	return GENERATION_PATTERN.test(value);
}

export function isHolderSessionId(value: unknown): value is string {
	return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

export function socketPathFits(path: string): boolean {
	return Buffer.byteLength(path) <= SESSION_HOLDER_MAX_SOCKET_PATH_BYTES;
}

export interface SessionHolderEnablement {
	readonly dataRoot: string;
	readonly env: Readonly<Record<string, string | undefined>>;
	readonly platform: string;
}

/**
 * Whether a server keeps its terminals in a session holder (ADR-0035).
 *
 * On by default. `TERMINAY_SESSION_HOLDER=0` turns it off. Under the test
 * marker `TERMINAY_TEST=1` it is off unless asked for with
 * `TERMINAY_SESSION_HOLDER=1`, because a holder outlives the process that
 * started it and a test harness that did not ask for one would leave shells
 * running after it finished.
 *
 * It is also off, whatever was asked, where it cannot work: on Windows, and for
 * a data root too deep for the holder's socket path. Terminals then live and
 * end with the server, which is better than terminals that cannot start.
 */
export function sessionHolderEnabled(options: SessionHolderEnablement): boolean {
	if (options.platform === 'win32') return false;
	const requested = options.env.TERMINAY_SESSION_HOLDER;
	if (requested === '0') return false;
	if (requested !== '1' && options.env.TERMINAY_TEST === '1') return false;
	return socketPathFits(
		sessionHolderSocketPath(options.dataRoot, '0'.repeat(16)),
	);
}

function assertGeneration(generation: string): void {
	if (!isSessionHolderGeneration(generation))
		throw new TypeError('session holder generation is invalid');
}

function assertSessionId(sessionId: string): void {
	if (!isHolderSessionId(sessionId))
		throw new TypeError('session id is invalid');
}
