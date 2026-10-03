import {
	chmodSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
	isHolderSessionId,
	sessionTailPath,
	sessionTailsDirectory,
} from './paths.js';
import type { HolderExitRecord } from './protocol.js';

/**
 * The last output of a session that ended with no server attached.
 *
 * This is the only place terminal output reaches disk outside recordings
 * (ADR-0035). It is bounded by the holder's ring, owner-only, and removed with
 * the panel it belongs to.
 */
export interface SessionTail {
	readonly sessionId: string;
	/** Output position of the first saved byte. */
	readonly bufferedFrom: number;
	readonly outputPosition: number;
	readonly exit?: HolderExitRecord;
	readonly savedAt: number;
	/** Geometry the output was produced at, so it can be shown as it was. */
	readonly cols?: number;
	readonly rows?: number;
	readonly cwd?: string;
	readonly bytes: Uint8Array;
}

/** `[u32 headerLength][header JSON][bytes]`, header length big-endian. */
export function writeSessionTail(dataRoot: string, tail: SessionTail): void {
	const directory = sessionTailsDirectory(dataRoot);
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	chmodSync(directory, 0o700);
	const header = Buffer.from(
		JSON.stringify({
			sessionId: tail.sessionId,
			bufferedFrom: tail.bufferedFrom,
			outputPosition: tail.outputPosition,
			...(tail.exit === undefined ? {} : { exit: tail.exit }),
			savedAt: tail.savedAt,
			...(tail.cols === undefined ? {} : { cols: tail.cols }),
			...(tail.rows === undefined ? {} : { rows: tail.rows }),
			...(tail.cwd === undefined ? {} : { cwd: tail.cwd }),
		}),
		'utf8',
	);
	const file = new Uint8Array(4 + header.byteLength + tail.bytes.byteLength);
	new DataView(file.buffer).setUint32(0, header.byteLength, false);
	file.set(header, 4);
	file.set(tail.bytes, 4 + header.byteLength);
	const target = sessionTailPath(dataRoot, tail.sessionId);
	const temporary = `${target}.tmp`;
	writeFileSync(temporary, file, { mode: 0o600 });
	chmodSync(temporary, 0o600);
	renameSync(temporary, target);
}

/** A missing or unreadable tail is simply absent; it never fails a restore. */
export function readSessionTail(
	dataRoot: string,
	sessionId: string,
): SessionTail | undefined {
	if (!isHolderSessionId(sessionId)) return undefined;
	let file: Buffer;
	try {
		file = readFileSync(sessionTailPath(dataRoot, sessionId));
	} catch {
		return undefined;
	}
	try {
		if (file.byteLength < 4) return undefined;
		const headerLength = new DataView(
			file.buffer,
			file.byteOffset,
			file.byteLength,
		).getUint32(0, false);
		if (headerLength > file.byteLength - 4) return undefined;
		const header = JSON.parse(
			file.subarray(4, 4 + headerLength).toString('utf8'),
		) as Record<string, unknown>;
		if (header.sessionId !== sessionId) return undefined;
		const bufferedFrom = header.bufferedFrom;
		const outputPosition = header.outputPosition;
		const savedAt = header.savedAt;
		if (
			!isPosition(bufferedFrom) ||
			!isPosition(outputPosition) ||
			!isPosition(savedAt)
		)
			return undefined;
		const bytes = new Uint8Array(file.subarray(4 + headerLength));
		if (bufferedFrom + bytes.byteLength !== outputPosition) return undefined;
		const exit = parseExit(header.exit);
		return {
			sessionId,
			bufferedFrom,
			outputPosition,
			...(exit === undefined ? {} : { exit }),
			savedAt,
			...(isDimension(header.cols) ? { cols: header.cols } : {}),
			...(isDimension(header.rows) ? { rows: header.rows } : {}),
			...(typeof header.cwd === 'string' ? { cwd: header.cwd } : {}),
			bytes,
		};
	} catch {
		return undefined;
	}
}

export function deleteSessionTail(dataRoot: string, sessionId: string): void {
	if (!isHolderSessionId(sessionId)) return;
	rmSync(sessionTailPath(dataRoot, sessionId), { force: true });
}

export function listSessionTailIds(dataRoot: string): readonly string[] {
	try {
		return readdirSync(sessionTailsDirectory(dataRoot)).filter(
			(name) => isHolderSessionId(name) && !name.endsWith('.tmp'),
		);
	} catch {
		return [];
	}
}

/** Remove every saved tail whose session id is not in `keep`. */
export function pruneSessionTails(
	dataRoot: string,
	keep: ReadonlySet<string>,
): void {
	const directory = sessionTailsDirectory(dataRoot);
	let names: string[];
	try {
		names = readdirSync(directory);
	} catch {
		return;
	}
	for (const name of names)
		if (!keep.has(name)) rmSync(join(directory, name), { force: true });
}

function isPosition(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isDimension(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		value >= 1 &&
		value <= 10_000
	);
}

function parseExit(value: unknown): HolderExitRecord | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const record = value as Record<string, unknown>;
	const exitCode = record.exitCode;
	const signal = record.signal;
	if (exitCode !== null && typeof exitCode !== 'number') return undefined;
	if (signal !== null && typeof signal !== 'number') return undefined;
	if (!isPosition(record.at)) return undefined;
	return { exitCode, signal, at: record.at };
}
