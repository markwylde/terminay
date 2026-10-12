import { createGunzip } from 'node:zlib';

import { openStream } from './http.js';
import { ARCHIVE_MANIFEST } from './manifest.js';

/**
 * Reading which commit a published archive was built from without downloading
 * it.
 *
 * The rolling release publishes an archive, its checksum, and its signature,
 * and nothing that names the commit: that is recorded only in the manifest
 * inside the archive. An install that knows when its own build was published
 * can compare times, but a container that has never upgraded knows only its
 * commit. The archive builder sorts members by name, which puts the manifest
 * within the first few tens of kilobytes of a hundred-megabyte file, and the
 * manifest names its revision before its file list — so a ranged request for
 * the head of the archive is enough to read it.
 *
 * What comes back is a hint and nothing more. It is not covered by the
 * signature check, so it only ever decides whether an upgrade is offered; the
 * upgrade itself downloads and verifies the whole archive as it always does.
 */

/** Compressed bytes requested. The manifest's head sits well inside this. */
const HEAD_BYTES = 512 * 1024;
/** Decompressed bytes examined before giving up. */
const MAX_INFLATED_BYTES = 16 * 1024 * 1024;
/** How much of the manifest is read: its identity precedes its file list. */
const MANIFEST_HEAD_BYTES = 4096;
const TAR_BLOCK = 512;

export interface PublishedIdentity {
	readonly revision: string;
	readonly version?: string;
}

function field(block: Buffer, start: number, length: number): string {
	const slice = block.subarray(start, start + length);
	const end = slice.indexOf(0);
	return slice.subarray(0, end < 0 ? length : end).toString('utf8');
}

/**
 * Walks tar headers as the archive inflates, holding only the member it is
 * looking at. `push` returns the identity once the manifest's head is in hand,
 * `null` when the archive ended or was not a tar, and `undefined` to ask for
 * more bytes.
 */
export function createManifestScanner(): (
	chunk: Buffer,
) => PublishedIdentity | null | undefined {
	let held: Buffer = Buffer.alloc(0);
	// Bytes of a member's body still to be discarded before the next header.
	let skip = 0;
	return (chunk) => {
		let incoming = chunk;
		if (skip > 0) {
			const dropped = Math.min(skip, incoming.length);
			skip -= dropped;
			incoming = incoming.subarray(dropped);
		}
		if (incoming.length === 0) return undefined;
		held = held.length === 0 ? incoming : Buffer.concat([held, incoming]);
		while (held.length >= TAR_BLOCK) {
			const name = field(held, 0, 100);
			// Two zero blocks end an archive; an empty name is the first of them.
			if (name.length === 0) return null;
			const size = Number.parseInt(field(held, 124, 12).trim() || '0', 8);
			if (!Number.isSafeInteger(size) || size < 0) return null;
			const type = field(held, 156, 1);
			const isFile = type === '0' || type === '';
			// The manifest sits directly inside the archive's one root directory.
			if (isFile && name.split('/').slice(1).join('/') === ARCHIVE_MANIFEST) {
				const wanted = Math.min(size, MANIFEST_HEAD_BYTES);
				if (held.length < TAR_BLOCK + wanted) return undefined;
				const head = held
					.subarray(TAR_BLOCK, TAR_BLOCK + wanted)
					.toString('utf8');
				const revision = /"revision"\s*:\s*"([a-f0-9]{40})"/u.exec(head)?.[1];
				if (revision === undefined) return null;
				const version = /"version"\s*:\s*"([^"\\]{1,64})"/u.exec(head)?.[1];
				return Object.freeze({
					revision,
					...(version === undefined ? {} : { version }),
				});
			}
			const member = TAR_BLOCK + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK;
			if (member <= held.length) {
				held = held.subarray(member);
			} else {
				skip = member - held.length;
				held = Buffer.alloc(0);
			}
		}
		return undefined;
	};
}

/**
 * The commit the archive at `url` was built from, or `undefined` when the head
 * of the archive did not say. Network failures reject, so the caller can tell
 * "could not ask" from "asked and was not told".
 */
export async function peekPublishedIdentity(
	url: string,
): Promise<PublishedIdentity | undefined> {
	const response = await openStream(url, '*/*', undefined, {
		range: `bytes=0-${HEAD_BYTES - 1}`,
	});
	const status = response.statusCode ?? 0;
	// 206 is the head that was asked for; 200 is a server that ignored the
	// range and is sending everything, which is read only as far as needed.
	if (status !== 200 && status !== 206) {
		response.resume();
		throw new Error(`reading ${url} failed with status ${status}`);
	}
	return new Promise((resolve) => {
		const gunzip = createGunzip();
		const scan = createManifestScanner();
		let total = 0;
		let settled = false;
		const finish = (identity: PublishedIdentity | undefined) => {
			if (settled) return;
			settled = true;
			response.destroy();
			gunzip.destroy();
			resolve(identity);
		};
		gunzip.on('data', (chunk: Buffer) => {
			total += chunk.length;
			const found = scan(chunk);
			if (found !== undefined) finish(found ?? undefined);
			else if (total > MAX_INFLATED_BYTES) finish(undefined);
		});
		// A head cut off mid-stream is the expected end of a ranged read, and
		// surfaces as an error from the inflater once its input runs out.
		gunzip.on('error', () => finish(undefined));
		gunzip.on('end', () => finish(undefined));
		response.on('error', () => finish(undefined));
		response.pipe(gunzip);
	});
}
