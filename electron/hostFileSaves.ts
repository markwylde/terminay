/**
 * Streamed host saves (ADR-0130). A server-bundled renderer may put bytes on
 * the local disk only here: the user picks the destination in a native save
 * dialog, bytes arrive in bounded chunks into a hidden temporary file beside
 * it, and the file moves into place only on commit. The renderer never sees a
 * path, and every error it receives is a fixed string.
 *
 * One registry belongs to one server UI document; dispose() ends every save
 * when that document reloads, switches server, or closes.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import { open as openFile, rename as renameFile, rm } from 'node:fs/promises';
import path from 'node:path';

export const HOST_FILE_SAVE_CHUNK_MAX_BYTES = 1024 * 1024;
export const HOST_FILE_SAVE_MAX_OPEN = 4;
export const HOST_FILE_SAVE_IDLE_MS = 5 * 60_000;

export const HOST_FILE_SAVE_FAILED = 'The file could not be saved.';
export const HOST_FILE_SAVE_ENDED = 'This save has ended.';
export const HOST_FILE_SAVE_BUSY = 'Too many saves are open.';

export type HostFileSaveDialog = (
	suggestedName: string,
) => Promise<{ canceled: boolean; filePath?: string }>;

export type HostFileSaveFs = Readonly<{
	open(path: string): Promise<Pick<FileHandle, 'write' | 'close'>>;
	rename(from: string, to: string): Promise<void>;
	remove(path: string): Promise<void>;
}>;

export type HostFileSavesOptions = Readonly<{
	showSaveDialog: HostFileSaveDialog;
	fs?: HostFileSaveFs;
	idleMs?: number;
	maxOpen?: number;
	setTimer?: (callback: () => void, ms: number) => unknown;
	clearTimer?: (timer: unknown) => void;
}>;

const nodeFs: HostFileSaveFs = {
	open: (target) => openFile(target, 'wx'),
	rename: renameFile,
	remove: (target) => rm(target, { force: true }),
};

type Save = {
	state: 'open' | 'busy' | 'ended';
	destination: string;
	temporary: string;
	handle: Pick<FileHandle, 'write' | 'close'>;
	timer: unknown;
};

export class HostFileSaves {
	readonly #dialog: HostFileSaveDialog;
	readonly #fs: HostFileSaveFs;
	readonly #idleMs: number;
	readonly #maxOpen: number;
	readonly #setTimer: (callback: () => void, ms: number) => unknown;
	readonly #clearTimer: (timer: unknown) => void;
	readonly #saves = new Map<string, Save>();
	#choosing = 0;
	#disposed = false;

	constructor(options: HostFileSavesOptions) {
		this.#dialog = options.showSaveDialog;
		this.#fs = options.fs ?? nodeFs;
		this.#idleMs = options.idleMs ?? HOST_FILE_SAVE_IDLE_MS;
		this.#maxOpen = options.maxOpen ?? HOST_FILE_SAVE_MAX_OPEN;
		this.#setTimer =
			options.setTimer ??
			((callback, ms) => {
				const timer = setTimeout(callback, ms);
				timer.unref?.();
				return timer;
			});
		this.#clearTimer =
			options.clearTimer ??
			((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
	}

	/** Saves still open, including any whose dialog is showing. */
	get openCount(): number {
		return this.#saves.size + this.#choosing;
	}

	async open(
		suggestedName: string,
	): Promise<{ canceled: true } | { canceled: false; token: string }> {
		if (this.#disposed) throw new Error(HOST_FILE_SAVE_ENDED);
		if (this.openCount >= this.#maxOpen) throw new Error(HOST_FILE_SAVE_BUSY);
		this.#choosing += 1;
		let destination: string | undefined;
		try {
			const result = await this.#dialog(suggestedName);
			if (!result.canceled && result.filePath) destination = result.filePath;
		} catch {
			throw new Error(HOST_FILE_SAVE_FAILED);
		} finally {
			this.#choosing -= 1;
		}
		if (this.#disposed) throw new Error(HOST_FILE_SAVE_ENDED);
		if (destination === undefined) return { canceled: true };
		const temporary = path.join(
			path.dirname(destination),
			`.${path.basename(destination)}.${randomUUID()}.download`,
		);
		let handle: Save['handle'];
		try {
			handle = await this.#fs.open(temporary);
		} catch {
			throw new Error(HOST_FILE_SAVE_FAILED);
		}
		if (this.#disposed) {
			await handle.close().catch(() => undefined);
			await this.#fs.remove(temporary).catch(() => undefined);
			throw new Error(HOST_FILE_SAVE_ENDED);
		}
		const token = randomBytes(24).toString('base64url');
		const save: Save = { state: 'open', destination, temporary, handle, timer: undefined };
		this.#saves.set(token, save);
		this.#arm(token, save);
		return { canceled: false, token };
	}

	async write(token: string, bytes: Uint8Array): Promise<void> {
		if (bytes.byteLength === 0 || bytes.byteLength > HOST_FILE_SAVE_CHUNK_MAX_BYTES)
			throw new Error(HOST_FILE_SAVE_FAILED);
		const save = this.#take(token);
		try {
			let at = 0;
			while (at < bytes.byteLength) {
				const { bytesWritten } = await save.handle.write(bytes, at, bytes.byteLength - at);
				if (bytesWritten <= 0) throw new Error('short write');
				at += bytesWritten;
			}
		} catch {
			await this.#end(token, save);
			throw new Error(HOST_FILE_SAVE_FAILED);
		}
		if (save.state === 'ended') throw new Error(HOST_FILE_SAVE_ENDED);
		save.state = 'open';
		this.#arm(token, save);
	}

	/** Commit moves the file into place; otherwise the save is abandoned. */
	async close(token: string, commit: boolean): Promise<{ saved: boolean }> {
		const save = this.#take(token);
		if (!commit) {
			await this.#end(token, save);
			return { saved: false };
		}
		this.#disarm(save);
		try {
			await save.handle.close();
			if (save.state === 'ended') throw new Error('ended');
			await this.#fs.rename(save.temporary, save.destination);
		} catch {
			await this.#end(token, save);
			throw new Error(HOST_FILE_SAVE_FAILED);
		}
		save.state = 'ended';
		this.#saves.delete(token);
		return { saved: true };
	}

	/** Ends every save and refuses later ones; dialogs still showing are discarded. */
	async dispose(): Promise<void> {
		this.#disposed = true;
		await Promise.all(
			[...this.#saves].map(([token, save]) => this.#end(token, save)),
		);
	}

	#take(token: string): Save {
		const save = this.#saves.get(token);
		if (save === undefined || save.state === 'ended') throw new Error(HOST_FILE_SAVE_ENDED);
		// One action at a time per save: a renderer that does not wait is refused,
		// so no more than one chunk per save is ever held here.
		if (save.state === 'busy') throw new Error(HOST_FILE_SAVE_FAILED);
		save.state = 'busy';
		return save;
	}

	#arm(token: string, save: Save): void {
		this.#disarm(save);
		save.timer = this.#setTimer(() => {
			void this.#end(token, save);
		}, this.#idleMs);
	}

	#disarm(save: Save): void {
		if (save.timer !== undefined) this.#clearTimer(save.timer);
		save.timer = undefined;
	}

	async #end(token: string, save: Save): Promise<void> {
		if (this.#saves.get(token) === save) this.#saves.delete(token);
		const wasEnded = save.state === 'ended';
		save.state = 'ended';
		this.#disarm(save);
		if (wasEnded) return;
		await save.handle.close().catch(() => undefined);
		await this.#fs.remove(save.temporary).catch(() => undefined);
	}
}
