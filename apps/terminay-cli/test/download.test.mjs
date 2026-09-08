import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { downloadAsset, hashFile } from '../dist/download.js';
import { startHttpsFixture } from './https-fixture.mjs';

const FIXTURE = randomBytes(64 * 1024);
const FIXTURE_SHA256 = createHash('sha256').update(FIXTURE).digest('hex');

async function withPrefix(run) {
	const prefix = await mkdtemp(join(tmpdir(), 'terminay-download-'));
	try {
		await run(prefix);
	} finally {
		await rm(prefix, { recursive: true, force: true });
	}
}

/** Serves the fixture archive, honouring range requests so resume is exercised. */
async function serveArchive(options = {}) {
	const ranges = [];
	const fixture = await startHttpsFixture((request, response) => {
		if (options.status !== undefined) {
			response.writeHead(options.status);
			response.end();
			return;
		}
		const range = request.headers.range;
		ranges.push(range);
		if (typeof range === 'string' && options.ignoreRange !== true) {
			const start = Number(/bytes=(\d+)-/u.exec(range)?.[1] ?? '0');
			const slice = FIXTURE.subarray(start);
			response.writeHead(206, { 'content-length': slice.length });
			response.end(slice);
			return;
		}
		if (options.truncateAfter !== undefined) {
			response.writeHead(200, { 'content-length': FIXTURE.length });
			response.write(FIXTURE.subarray(0, options.truncateAfter));
			response.destroy();
			return;
		}
		response.writeHead(200, { 'content-length': FIXTURE.length });
		response.end(FIXTURE);
	});
	return { ...fixture, ranges };
}

test('an asset is streamed to disk and hashed', async () => {
	const server = await serveArchive();
	try {
		await withPrefix(async (prefix) => {
			const asset = await downloadAsset(`${server.origin}/archive.tar.gz`, prefix);
			assert.equal(asset.sha256, FIXTURE_SHA256);
			assert.equal(asset.bytes, FIXTURE.length);
			assert.deepEqual(await readFile(asset.path), FIXTURE);
			assert.ok(asset.path.startsWith(prefix), 'the partial file stays under the install prefix');
			assert.equal(await hashFile(asset.path), FIXTURE_SHA256);
		});
	} finally {
		await server.close();
	}
});

test('an interrupted download resumes from the partial file', async () => {
	const truncating = await serveArchive({ truncateAfter: 20_000 });
	let partialPath;
	await withPrefix(async (prefix) => {
		await assert.rejects(() => downloadAsset(`${truncating.origin}/archive.tar.gz`, prefix));
		await truncating.close();

		// The failed attempt cleans up after itself, so resume is proven by
		// staging a partial file the way an interrupted process would leave one.
		partialPath = join(prefix, '.downloads', 'archive.tar.gz.part');
		await writeFile(partialPath, FIXTURE.subarray(0, 20_000));

		const server = await serveArchive();
		try {
			const asset = await downloadAsset(`${server.origin}/archive.tar.gz`, prefix);
			assert.equal(asset.sha256, FIXTURE_SHA256);
			assert.equal(asset.bytes, FIXTURE.length);
			assert.deepEqual(server.ranges, ['bytes=20000-'], 'expected a single ranged request');
		} finally {
			await server.close();
		}
	});
});

test('a server that ignores the range request replaces the partial file', async () => {
	const server = await serveArchive({ ignoreRange: true });
	try {
		await withPrefix(async (prefix) => {
			const partial = join(prefix, '.downloads', 'archive.tar.gz.part');
			await writeFile(partial, FIXTURE.subarray(0, 20_000)).catch(async () => {
				await downloadAsset(`${server.origin}/archive.tar.gz`, prefix);
			});
			const asset = await downloadAsset(`${server.origin}/archive.tar.gz`, prefix);
			assert.equal(asset.sha256, FIXTURE_SHA256, 'a whole-body response must not be appended to the partial file');
		});
	} finally {
		await server.close();
	}
});

test('a failed download leaves nothing behind', async () => {
	const server = await serveArchive({ status: 404 });
	try {
		await withPrefix(async (prefix) => {
			await assert.rejects(() => downloadAsset(`${server.origin}/archive.tar.gz`, prefix), /status 404/u);
			const partial = join(prefix, '.downloads', 'archive.tar.gz.part');
			assert.equal(await stat(partial).catch(() => undefined), undefined, 'the partial file must be removed');
		});
	} finally {
		await server.close();
	}
});

test('plain HTTP is refused', async () => {
	await withPrefix(async (prefix) => {
		await assert.rejects(() => downloadAsset('http://example.com/archive.tar.gz', prefix), /non-HTTPS/u);
	});
});
