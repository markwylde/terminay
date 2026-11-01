import type { BotFilesView } from './files.js';

/** Stream a PAX tar without a host path, subprocess, or unbounded file buffer.
 * Every member is opened through the same confined, credential-aware helper. */
export async function* botFolderArchive(
	files: Pick<BotFilesView, 'list' | 'stat' | 'read'>,
	folder: string,
	signal?: AbortSignal,
): AsyncIterable<Uint8Array> {
	const root = await files.stat(folder, signal);
	if (root.kind !== 'dir')
		throw new Error('archive source must be a directory');
	let sequence = 0;
	async function* member(
		source: string,
		destination: string,
		directory: boolean,
		size: number,
		mtime: number,
	): AsyncIterable<Uint8Array> {
		signal?.throwIfAborted();
		const name = destination + (directory ? '/' : '');
		const longPath = Buffer.byteLength(name) > 100 || /[^\x20-\x7e]/.test(name);
		const bigSize = size > 0o77777777777;
		if (longPath || bigSize) {
			const attributes =
				(longPath ? pax('path', name) : '') +
				(bigSize ? pax('size', String(size)) : '');
			const bytes = Buffer.from(attributes);
			yield header(`PaxHeaders/${++sequence}`, bytes.length, mtime, 'x');
			yield bytes;
			if (bytes.length % 512) yield Buffer.alloc(512 - (bytes.length % 512));
		}
		yield header(
			longPath ? `member-${sequence}` : name,
			bigSize ? 0 : size,
			mtime,
			directory ? '5' : '0',
		);
		if (directory) {
			const listing = await files.list(source, signal);
			if (listing.truncated)
				throw new Error('directory exceeds archive listing bound');
			for (const entry of listing.entries) {
				if (
					!entry.name ||
					['.', '..'].includes(entry.name) ||
					entry.name.includes('/') ||
					entry.name.includes('\0')
				)
					throw new Error('invalid archive member');
				if (!['dir', 'file'].includes(entry.kind))
					throw new Error('archive refuses links and protected entries');
				yield* member(
					`${source}/${entry.name}`,
					`${destination}/${entry.name}`,
					entry.kind === 'dir',
					entry.kind === 'dir' ? 0 : entry.size,
					entry.mtime,
				);
			}
		} else {
			let read = 0;
			for await (const bytes of files.read(source, signal)) {
				read += bytes.length;
				if (read > size) throw new Error('archive file changed');
				yield bytes;
			}
			if (read !== size) throw new Error('archive file changed');
			if (size % 512) yield Buffer.alloc(512 - (size % 512));
		}
	}
	const name =
		folder
			.split('/')
			.filter((p) => p && p !== '.')
			.at(-1) ?? 'home';
	yield* member(folder, name, true, 0, root.mtime);
	yield Buffer.alloc(1024);
}
function pax(key: string, value: string): string {
	const record = ` ${key}=${value}\n`;
	let size = Buffer.byteLength(record) + 1;
	while (String(size).length + Buffer.byteLength(record) !== size)
		size = String(size).length + Buffer.byteLength(record);
	return `${size}${record}`;
}
function header(
	name: string,
	size: number,
	mtime: number,
	kind: string,
): Buffer {
	const bytes = Buffer.alloc(512);
	const field = (offset: number, length: number, value: string) => {
		const data = Buffer.from(value);
		if (data.length > length) throw new Error('archive field too long');
		bytes.set(data, offset);
	};
	const octal = (value: number, width: number) =>
		`${Math.max(0, Math.floor(value))
			.toString(8)
			.padStart(width - 1, '0')}\0`;
	field(0, 100, name);
	field(100, 8, octal(kind === '5' ? 0o755 : 0o644, 8));
	field(108, 8, octal(0, 8));
	field(116, 8, octal(0, 8));
	field(124, 12, octal(size, 12));
	field(136, 12, octal(mtime, 12));
	field(148, 8, '        ');
	field(156, 1, kind);
	field(257, 6, 'ustar\0');
	field(263, 2, '00');
	field(265, 32, 'bot');
	field(297, 32, 'bot');
	const checksum = bytes.reduce((total, byte) => total + byte, 0);
	field(148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
	return bytes;
}
