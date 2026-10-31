import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Durable replace and corrupt-aware reads for every file Terminay writes to
 * hold its own state (ADR-0088).
 *
 * A save writes a fresh temporary file beside the target, flushes it to stable
 * storage, renames it over the target, and flushes the directory where the
 * platform allows. Without the flush, a crash or power loss can leave the
 * rename on disk and the data not: the target comes back at full length and
 * filled with zeros. On darwin, Node's `fsync` already issues
 * `fcntl(F_FULLFSYNC)`, so the drive cache is flushed too.
 */

/** How a corrupt file is recovered (ADR-0088 decision 2). */
export type StateFileKind = 'canonical' | 'secret' | 'rebuildable';

export interface DurableWriteOptions {
	/** POSIX mode of the new file. Ignored on Windows. */
	readonly mode?: number;
	/** Canonical state: keep the current target as `<file>.previous` first. */
	readonly keepPrevious?: boolean;
}

/** The synchronous file operations a durable write uses, in the order it
 * uses them. Tests pass a recording fake to pin that order. */
export interface DurableFileOps {
	openSync(path: string, flags: string, mode?: number): number;
	writeSync(fd: number, data: Uint8Array): number;
	fsyncSync(fd: number): void;
	closeSync(fd: number): void;
	renameSync(from: string, to: string): void;
	readFileSync(path: string): Buffer;
	rmSync(path: string, options: { force: boolean }): void;
	existsSync(path: string): boolean;
}

const nodeOps: DurableFileOps = {
	openSync: (path, flags, mode) => fs.openSync(path, flags, mode),
	writeSync: (fd, data) => fs.writeSync(fd, data),
	fsyncSync: (fd) => fs.fsyncSync(fd),
	closeSync: (fd) => fs.closeSync(fd),
	renameSync: (from, to) => fs.renameSync(from, to),
	readFileSync: (path) => fs.readFileSync(path),
	rmSync: (path, options) => fs.rmSync(path, options),
	existsSync: (path) => fs.existsSync(path),
};

export const PREVIOUS_SUFFIX = '.previous';
const DIRECTORY_FLUSH = process.platform !== 'win32';

function temporaryPathFor(target: string): string {
	return join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
}

function toBytes(data: string | Uint8Array): Uint8Array {
	return typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
}

/** Write `bytes` to a new file at `path` and flush it before returning. */
function writeFlushedSync(
	ops: DurableFileOps,
	path: string,
	bytes: Uint8Array,
	mode: number | undefined,
): void {
	const fd = ops.openSync(path, 'wx', mode ?? 0o600);
	try {
		let offset = 0;
		while (offset < bytes.byteLength)
			offset += ops.writeSync(fd, bytes.subarray(offset));
		ops.fsyncSync(fd);
	} finally {
		ops.closeSync(fd);
	}
}

function flushDirectorySync(ops: DurableFileOps, directory: string): void {
	if (!DIRECTORY_FLUSH) return;
	let fd: number | undefined;
	try {
		fd = ops.openSync(directory, 'r');
		ops.fsyncSync(fd);
	} catch {
		/* some filesystems refuse a directory flush; the file itself is durable */
	} finally {
		if (fd !== undefined) ops.closeSync(fd);
	}
}

/** Refresh `<target>.previous` from a target that still holds good content. */
function keepPreviousSync(
	ops: DurableFileOps,
	target: string,
	mode: number | undefined,
): void {
	let current: Buffer;
	try {
		current = ops.readFileSync(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
		throw error;
	}
	// A target that is itself corrupt never overwrites the last good copy.
	if (isBlank(current)) return;
	const temporary = temporaryPathFor(`${target}${PREVIOUS_SUFFIX}`);
	try {
		writeFlushedSync(ops, temporary, current, mode);
		ops.renameSync(temporary, `${target}${PREVIOUS_SUFFIX}`);
	} finally {
		ops.rmSync(temporary, { force: true });
	}
}

/**
 * Durably replace `target` with `data`. When it returns, the new content is
 * on stable storage; if it throws, the target still holds its previous
 * content. Concurrent writers never share a temporary file.
 */
export function writeFileDurablySync(
	target: string,
	data: string | Uint8Array,
	options: DurableWriteOptions = {},
	ops: DurableFileOps = nodeOps,
): void {
	const bytes = toBytes(data);
	const temporary = temporaryPathFor(target);
	try {
		writeFlushedSync(ops, temporary, bytes, options.mode);
		if (options.keepPrevious === true)
			keepPreviousSync(ops, target, options.mode);
		ops.renameSync(temporary, target);
		flushDirectorySync(ops, dirname(target));
	} finally {
		ops.rmSync(temporary, { force: true });
	}
}

/** The asynchronous form, for writers on the event loop. Same guarantees. */
export async function writeFileDurably(
	target: string,
	data: string | Uint8Array,
	options: DurableWriteOptions = {},
): Promise<void> {
	const bytes = toBytes(data);
	const temporary = temporaryPathFor(target);
	try {
		await writeFlushed(temporary, bytes, options.mode);
		if (options.keepPrevious === true) await keepPrevious(target, options.mode);
		await fsp.rename(temporary, target);
		await flushDirectory(dirname(target));
	} finally {
		await fsp.rm(temporary, { force: true });
	}
}

async function writeFlushed(
	path: string,
	bytes: Uint8Array,
	mode: number | undefined,
): Promise<void> {
	const handle = await fsp.open(path, 'wx', mode ?? 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function flushDirectory(directory: string): Promise<void> {
	if (!DIRECTORY_FLUSH) return;
	try {
		const handle = await fsp.open(directory, 'r');
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	} catch {
		/* some filesystems refuse a directory flush; the file itself is durable */
	}
}

async function keepPrevious(
	target: string,
	mode: number | undefined,
): Promise<void> {
	let current: Buffer;
	try {
		current = await fsp.readFile(target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
		throw error;
	}
	if (isBlank(current)) return;
	const temporary = temporaryPathFor(`${target}${PREVIOUS_SUFFIX}`);
	try {
		await writeFlushed(temporary, current, mode);
		await fsp.rename(temporary, `${target}${PREVIOUS_SUFFIX}`);
	} finally {
		await fsp.rm(temporary, { force: true });
	}
}

/** Empty, or every byte zero: what an unflushed write leaves behind. */
export function isBlank(bytes: Uint8Array): boolean {
	for (const byte of bytes) if (byte !== 0) return false;
	return true;
}

export type StateFileRead<T> =
	| { readonly status: 'ok'; readonly value: T }
	| { readonly status: 'missing' }
	/** The target was corrupt and the previous committed copy was loaded. */
	| { readonly status: 'restored'; readonly value: T; readonly preservedAs: string }
	/** Nothing usable; every corrupt file was kept under `preservedAs`. */
	| { readonly status: 'corrupt'; readonly preservedAs: readonly string[] };

export interface ReadStateFileOptions<T> {
	readonly kind: StateFileKind;
	/** Turns the bytes into a value, throwing when they are not one.
	 * Defaults to UTF-8 JSON. */
	readonly parse?: (bytes: Buffer) => unknown;
	/** Throws or returns undefined when a parsed value is not valid state. */
	readonly validate?: (value: unknown) => T | undefined;
	/** Rewrite mode used when a restored copy is put back in place. */
	readonly mode?: number;
	/** Canonical only: the user chose to start this state fresh, so a corrupt
	 * file with no good copy is moved aside. Without it the files are left
	 * exactly as they are, so Retry changes nothing on disk. */
	readonly acceptFresh?: boolean;
}

const parseJson = (bytes: Buffer): unknown => JSON.parse(bytes.toString('utf8'));

function decode<T>(
	bytes: Buffer,
	options: ReadStateFileOptions<T>,
): { ok: true; value: T } | { ok: false } {
	if (isBlank(bytes)) return { ok: false };
	try {
		const parsed = (options.parse ?? parseJson)(bytes);
		const value =
			options.validate === undefined ? (parsed as T) : options.validate(parsed);
		return value === undefined ? { ok: false } : { ok: true, value };
	} catch {
		return { ok: false };
	}
}

function corruptName(path: string): string {
	return `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
}

function readOptional(path: string): Buffer | undefined {
	try {
		return fs.readFileSync(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		// Unreadable bytes are corrupt state, not a missing file.
		return Buffer.alloc(0);
	}
}

/** Move a corrupt file aside, keeping it for diagnosis. Never deletes. */
export function preserveCorruptFile(path: string): string {
	const destination = corruptName(path);
	fs.renameSync(path, destination);
	return destination;
}

/**
 * Read a state file, treating unreadable, blank, unparseable or invalid
 * content as corrupt. A corrupt file is renamed aside and never used. A
 * canonical file falls back to its previous committed copy, which is put back
 * in place durably so a crash before the next save cannot lose it. Secret and
 * rebuildable files never read an older copy.
 */
export function readStateFileSync<T = unknown>(
	path: string,
	options: ReadStateFileOptions<T>,
): StateFileRead<T> {
	const bytes = readOptional(path);
	const previousPath = `${path}${PREVIOUS_SUFFIX}`;
	if (bytes === undefined) {
		// A crash between moving a corrupt target aside and restoring the copy
		// leaves only `.previous`; it is still the last good state.
		if (options.kind !== 'canonical') return { status: 'missing' };
		const previous = readOptional(previousPath);
		if (previous === undefined) return { status: 'missing' };
		const decoded = decode(previous, options);
		if (!decoded.ok)
			return {
				status: 'corrupt',
				preservedAs: options.acceptFresh === true ? [preserveCorruptFile(previousPath)] : [],
			};
		writeFileDurablySync(path, previous, { mode: options.mode });
		return { status: 'restored', value: decoded.value, preservedAs: previousPath };
	}
	const decoded = decode(bytes, options);
	if (decoded.ok) return { status: 'ok', value: decoded.value };
	if (options.kind !== 'canonical')
		return { status: 'corrupt', preservedAs: [preserveCorruptFile(path)] };
	const previous = readOptional(previousPath);
	const fallback = previous === undefined ? undefined : decode(previous, options);
	if (previous !== undefined && fallback?.ok === true) {
		const preservedTarget = preserveCorruptFile(path);
		writeFileDurablySync(path, previous, { mode: options.mode });
		return { status: 'restored', value: fallback.value, preservedAs: preservedTarget };
	}
	// No good copy: the user decides. Until they choose to start fresh, both
	// files stay exactly where they are.
	if (options.acceptFresh !== true) return { status: 'corrupt', preservedAs: [] };
	const preserved = [preserveCorruptFile(path)];
	if (previous !== undefined) preserved.push(preserveCorruptFile(previousPath));
	return { status: 'corrupt', preservedAs: preserved };
}

/** The asynchronous form; file reads are small, so it shares the sync core. */
export async function readStateFile<T = unknown>(
	path: string,
	options: ReadStateFileOptions<T>,
): Promise<StateFileRead<T>> {
	return readStateFileSync(path, options);
}

/** Canonical stores a host may offer to start fresh. Never a path. */
export type StateStoreName =
	| 'workspace'
	| 'desktop-identity'
	| 'server-settings'
	| 'device-settings'
	| 'remote-access-settings'
	| 'macros'
	| 'automations'
	| 'connected-servers'
	| 'connection-profiles'
	| 'window-layout'
	| 'extensions';

/** A canonical store is corrupt and has no good previous copy. The host asks
 * the user; nothing starts it fresh on its own. Carries no path or bytes. */
export class StateUnreadableError extends Error {
	readonly code = 'state_unreadable';
	readonly store: StateStoreName;
	readonly preservedAs: readonly string[];
	/** The corrupt file, for the privileged host only. Never shown. */
	readonly statePath: string | undefined;
	// No parameter properties: Electron modules load this file under Node's
	// type stripping in tests.
	constructor(
		store: StateStoreName,
		preservedAs: readonly string[] = [],
		statePath?: string,
	) {
		super(`Terminay could not read its saved ${store} state.`);
		this.name = 'StateUnreadableError';
		this.store = store;
		this.preservedAs = preservedAs;
		this.statePath = statePath;
	}
}

export function isStateUnreadableError(error: unknown): error is StateUnreadableError {
	return (
		error instanceof StateUnreadableError ||
		(typeof error === 'object' &&
			error !== null &&
			(error as { code?: unknown }).code === 'state_unreadable' &&
			typeof (error as { store?: unknown }).store === 'string')
	);
}

/** What startup did about corrupt state, for the host to tell the user once. */
export type StateRecoveryNotice =
	| { readonly kind: 'restored'; readonly store: StateStoreName }
	| { readonly kind: 'started-fresh'; readonly store: StateStoreName }
	| { readonly kind: 'secret-reset'; readonly store: string };

const pendingNotices: StateRecoveryNotice[] = [];
const freshStartAccepted = new Set<StateStoreName>();
let rebuildObserver: ((store: string, preservedAs: readonly string[]) => void) | undefined;

/** The host records the user's choice to start a store fresh. */
export function acceptFreshStateStart(store: StateStoreName): void {
	freshStartAccepted.add(store);
}

/** Notices queued since the last call, each returned once. */
export function takeStateRecoveryNotices(): StateRecoveryNotice[] {
	return pendingNotices.splice(0, pendingNotices.length);
}

/** Queue notices again, e.g. ones carried over a recovery relaunch. */
export function queueStateRecoveryNotices(
	notices: readonly StateRecoveryNotice[],
): void {
	pendingNotices.push(...notices);
}

/** Diagnostics hook for silently rebuilt state. */
export function observeRebuiltState(
	observer: ((store: string, preservedAs: readonly string[]) => void) | undefined,
): void {
	rebuildObserver = observer;
}

interface KindLoadOptions<T> {
	readonly parse?: (bytes: Buffer) => unknown;
	readonly validate?: (value: unknown) => T | undefined;
	readonly mode?: number;
}

/**
 * Load canonical state. Returns the value, or undefined when there is none yet
 * (or the user chose to start fresh); the caller then uses its first-run
 * state. A corrupt file with no good copy throws StateUnreadableError and is
 * left untouched.
 */
export function loadCanonicalStateSync<T>(
	path: string,
	store: StateStoreName,
	options: KindLoadOptions<T> = {},
): T | undefined {
	const acceptFresh = freshStartAccepted.has(store);
	const result = readStateFileSync<T>(path, { ...options, kind: 'canonical', acceptFresh });
	switch (result.status) {
		case 'ok':
			return result.value;
		case 'missing':
			return undefined;
		case 'restored':
			pendingNotices.push({ kind: 'restored', store });
			return result.value;
		case 'corrupt':
			if (!acceptFresh) throw new StateUnreadableError(store, [], path);
			pendingNotices.push({ kind: 'started-fresh', store });
			return undefined;
	}
}

export async function loadCanonicalState<T>(
	path: string,
	store: StateStoreName,
	options: KindLoadOptions<T> = {},
): Promise<T | undefined> {
	return loadCanonicalStateSync(path, store, options);
}

/** Load a secret, credential or revocation store. A corrupt one is set aside
 * and reads as empty (fail closed); the user is told. Never rolls back. */
export function loadSecretStateSync<T>(
	path: string,
	label: string,
	options: KindLoadOptions<T> = {},
): T | undefined {
	const result = readStateFileSync<T>(path, { ...options, kind: 'secret' });
	if (result.status === 'ok') return result.value;
	if (result.status === 'corrupt') pendingNotices.push({ kind: 'secret-reset', store: label });
	return undefined;
}

export async function loadSecretState<T>(
	path: string,
	label: string,
	options: KindLoadOptions<T> = {},
): Promise<T | undefined> {
	return loadSecretStateSync(path, label, options);
}

/** Load rebuildable state. A corrupt file is set aside and reads as missing. */
export function loadRebuildableStateSync<T>(
	path: string,
	label: string,
	options: KindLoadOptions<T> = {},
): T | undefined {
	const result = readStateFileSync<T>(path, { ...options, kind: 'rebuildable' });
	if (result.status === 'ok') return result.value;
	if (result.status === 'corrupt') rebuildObserver?.(label, result.preservedAs);
	return undefined;
}

export async function loadRebuildableState<T>(
	path: string,
	label: string,
	options: KindLoadOptions<T> = {},
): Promise<T | undefined> {
	return loadRebuildableStateSync(path, label, options);
}

/**
 * The user chose Start fresh for a store that failed to load: keep its
 * corrupt file and any corrupt previous copy aside, so the next load, in this
 * process or after a relaunch, finds no file and begins with first-run state.
 * Only the privileged host calls this, and only from that user choice.
 */
export function startStateFresh(error: StateUnreadableError): readonly string[] {
	acceptFreshStateStart(error.store);
	const preserved: string[] = [];
	if (error.statePath === undefined) return preserved;
	for (const path of [error.statePath, `${error.statePath}${PREVIOUS_SUFFIX}`]) {
		if (fs.existsSync(path)) preserved.push(preserveCorruptFile(path));
	}
	pendingNotices.push({ kind: 'started-fresh', store: error.store });
	return preserved;
}
