import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PROTOCOL_LIMITS } from '@terminay/protocol';
import { TerminalServiceError } from './errors.js';

export const TERMINAL_MATERIALIZE_CLIPBOARD_IMAGE_OPERATION =
	'terminal.materialize-clipboard-image';

export const CLIPBOARD_IMAGE_DIRECTORY_NAME = 'terminay-clipboard';

/** Stay inside the framed command body budget rather than a round 8 MiB. */
export const MAX_CLIPBOARD_IMAGE_BYTES = DEFAULT_PROTOCOL_LIMITS.maxBodyBytes;

const EXTENSIONS = Object.freeze({
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/webp': 'webp',
	'image/gif': 'gif',
} as const);

export type ClipboardImageMimeType = keyof typeof EXTENSIONS;

export function clipboardImageDirectory(root = tmpdir()): string {
	return join(root, CLIPBOARD_IMAGE_DIRECTORY_NAME);
}

export function clipboardImageExtension(
	mimeType: string,
): (typeof EXTENSIONS)[ClipboardImageMimeType] | undefined {
	return EXTENSIONS[mimeType as ClipboardImageMimeType];
}

export async function writeClipboardImage(input: {
	readonly bytes: Uint8Array;
	readonly mimeType: string;
	readonly directory?: string;
}): Promise<string> {
	const extension = clipboardImageExtension(input.mimeType);
	if (extension === undefined)
		throw new TerminalServiceError(
			'invalid_bytes',
			'clipboard image type is not supported',
		);
	if (
		!(input.bytes instanceof Uint8Array) ||
		input.bytes.byteLength === 0 ||
		input.bytes.byteLength > MAX_CLIPBOARD_IMAGE_BYTES
	)
		throw new TerminalServiceError(
			'invalid_bytes',
			'clipboard image exceeds the upload limit',
			{ max: MAX_CLIPBOARD_IMAGE_BYTES },
		);
	if (!bytesMatchMime(input.bytes, input.mimeType))
		throw new TerminalServiceError(
			'invalid_bytes',
			'clipboard image bytes do not match the declared type',
		);
	const directory = input.directory ?? clipboardImageDirectory();
	await mkdir(directory, { recursive: true });
	const filePath = join(directory, `clipboard-${randomUUID()}.${extension}`);
	await writeFile(filePath, input.bytes);
	return filePath;
}

function bytesMatchMime(bytes: Uint8Array, mimeType: string): boolean {
	switch (mimeType) {
		case 'image/png':
			return prefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		case 'image/jpeg':
		case 'image/jpg':
			return prefix(bytes, [0xff, 0xd8, 0xff]);
		case 'image/gif':
			return prefix(bytes, [0x47, 0x49, 0x46, 0x38]);
		case 'image/webp':
			return (
				bytes.byteLength >= 12 &&
				prefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
				bytes[8] === 0x57 &&
				bytes[9] === 0x45 &&
				bytes[10] === 0x42 &&
				bytes[11] === 0x50
			);
		default:
			return false;
	}
}

function prefix(bytes: Uint8Array, expected: readonly number[]): boolean {
	if (bytes.byteLength < expected.length) return false;
	return expected.every((value, index) => bytes[index] === value);
}
