import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';

const ARCHIVE_FRAME_BYTES = 8;
const ARCHIVE_CHUNK_BYTES = 48 * 1024;
const LEGACY_BASE64_CHUNK_CHARS = 64 * 1024;
const INSTALL_SAMPLES = 7;

/**
 * Measure the old per-file/base64 wire model against the current archive
 * transfer. This is deliberately a Node-only transport/install benchmark: it
 * measures protocol bytes and browser-equivalent decode/extract work without
 * involving Docker, a browser, or an unreliable network.
 */
export async function runServerUiArchiveBenchmark(options) {
	const rendererDirectory = resolve(
		requiredString(options.rendererDirectory, 'rendererDirectory'),
	);
	const publicDirectory =
		options.publicDirectory === undefined
			? undefined
			: resolve(requiredString(options.publicDirectory, 'publicDirectory'));
	const entryPath = options.entryPath ?? 'server.html';
	const protocolVersion = options.protocolVersion ?? '1';
	const buildArchive = options.buildArchive ?? (await loadArchiveBuilder());
	const sourceFiles = await collectSourceFiles(
		rendererDirectory,
		publicDirectory,
	);
	const archive = await buildArchive({
		entryPath,
		protocolVersion,
		publicDirectory,
		rendererDirectory,
	});
	const archiveInstall = benchmarkInstall(
		() => installArchive(archive.bytes),
		INSTALL_SAMPLES,
	);
	const legacyWire = createLegacyWireModel(sourceFiles);
	const legacyInstall = benchmarkInstall(
		() => installLegacy(legacyWire),
		INSTALL_SAMPLES,
	);
	const archiveWire = createArchiveWireModel(archive);

	return Object.freeze({
		archive: Object.freeze({
			archiveBytes: archive.bytes.byteLength,
			base64BodyBytes: 0,
			bodyEncoding: 'binary',
			bundleId: archive.bundleId,
			compressedBytes: archive.compressedBytes,
			entriesInstalled: archiveInstall.entries,
			installDurationMs: archiveInstall.medianMs,
			installSamplesMs: archiveInstall.samplesMs,
			requestCount: 1,
			serverToBrowserBytes: archiveWire.serverToBrowserBytes,
			totalWireBytes: archiveWire.totalWireBytes,
			browserToServerBytes: archiveWire.browserToServerBytes,
		}),
		legacyPerFileBase64: Object.freeze({
			base64BodyBytes: legacyWire.base64BodyBytes,
			bodyEncoding: 'base64',
			entriesInstalled: legacyInstall.entries,
			installDurationMs: legacyInstall.medianMs,
			installSamplesMs: legacyInstall.samplesMs,
			requestCount: legacyWire.requestCount,
			serverToBrowserBytes: legacyWire.serverToBrowserBytes,
			totalWireBytes: legacyWire.totalWireBytes,
			browserToServerBytes: legacyWire.browserToServerBytes,
		}),
		measurement: Object.freeze({
			installSamples: INSTALL_SAMPLES,
			model:
				'JSON UTF-8 control messages plus WebRTC application bytes; archive binary frames include their 8-byte header.',
			rendererDirectory,
			sourceEntries: sourceFiles.length,
		}),
		schemaVersion: 1,
	});
}

async function collectSourceFiles(rendererDirectory, publicDirectory) {
	const roots = [rendererDirectory];
	if (publicDirectory !== undefined && publicDirectory !== rendererDirectory)
		roots.push(publicDirectory);
	const files = new Map();
	for (const root of roots) {
		let entries;
		try {
			entries = await fs.readdir(root, {
				recursive: true,
				withFileTypes: true,
			});
		} catch (error) {
			if (root === publicDirectory && error?.code === 'ENOENT') continue;
			throw error;
		}
		for (const entry of entries) {
			if (!entry.isFile()) continue;
			const parent = entry.parentPath ?? dirname(join(root, entry.name));
			const path = relative(root, join(parent, entry.name))
				.split(sep)
				.join('/');
			if (path.endsWith('.map') || files.has(path)) continue;
			files.set(path, await fs.readFile(join(root, path)));
		}
	}
	return [...files.entries()]
		.map(([path, bytes]) => Object.freeze({ bytes, path }))
		.sort((left, right) => left.path.localeCompare(right.path));
}

function createArchiveWireModel(archive) {
	const chunks = Math.ceil(archive.bytes.byteLength / ARCHIVE_CHUNK_BYTES);
	const request = jsonBytes({
		archiveFormatVersion: 1,
		id: 'archive',
		type: 'asset:get-bundle',
	});
	const start = jsonBytes({
		archiveFormatVersion: 1,
		bundleId: archive.bundleId,
		chunkBytes: ARCHIVE_CHUNK_BYTES,
		chunks,
		compressedBytes: archive.bytes.byteLength,
		id: 'archive',
		type: 'asset:bundle-start',
	});
	const complete = jsonBytes({ id: 'archive', type: 'asset:bundle-complete' });
	const acknowledgements = Array.from({ length: chunks }, (_, index) =>
		jsonBytes({ id: 'archive', index, type: 'asset:bundle-ack' }),
	);
	const browserToServerBytes = request + sum(acknowledgements);
	const serverToBrowserBytes =
		start + complete + archive.bytes.byteLength + chunks * ARCHIVE_FRAME_BYTES;
	return {
		browserToServerBytes,
		serverToBrowserBytes,
		totalWireBytes: browserToServerBytes + serverToBrowserBytes,
	};
}

/** Build the former `asset:get-manifest` + `asset:get` JSON protocol from the
 * exact files carried by the archive. The message field names and chunking
 * match the pre-archive WebRTC host implementation. */
function createLegacyWireModel(files) {
	const identity = createHash('sha256');
	for (const file of files) {
		identity.update(file.path);
		identity.update('\0');
		identity.update(file.bytes);
		identity.update('\0');
	}
	const bundleId = identity.digest('base64url');
	const assets = files.map(({ bytes, path }) => ({
		contentType: contentType(path),
		hash: createHash('sha256').update(bytes).digest('base64url'),
		path: `/remote-app/${bundleId}/${path}`,
		size: bytes.byteLength,
	}));
	const manifest = {
		assets,
		bundleFormatVersion: 1,
		bundleId,
		contentSecurityPolicy:
			"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
		entryPath: `/remote-app/${bundleId}/server.html`,
		hostCompatibility: {
			bootstrap: { maximum: 1, minimum: 1 },
			bundleFormat: { maximum: 1, minimum: 1 },
			byteEndpoint: { maximum: 1, minimum: 1 },
			hostBridge: { maximum: 1, minimum: 1 },
			optionalCapabilities: {
				clipboardWrite: { maximum: 1, minimum: 1 },
				notifications: { maximum: 1, minimum: 1 },
			},
			requiredCapabilities: {},
		},
		protocolVersion: '1',
		schemaVersion: 1,
		serverVersion: 'benchmark',
	};
	const requests = [
		JSON.stringify({ id: 'manifest', type: 'asset:get-manifest' }),
	];
	const responses = [JSON.stringify({ ...manifest, id: 'manifest' })];
	const acknowledgements = [];
	let base64BodyBytes = 0;
	for (const [index, file] of files.entries()) {
		const id = `asset-${index}`;
		const asset = assets[index];
		const bodyBase64 = file.bytes.toString('base64');
		base64BodyBytes += Buffer.byteLength(bodyBase64);
		requests.push(JSON.stringify({ id, path: asset.path, type: 'asset:get' }));
		if (bodyBase64.length <= LEGACY_BASE64_CHUNK_CHARS) {
			responses.push(
				JSON.stringify({
					bodyBase64,
					contentType: asset.contentType,
					hash: asset.hash,
					id,
					path: asset.path,
				}),
			);
			continue;
		}
		const total = Math.ceil(bodyBase64.length / LEGACY_BASE64_CHUNK_CHARS);
		for (let chunk = 0; chunk < total; chunk += 1) {
			responses.push(
				JSON.stringify({
					bodyBase64Chunk: bodyBase64.slice(
						chunk * LEGACY_BASE64_CHUNK_CHARS,
						(chunk + 1) * LEGACY_BASE64_CHUNK_CHARS,
					),
					contentType: asset.contentType,
					hash: asset.hash,
					id,
					index: chunk,
					path: asset.path,
					total,
					type: 'asset:chunk',
				}),
			);
			acknowledgements.push(
				JSON.stringify({ id, index: chunk, type: 'asset:ack' }),
			);
		}
	}
	const browserToServerBytes =
		sum(requests.map(jsonBytes)) + sum(acknowledgements.map(jsonBytes));
	const serverToBrowserBytes = sum(responses.map(jsonBytes));
	return Object.freeze({
		acknowledgements,
		base64BodyBytes,
		browserToServerBytes,
		requestCount: requests.length,
		responses,
		serverToBrowserBytes,
		totalWireBytes: browserToServerBytes + serverToBrowserBytes,
	});
}

function installArchive(bytes) {
	const tar = gunzipSync(bytes);
	const installed = new Map();
	let offset = 0;
	while (offset + 512 <= tar.byteLength) {
		const header = tar.subarray(offset, offset + 512);
		offset += 512;
		if (header.every((byte) => byte === 0)) break;
		const name = tarText(header.subarray(0, 100));
		const prefix = tarText(header.subarray(345, 500));
		const path = prefix ? `${prefix}/${name}` : name;
		const size = Number.parseInt(
			tarText(header.subarray(124, 136)).trim() || '0',
			8,
		);
		if (
			!safeArchivePath(path) ||
			header[156] !== 0x30 ||
			!Number.isSafeInteger(size) ||
			size < 0 ||
			offset + size > tar.byteLength
		) {
			throw new Error('benchmark archive is malformed');
		}
		installed.set(path, Buffer.from(tar.subarray(offset, offset + size)));
		offset += Math.ceil(size / 512) * 512;
	}
	if (!installed.has('terminay-bundle.json'))
		throw new Error('benchmark archive metadata is missing');
	return installed.size - 1;
}

function installLegacy(wire) {
	const installed = new Map();
	const chunks = new Map();
	for (const raw of wire.responses) {
		const response = JSON.parse(raw);
		if (response.id === 'manifest') continue;
		if (typeof response.bodyBase64 === 'string') {
			installed.set(response.path, Buffer.from(response.bodyBase64, 'base64'));
			continue;
		}
		const transfer = chunks.get(response.id) ?? {
			path: response.path,
			pieces: [],
			total: response.total,
		};
		transfer.pieces[response.index] = response.bodyBase64Chunk;
		chunks.set(response.id, transfer);
	}
	for (const transfer of chunks.values())
		installed.set(
			transfer.path,
			Buffer.from(transfer.pieces.join(''), 'base64'),
		);
	return installed.size;
}

function benchmarkInstall(install, samples) {
	const samplesMs = [];
	let entries = 0;
	for (let index = 0; index < samples; index += 1) {
		const startedAt = performance.now();
		entries = install();
		samplesMs.push(round(performance.now() - startedAt));
	}
	const ordered = [...samplesMs].sort((left, right) => left - right);
	return {
		entries,
		medianMs: ordered[Math.floor(ordered.length / 2)],
		samplesMs,
	};
}

function contentType(path) {
	if (path.endsWith('.css')) return 'text/css; charset=utf-8';
	if (path.endsWith('.html')) return 'text/html; charset=utf-8';
	if (path.endsWith('.js') || path.endsWith('.mjs'))
		return 'application/javascript; charset=utf-8';
	if (path.endsWith('.svg')) return 'image/svg+xml';
	return 'application/octet-stream';
}

function safeArchivePath(value) {
	return (
		value.length > 0 &&
		!value.startsWith('/') &&
		!value.includes('\\') &&
		!value.includes('\0') &&
		!value
			.split('/')
			.some((part) => part === '' || part === '.' || part === '..')
	);
}

function tarText(bytes) {
	const end = bytes.indexOf(0);
	return Buffer.from(end < 0 ? bytes : bytes.subarray(0, end)).toString('utf8');
}

function jsonBytes(value) {
	return Buffer.byteLength(
		typeof value === 'string' ? value : JSON.stringify(value),
	);
}

function sum(values) {
	return values.reduce((total, value) => total + value, 0);
}

function requiredString(value, name) {
	if (typeof value !== 'string' || value.length === 0)
		throw new TypeError(`${name} is required`);
	return value;
}

function round(value) {
	return Math.round(value * 1000) / 1000;
}

async function loadArchiveBuilder() {
	const directory = await fs.mkdtemp(
		join(process.env.TMPDIR ?? '/tmp', 'terminay-server-ui-archive-benchmark-'),
	);
	const outputPath = join(directory, 'serverUiArchive.mjs');
	try {
		await build({
			bundle: true,
			entryPoints: [
				new URL('../electron/remote/serverUiArchive.ts', import.meta.url)
					.pathname,
			],
			format: 'esm',
			outfile: outputPath,
			platform: 'node',
			target: 'node24',
		});
		return (await import(`${pathToFileURL(outputPath).href}?${Date.now()}`))
			.buildServerUiArchive;
	} finally {
		await fs.rm(directory, { force: true, recursive: true });
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const report = await runServerUiArchiveBenchmark({
		entryPath: args.entryPath,
		publicDirectory: args.publicDirectory,
		protocolVersion: args.protocolVersion,
		rendererDirectory: args.rendererDirectory,
	});
	const output = `${JSON.stringify(report, null, 2)}\n`;
	if (args.output !== undefined)
		await fs.writeFile(resolve(args.output), output);
	process.stdout.write(output);
}

function parseArgs(args) {
	const values = {};
	for (let index = 0; index < args.length; index += 2) {
		const flag = args[index];
		const value = args[index + 1];
		if (
			value === undefined ||
			![
				'--entry-path',
				'--output',
				'--protocol-version',
				'--public-directory',
				'--renderer-directory',
			].includes(flag)
		) {
			throw new Error(
				'Expected --renderer-directory <path> [--public-directory <path>] [--entry-path <path>] [--protocol-version <version>] [--output <path>]',
			);
		}
		values[
			flag
				.slice(2)
				.replace(/-([a-z])/g, (_, character) => character.toUpperCase())
		] = value;
	}
	return values;
}

if (
	process.argv[1] &&
	pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
	main().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
		process.exitCode = 1;
	});
}
