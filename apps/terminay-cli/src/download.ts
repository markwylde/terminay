import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import { openStream, request } from './http.js';

/**
 * Fetching a release asset onto the operator's disk.
 *
 * The archive is around 90 MB, so it is streamed to a partial file and hashed
 * by reading that file back rather than buffered in memory. A partial file
 * that survives an interrupted install is resumed with a range request, and a
 * download that fails for any other reason is deleted: a truncated archive
 * that lingers would fail verification on the next attempt with a message
 * about a bad signature rather than a bad download.
 */

const DOWNLOAD_DIRECTORY = '.downloads';
const MAX_ASSET_BYTES = 512 * 1024 * 1024;

export interface DownloadedAsset {
	readonly path: string;
	readonly sha256: string;
	readonly bytes: number;
}

export async function hashFile(path: string): Promise<string> {
	const hash = createHash('sha256');
	await pipeline(createReadStream(path), hash);
	return hash.digest('hex');
}

async function sizeOf(path: string): Promise<number> {
	const info = await stat(path).catch(() => undefined);
	return info?.isFile() === true ? info.size : 0;
}

export async function downloadAsset(
	url: string,
	prefix: string,
	name = basename(new URL(url).pathname),
): Promise<DownloadedAsset> {
	const directory = join(prefix, DOWNLOAD_DIRECTORY);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const target = join(directory, `${name}.part`);
	const existing = await sizeOf(target);
	try {
		const response = await openStream(
			url,
			'*/*',
			undefined,
			existing > 0 ? { range: `bytes=${existing}-` } : undefined,
		);
		const status = response.statusCode ?? 0;
		// 206 continues the partial file; 200 means the server ignored the range
		// and is sending the whole asset, so the partial file is replaced.
		const resuming = status === 206 && existing > 0;
		if (status !== 200 && status !== 206) {
			response.resume();
			throw new Error(`downloading ${url} failed with status ${status}`);
		}
		const declared = Number(response.headers['content-length'] ?? '0');
		if (
			Number.isFinite(declared) &&
			declared + (resuming ? existing : 0) > MAX_ASSET_BYTES
		) {
			response.resume();
			throw new Error(
				`refusing to download ${url}: it is larger than the ${MAX_ASSET_BYTES}-byte limit`,
			);
		}
		await pipeline(
			response,
			createWriteStream(
				target,
				resuming ? { flags: 'a' } : { flags: 'w', mode: 0o600 },
			),
		);
		const bytes = await sizeOf(target);
		if (bytes === 0)
			throw new Error(`downloading ${url} produced an empty file`);
		if (bytes > MAX_ASSET_BYTES)
			throw new Error(
				`${url} is larger than the ${MAX_ASSET_BYTES}-byte limit`,
			);
		return Object.freeze({
			path: target,
			sha256: await hashFile(target),
			bytes,
		});
	} catch (error) {
		await rm(target, { force: true });
		throw error;
	}
}

/** Sidecars are tiny, so they are read into memory rather than staged. */
export async function downloadText(url: string): Promise<string> {
	const response = await request(url, '*/*');
	if (response.status !== 200)
		throw new Error(`downloading ${url} failed with status ${response.status}`);
	return response.body;
}

export async function downloadBytes(url: string): Promise<Buffer> {
	const response = await openStream(url, '*/*');
	const status = response.statusCode ?? 0;
	if (status !== 200) {
		response.resume();
		throw new Error(`downloading ${url} failed with status ${status}`);
	}
	const chunks: Buffer[] = [];
	let total = 0;
	for await (const chunk of response) {
		total += (chunk as Buffer).length;
		if (total > 64 * 1024) {
			response.destroy();
			throw new Error(`${url} is unexpectedly large for a signature`);
		}
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks);
}

export async function discardDownloads(prefix: string): Promise<void> {
	await rm(join(prefix, DOWNLOAD_DIRECTORY), { recursive: true, force: true });
}
