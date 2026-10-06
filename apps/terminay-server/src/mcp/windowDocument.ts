import { constants } from 'node:fs';
import { type FileHandle, open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

/**
 * Reads the document an agent names for `show_window` (ADR-0041).
 *
 * This runs in the stdio adapter, which the agent's CLI spawned: it has the
 * agent's own filesystem authority and nothing more. The path never leaves this
 * process, and what is read goes to the user's window, never into a tool
 * result. It is the only file read in Terminay's own MCP surface.
 */

export type WindowDocument =
	| { readonly ok: true; readonly html: string }
	| {
			readonly ok: false;
			readonly code: 'bad_request' | 'not_found';
			readonly message: string;
	  };

const refused = (
	message: string,
	code: 'bad_request' | 'not_found' = 'bad_request',
): WindowDocument => ({ ok: false, code, message });

export async function readWindowDocument(
	path: string,
	maxBytes: number,
): Promise<WindowDocument> {
	if (path.length === 0 || path.includes('\0') || !isAbsolute(path))
		return refused('html_file must be an absolute path');
	let handle: FileHandle;
	try {
		// Non-blocking, so naming a pipe nobody writes to cannot hang the call.
		handle = await open(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === 'ENOENT' || code === 'ENOTDIR'
			? refused('html_file does not exist', 'not_found')
			: refused('html_file could not be opened');
	}
	try {
		// Asked of the open file, so what was checked is what is read.
		const stat = await handle.stat();
		if (!stat.isFile()) return refused('html_file must be a regular file');
		const tooLarge = refused(
			`html_file must be at most ${Math.floor(maxBytes / 1024)} KiB`,
		);
		if (stat.size > maxBytes) return tooLarge;
		// One byte more than allowed, to notice a file that grew after the check.
		const buffer = Buffer.alloc(maxBytes + 1);
		let length = 0;
		while (length < buffer.byteLength) {
			const { bytesRead } = await handle.read(
				buffer,
				length,
				buffer.byteLength - length,
				length,
			);
			if (bytesRead === 0) break;
			length += bytesRead;
		}
		if (length > maxBytes) return tooLarge;
		if (length === 0) return refused('html_file is empty');
		try {
			return {
				ok: true,
				html: new TextDecoder('utf-8', { fatal: true }).decode(
					buffer.subarray(0, length),
				),
			};
		} catch {
			return refused('html_file must be UTF-8 text');
		}
	} catch {
		return refused('html_file could not be read');
	} finally {
		await handle.close().catch(() => undefined);
	}
}
