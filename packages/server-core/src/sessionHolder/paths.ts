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

function assertGeneration(generation: string): void {
	if (!isSessionHolderGeneration(generation))
		throw new TypeError('session holder generation is invalid');
}

function assertSessionId(sessionId: string): void {
	if (!isHolderSessionId(sessionId))
		throw new TypeError('session id is invalid');
}
