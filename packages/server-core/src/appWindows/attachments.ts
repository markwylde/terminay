import { randomBytes } from 'node:crypto';
import { type FileHandle, lstat, mkdir, open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Files a person attaches to a window message (ADR-0046).
 *
 * The bytes come from an untrusted view, so this is a named scratch write and
 * nothing more: the server owns the directory and chooses every file name, and
 * the caller supplies bytes and an offered name, never a path. Files arrive in
 * parts and are appended as they come, so no file is ever held in memory, and
 * a delivered file is left where it is; only an unfinished one is removed.
 */

export const APP_WINDOW_ATTACHMENTS_CAPABILITY = 'app-window-attachments.v1';
export const APP_WINDOW_ATTACHMENT_DIRECTORY_NAME = 'terminay-attachments';
/** Files one message may carry: keeps the approval prompt and the paste bounded. */
export const MAX_APP_WINDOW_ATTACHMENTS = 16;
/** One part of a file. A file has no size limit; a part does. */
export const MAX_APP_WINDOW_ATTACHMENT_PART_BYTES = 256 * 1024;
/** An offered name, as a view states it. */
export const MAX_APP_WINDOW_ATTACHMENT_NAME_CHARS = 255;
/** What is kept of an offered name in the file's own name. */
const MAX_KEPT_NAME_CHARS = 80;

export interface AppWindowAttachment {
	/** The name the view offered, for people to read. Never used as a path. */
	readonly name: string;
	readonly size: number;
}

export function appWindowAttachmentDirectory(root = tmpdir()): string {
	return join(root, APP_WINDOW_ATTACHMENT_DIRECTORY_NAME);
}

/**
 * The part of an offered name that is safe to keep in a file name: its last
 * path component, reduced to letters, digits, dot, hyphen, and underscore,
 * with its extension kept so tools recognise the type.
 */
export function keptAttachmentName(offered: string): string {
	const last = offered.split(/[\\/]/u).pop() ?? '';
	const safe = last
		.normalize('NFKD')
		.replace(/[^A-Za-z0-9._-]/gu, '_')
		.replace(/_+/gu, '_')
		// No leading dot: neither a hidden file nor a way to spell "..".
		.replace(/^[._]+/u, '');
	if (safe.length === 0) return 'file';
	if (safe.length <= MAX_KEPT_NAME_CHARS) return safe;
	const dot = safe.lastIndexOf('.');
	const extension = dot > 0 && safe.length - dot <= 16 ? safe.slice(dot) : '';
	return `${safe.slice(0, MAX_KEPT_NAME_CHARS - extension.length)}${extension}`;
}

interface WrittenFile {
	readonly size: number;
	readonly path: string;
	written: number;
	handle?: FileHandle;
	created: boolean;
}

/** Writes the attachments of one message, in order, as their parts arrive. */
export class AppWindowAttachmentWriter {
	private readonly files: WrittenFile[];
	private ready = false;
	private ended = false;
	private busy = false;

	constructor(
		private readonly directory: string,
		attachments: readonly AppWindowAttachment[],
		random: () => string = () => randomBytes(8).toString('hex'),
	) {
		this.files = attachments.map((attachment) => ({
			size: attachment.size,
			path: join(directory, `${random()}-${keptAttachmentName(attachment.name)}`),
			written: 0,
			created: false,
		}));
	}

	/** Append one part. Parts arrive in order: file by file, start to end. */
	async write(index: number, offset: number, bytes: Uint8Array): Promise<number> {
		return this.exclusively(async () => {
			const file = this.files[index];
			if (file === undefined) throw new RangeError('no such attachment');
			if (this.files.slice(0, index).some((earlier) => earlier.written !== earlier.size))
				throw new RangeError('an earlier attachment is not complete');
			if (offset !== file.written) throw new RangeError('attachment part is out of order');
			if (
				bytes.byteLength === 0 ||
				bytes.byteLength > MAX_APP_WINDOW_ATTACHMENT_PART_BYTES ||
				file.written + bytes.byteLength > file.size
			)
				throw new RangeError('attachment part is the wrong size');
			const handle = await this.handle(file);
			await handle.write(bytes, 0, bytes.byteLength, file.written);
			file.written += bytes.byteLength;
			if (file.written === file.size) await this.release(file);
			return file.written;
		});
	}

	/** Every file is complete: close them and say where they are. */
	async finish(): Promise<readonly string[]> {
		return this.exclusively(async () => {
			if (this.files.some((file) => file.written !== file.size))
				throw new RangeError('an attachment is not complete');
			for (const file of this.files) {
				// A file of no bytes has had no part, so it does not exist yet.
				if (!file.created) await this.handle(file);
				await this.release(file);
			}
			this.ended = true;
			return this.files.map((file) => file.path);
		});
	}

	/** Remove everything written. For a message that was not delivered. */
	async abort(): Promise<void> {
		this.ended = true;
		for (const file of this.files) {
			await this.release(file).catch(() => undefined);
			if (file.created) await unlink(file.path).catch(() => undefined);
			file.created = false;
		}
	}

	private async exclusively<T>(task: () => Promise<T>): Promise<T> {
		if (this.ended) throw new RangeError('this upload has ended');
		if (this.busy) throw new RangeError('an attachment part is already being written');
		this.busy = true;
		try {
			return await task();
		} finally {
			this.busy = false;
		}
	}

	private async handle(file: WrittenFile): Promise<FileHandle> {
		if (file.handle !== undefined) return file.handle;
		if (!this.ready) {
			await ownedDirectory(this.directory);
			this.ready = true;
		}
		// Created, never opened: a name that exists is not ours to write to.
		file.handle = await open(file.path, 'wx', 0o600);
		file.created = true;
		return file.handle;
	}

	private async release(file: WrittenFile): Promise<void> {
		const handle = file.handle;
		if (handle === undefined) return;
		delete file.handle;
		await handle.close();
	}
}

/**
 * The scratch directory, made if missing and refused unless it is a real
 * directory of this user: the temporary directory can be shared, and a link or
 * another user's directory there would decide where attachments land.
 */
async function ownedDirectory(directory: string): Promise<void> {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const stat = await lstat(directory);
	const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
	if (!stat.isDirectory() || (uid !== undefined && stat.uid !== uid))
		throw new Error('the attachment directory is not a directory this server owns');
}
