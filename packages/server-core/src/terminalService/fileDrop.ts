import { randomBytes } from 'node:crypto';
import { mkdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	type AppWindowAttachment,
	AppWindowAttachmentWriter,
	ownedScratchDirectory,
} from '../appWindows/attachments.js';
import { TerminalServiceError } from './errors.js';
import type { TerminalIdentity } from './types.js';

/**
 * Files dropped on a terminal whose server is not the dropping machine
 * (ADR-0113). A named scratch write: the server owns `terminay-drops`, makes a
 * folder for each drop and names every file, and the client offers only names
 * and bytes. Files stream in ordered parts; an upload that does not finish is
 * removed, a finished one is left for the operating system's cleaner.
 */

export const TERMINAL_FILE_DROP_OPERATIONS = Object.freeze({
	begin: 'terminal.drop-begin',
	part: 'terminal.drop-part',
	finish: 'terminal.drop-finish',
	cancel: 'terminal.drop-cancel',
} as const);

export const TERMINAL_FILE_DROP_DIRECTORY_NAME = 'terminay-drops';
/** Files one drop may carry. */
export const MAX_TERMINAL_FILE_DROP_FILES = 64;
/** One part of a file: well inside a framed command body. */
export const MAX_TERMINAL_FILE_DROP_PART_BYTES = 1024 * 1024;
/** Uploads one connection may have in progress at once. */
export const MAX_TERMINAL_FILE_DROPS_PER_CONNECTION = 4;
/** An upload that receives nothing for this long is abandoned. */
export const TERMINAL_FILE_DROP_IDLE_MS = 2 * 60 * 1000;
const MAX_NAME_CHARS = 255;

export function terminalFileDropDirectory(root = tmpdir()): string {
	return join(root, TERMINAL_FILE_DROP_DIRECTORY_NAME);
}

interface Upload {
	readonly id: string;
	readonly clientId: string;
	readonly connectionId: string;
	readonly identity: TerminalIdentity;
	readonly folder: string;
	readonly writer: AppWindowAttachmentWriter;
	timer: ReturnType<typeof setTimeout>;
}

export interface TerminalFileDropOwner {
	readonly clientId: string;
	readonly connectionId: string;
}

export interface TerminalFileDropsOptions {
	/** The scratch directory. Defaults to `terminay-drops` under os.tmpdir(). */
	readonly directory?: string;
	readonly idleMs?: number;
	readonly random?: () => string;
}

/** Uploads in progress, each owned by the connection that began it. */
export class TerminalFileDrops {
	private readonly uploads = new Map<string, Upload>();
	private readonly directory: string;
	private readonly idleMs: number;
	private readonly random: () => string;

	constructor(options: TerminalFileDropsOptions = {}) {
		this.directory = options.directory ?? terminalFileDropDirectory();
		this.idleMs = options.idleMs ?? TERMINAL_FILE_DROP_IDLE_MS;
		this.random = options.random ?? (() => randomBytes(12).toString('hex'));
	}

	/** Start an upload for files the caller has already been authorised to drop on `identity`. */
	async begin(
		owner: TerminalFileDropOwner,
		identity: TerminalIdentity,
		offered: unknown,
	): Promise<string> {
		const files = parseFiles(offered);
		let open = 0;
		for (const upload of this.uploads.values())
			if (upload.connectionId === owner.connectionId) open += 1;
		if (open >= MAX_TERMINAL_FILE_DROPS_PER_CONNECTION)
			throw new TerminalServiceError(
				'upload_limit',
				'too many file drops are already uploading',
				{ max: MAX_TERMINAL_FILE_DROPS_PER_CONNECTION },
			);
		const id = this.random();
		const folder = join(this.directory, id);
		try {
			await ownedScratchDirectory(this.directory);
			// Not recursive: a folder that already exists is not this drop's.
			await mkdir(folder, { mode: 0o700 });
			await ownedScratchDirectory(folder);
		} catch {
			throw new TerminalServiceError(
				'upload_failed',
				'the drop folder could not be created',
			);
		}
		const taken = new Set<string>();
		const writer = new AppWindowAttachmentWriter(folder, files, this.random, {
			maxPartBytes: MAX_TERMINAL_FILE_DROP_PART_BYTES,
			fileName: (kept) => uniqueDropName(kept, taken),
		});
		const upload: Upload = {
			id,
			...owner,
			identity,
			folder,
			writer,
			timer: this.idleTimer(id),
		};
		this.uploads.set(id, upload);
		return id;
	}

	/** The upload `uploadId` names, if `owner` began it. */
	owned(owner: TerminalFileDropOwner, uploadId: unknown): Upload {
		const upload =
			typeof uploadId === 'string' ? this.uploads.get(uploadId) : undefined;
		if (
			upload === undefined ||
			upload.clientId !== owner.clientId ||
			upload.connectionId !== owner.connectionId
		)
			throw new TerminalServiceError(
				'upload_not_found',
				'file drop upload was not found',
			);
		return upload;
	}

	async part(
		owner: TerminalFileDropOwner,
		uploadId: unknown,
		file: unknown,
		offset: unknown,
		bytes: Uint8Array,
	): Promise<number> {
		const upload = this.owned(owner, uploadId);
		if (
			!Number.isSafeInteger(file) ||
			!Number.isSafeInteger(offset) ||
			(file as number) < 0 ||
			(offset as number) < 0
		) {
			await this.abandon(upload);
			throw new TerminalServiceError('invalid_bytes', 'file drop part is invalid');
		}
		clearTimeout(upload.timer);
		try {
			await upload.writer.write(file as number, offset as number, bytes);
		} catch (error) {
			await this.abandon(upload);
			throw error instanceof RangeError
				? new TerminalServiceError('invalid_bytes', error.message)
				: new TerminalServiceError(
						'upload_failed',
						'the dropped file could not be written',
					);
		}
		upload.timer = this.idleTimer(upload.id);
		return upload.writer.receivedBytes;
	}

	async finish(
		owner: TerminalFileDropOwner,
		uploadId: unknown,
	): Promise<readonly string[]> {
		const upload = this.owned(owner, uploadId);
		try {
			const paths = await upload.writer.finish();
			this.forget(upload);
			return paths;
		} catch (error) {
			await this.abandon(upload);
			throw error instanceof RangeError
				? new TerminalServiceError('invalid_bytes', error.message)
				: new TerminalServiceError(
						'upload_failed',
						'the dropped file could not be written',
					);
		}
	}

	async cancel(owner: TerminalFileDropOwner, uploadId: unknown): Promise<void> {
		const upload =
			typeof uploadId === 'string' ? this.uploads.get(uploadId) : undefined;
		if (
			upload === undefined ||
			upload.clientId !== owner.clientId ||
			upload.connectionId !== owner.connectionId
		)
			return;
		await this.abandon(upload);
	}

	/** Remove every upload a closed connection left unfinished. */
	closeConnection(connectionId: string): void {
		for (const upload of [...this.uploads.values()])
			if (upload.connectionId === connectionId) void this.abandon(upload);
	}

	get size(): number {
		return this.uploads.size;
	}

	private idleTimer(id: string): ReturnType<typeof setTimeout> {
		const timer = setTimeout(() => {
			const upload = this.uploads.get(id);
			if (upload !== undefined) void this.abandon(upload);
		}, this.idleMs);
		timer.unref?.();
		return timer;
	}

	private forget(upload: Upload): void {
		clearTimeout(upload.timer);
		this.uploads.delete(upload.id);
	}

	private async abandon(upload: Upload): Promise<void> {
		if (this.uploads.get(upload.id) !== upload) return;
		this.forget(upload);
		await upload.writer.abort();
		// Empty once its files are gone; a folder that is not is not ours to clear.
		await rmdir(upload.folder).catch(() => undefined);
	}
}

function parseFiles(value: unknown): AppWindowAttachment[] {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > MAX_TERMINAL_FILE_DROP_FILES
	)
		throw new TerminalServiceError(
			'invalid_bytes',
			'file drop must name between 1 and 64 files',
			{ max: MAX_TERMINAL_FILE_DROP_FILES },
		);
	return value.map((entry: unknown) => {
		const record =
			typeof entry === 'object' && entry !== null && !Array.isArray(entry)
				? (entry as Record<string, unknown>)
				: undefined;
		const name = record?.name;
		const size = record?.size;
		if (
			typeof name !== 'string' ||
			name.length === 0 ||
			name.length > MAX_NAME_CHARS ||
			!Number.isSafeInteger(size) ||
			(size as number) < 0
		)
			throw new TerminalServiceError('invalid_bytes', 'dropped file is invalid');
		return { name, size: size as number };
	});
}

/** Kept names, made unique within one drop's folder: `a.txt`, `a-2.txt`. */
export function uniqueDropName(kept: string, taken: Set<string>): string {
	let name = kept;
	const dot = kept.lastIndexOf('.');
	const stem = dot > 0 ? kept.slice(0, dot) : kept;
	const extension = dot > 0 ? kept.slice(dot) : '';
	for (let copy = 2; taken.has(name.toLowerCase()); copy += 1)
		name = `${stem}-${copy}${extension}`;
	// Case-insensitive: two names that differ only in case are one file on macOS.
	taken.add(name.toLowerCase());
	return name;
}
