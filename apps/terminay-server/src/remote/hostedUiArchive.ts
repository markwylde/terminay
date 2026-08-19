import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { MinimalArchive } from './hostedPairingHost.js';

const MAX_ENTRIES = 10_000;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;

type ArchiveFile = Readonly<{ bytes: Buffer; path: string }>;

export async function loadHostedUiArchive(
	rendererDirectory: string,
	entryPath = 'server.html',
): Promise<MinimalArchive> {
	const files = await collectFiles(rendererDirectory);
	if (!files.some((file) => file.path === entryPath)) {
		throw new Error(
			`Hosted UI archive entry ${entryPath} is missing from ${rendererDirectory}.`,
		);
	}
	const bundleId = deriveBundleId(files, entryPath);
	const metadata = Buffer.from(
		JSON.stringify({
			applicationProtocolVersion: '1',
			archiveFormatVersion: 1,
			bundleId,
			entryPath,
		}),
		'utf8',
	);
	return Object.freeze({
		bundleId,
		bytes: gzipSync(
			createTar([{ path: 'terminay-bundle.json', bytes: metadata }, ...files]),
		),
	});
}

async function collectFiles(root: string): Promise<readonly ArchiveFile[]> {
	const files: ArchiveFile[] = [];
	let expandedBytes = 0;
	const queue = [root];
	while (queue.length > 0) {
		const directory = queue.pop();
		if (directory === undefined) break;
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const full = join(directory, entry.name);
			if (entry.isDirectory()) {
				queue.push(full);
				continue;
			}
			if (!entry.isFile() || entry.name.endsWith('.map')) continue;
			const relative = full
				.slice(root.length + 1)
				.split('\\')
				.join('/');
			if (!isSafeRelativePath(relative)) continue;
			const bytes = await readFile(full);
			if (bytes.byteLength > MAX_ENTRY_BYTES) {
				throw new RangeError(
					`Hosted UI archive entry ${relative} exceeds the size limit.`,
				);
			}
			expandedBytes += bytes.byteLength;
			if (expandedBytes > MAX_EXPANDED_BYTES || files.length >= MAX_ENTRIES) {
				throw new RangeError('Hosted UI archive exceeds resource limits.');
			}
			files.push({ path: relative, bytes });
		}
	}
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

function deriveBundleId(files: readonly ArchiveFile[], entryPath: string): string {
	const hash = createHash('sha256');
	hash.update(`hosted-ui-archive\0${entryPath}\0`);
	for (const file of files) {
		hash.update(file.path);
		hash.update('\0');
		hash.update(file.bytes);
		hash.update('\0');
	}
	return hash.digest('base64url');
}

function createTar(files: readonly ArchiveFile[]): Buffer {
	const output: Buffer[] = [];
	for (const file of files) {
		const header = Buffer.alloc(512);
		Buffer.from(file.path, 'utf8').copy(header, 0);
		writeTarText(header, 100, 8, '0000644\0');
		writeTarNumber(header, 124, 12, file.bytes.byteLength);
		header.fill(0x20, 148, 156);
		header[156] = 0x30;
		writeTarText(header, 257, 6, 'ustar\0');
		const checksum = header.reduce((sum, byte) => sum + byte, 0);
		writeTarText(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
		output.push(header, file.bytes);
		const padding = (512 - (file.bytes.byteLength % 512)) % 512;
		if (padding > 0) output.push(Buffer.alloc(padding));
	}
	output.push(Buffer.alloc(1024));
	return Buffer.concat(output);
}

function writeTarNumber(
	header: Buffer,
	offset: number,
	length: number,
	value: number,
): void {
	writeTarText(
		header,
		offset,
		length,
		`${value.toString(8).padStart(length - 1, '0')}\0`,
	);
}

function writeTarText(
	header: Buffer,
	offset: number,
	length: number,
	value: string,
): void {
	Buffer.from(value, 'ascii').copy(header, offset, 0, length);
}

function isSafeRelativePath(value: string): boolean {
	return (
		value.length > 0 &&
		!value.includes('\0') &&
		!value.startsWith('/') &&
		!value.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
	);
}
