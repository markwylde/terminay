import { randomUUID } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A Desktop paste into a terminal whose server is not this machine's Local
 * server must never insert this machine's paths (ADR-0113). Electron reads the
 * clipboard and names the copied files; the renderer streams their bytes to the
 * terminal's server through the same upload a drop uses. Only the files named
 * by the latest read can be read back, and only in bounded parts.
 */
export const MAX_TERMINAL_CLIPBOARD_FILE_PART_BYTES = 1024 * 1024;

export type TerminalClipboardForUpload =
	| Readonly<{
			kind: 'files';
			token: string;
			files: readonly Readonly<{ name: string; size: number }>[];
	  }>
	| Readonly<{ kind: 'folder' }>
	| Readonly<{ kind: 'text'; text: string }>
	| Readonly<{ kind: 'image'; bytes: Uint8Array; mimeType: 'image/png' }>
	| Readonly<{ kind: 'empty' }>;

/** Absolute paths named by a `text/uri-list`, or null unless every entry is a local file URL. */
export function clipboardUriListFilePaths(value: string): string[] | null {
	const entries = value
		.split(/\r?\n/)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0 && !entry.startsWith('#'));
	if (entries.length === 0) return null;
	const paths: string[] = [];
	for (const entry of entries) {
		if (!/^file:\/\//i.test(entry)) return null;
		try {
			const filePath = fileURLToPath(entry);
			if (filePath.includes('\0') || !path.isAbsolute(filePath)) return null;
			paths.push(filePath);
		} catch {
			return null;
		}
	}
	return paths;
}

export type TerminalClipboardUploadSources = Readonly<{
	readUriList: () => Promise<string | null>;
	readText: () => Promise<string> | string;
	readPng: () => Promise<Uint8Array | null>;
}>;

export class TerminalClipboardUploadReader {
	#snapshot: { readonly token: string; readonly paths: readonly string[] } | undefined;

	async read(sources: TerminalClipboardUploadSources): Promise<TerminalClipboardForUpload> {
		this.#snapshot = undefined;
		const uriList = await sources.readUriList();
		const paths = uriList === null ? null : clipboardUriListFilePaths(uriList);
		if (paths !== null) {
			const files: { name: string; size: number }[] = [];
			for (const filePath of paths) {
				const info = await stat(filePath);
				if (info.isDirectory()) return { kind: 'folder' };
				if (!info.isFile()) throw new Error('A copied item is not a regular file.');
				files.push({ name: path.basename(filePath), size: info.size });
			}
			const token = randomUUID();
			this.#snapshot = { token, paths };
			return { kind: 'files', token, files };
		}
		const text = await sources.readText();
		if (text.length > 0) return { kind: 'text', text };
		const png = await sources.readPng();
		if (png !== null && png.byteLength > 0)
			return { kind: 'image', bytes: png, mimeType: 'image/png' };
		return { kind: 'empty' };
	}

	async readPart(token: unknown, file: unknown, offset: unknown, length: unknown): Promise<Uint8Array> {
		const snapshot = this.#snapshot;
		if (snapshot === undefined || typeof token !== 'string' || token !== snapshot.token)
			throw new Error('The copied files are no longer available.');
		if (
			!Number.isSafeInteger(file) ||
			!Number.isSafeInteger(offset) ||
			!Number.isSafeInteger(length) ||
			(file as number) < 0 ||
			(offset as number) < 0 ||
			(length as number) <= 0 ||
			(length as number) > MAX_TERMINAL_CLIPBOARD_FILE_PART_BYTES
		)
			throw new RangeError('Invalid clipboard file part.');
		const filePath = snapshot.paths[file as number];
		if (filePath === undefined) throw new RangeError('No such copied file.');
		const handle = await open(filePath, 'r');
		try {
			const buffer = new Uint8Array(length as number);
			const { bytesRead } = await handle.read(buffer, 0, length as number, offset as number);
			if (bytesRead === 0) throw new Error('A copied file ended early.');
			return bytesRead === buffer.byteLength ? buffer : buffer.slice(0, bytesRead);
		} finally {
			await handle.close();
		}
	}
}
