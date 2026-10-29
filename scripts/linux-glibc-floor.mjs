#!/usr/bin/env node
// The oldest GNU/Linux userspace a Terminay artifact runs on (ADR-0077), and
// the check that every shipped ELF file stays within it. glibc is only
// backward compatible, so the floor is whatever an artifact was linked
// against: this module names it, the floor image builds at it, and the check
// proves the bytes.
import { execFile } from 'node:child_process';
import { lstat, mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { getPtyRuntimePlatform } from './pty-runtime-platforms.mjs';

const execFileAsync = promisify(execFile);

export const LINUX_GLIBC_FLOOR = Object.freeze({
	// Debian 11 / Ubuntu 20.04. Electron needs 2.25 and Node 24 needs 2.28.
	GLIBC: '2.31',
	// GCC 10's libstdc++, the one the floor image compiles with.
	GLIBCXX: '3.4.28',
	CXXABI: '1.3.12',
});

/** Every Linux artifact is compiled, packaged, and staged in this image. */
export const LINUX_FLOOR_BUILD_IMAGE =
	'node:24.15.0-bullseye@sha256:44aeb8a19d0a201cdcb18ea3b25de9249454e6fc3cd05731584659859022fefb';

/** A clean floor host: no compiler, npm, or Node. Artifacts are probed here. */
export const LINUX_FLOOR_RUNTIME_IMAGE =
	'debian:bullseye-slim@sha256:e5b6442dd2e9684cf5e87d8338b5968f3b348636fc0be6d7850a381e3731a2bd';

const ELF_MAGIC = 0x7f454c46;
const SHT_GNU_VERNEED = 0x6ffffffe;
const FLOORED_VERSION = /^(GLIBC|GLIBCXX|CXXABI)_(\d+(?:\.\d+)*)$/u;

function compareVersions(left, right) {
	const a = left.split('.').map(Number);
	const b = right.split('.').map(Number);
	for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
		const difference = (a[index] ?? 0) - (b[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

async function readAt(handle, position, length) {
	const buffer = Buffer.alloc(length);
	const { bytesRead } = await handle.read(buffer, 0, length, position);
	if (bytesRead !== length)
		throw new Error(`truncated ELF read at ${position}`);
	return buffer;
}

function readCString(buffer, offset) {
	const end = buffer.indexOf(0, offset);
	return buffer.toString('latin1', offset, end === -1 ? buffer.length : end);
}

/**
 * The machine and versioned dependencies of one ELF file, or `undefined` when
 * the file is not ELF. Only the header, the section table, the version-needs
 * section, and its string table are read, so a 200 MB Electron binary costs a
 * few kilobytes.
 */
export async function readElfVersionNeeds(path) {
	const handle = await open(path, 'r');
	try {
		const { size } = await handle.stat();
		if (size < 52) return undefined;
		const ident = await readAt(handle, 0, 64 <= size ? 64 : 52);
		if (ident.readUInt32BE(0) !== ELF_MAGIC) return undefined;
		const is64 = ident[4] === 2;
		const little = ident[5] === 1;
		if ((ident[4] !== 1 && !is64) || (ident[5] !== 1 && ident[5] !== 2))
			throw new Error(`${path}: unsupported ELF class or byte order`);
		const u16 = (buffer, offset) =>
			little ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
		const u32 = (buffer, offset) =>
			little ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
		const word = (buffer, offset) =>
			is64
				? Number(
						little
							? buffer.readBigUInt64LE(offset)
							: buffer.readBigUInt64BE(offset),
					)
				: u32(buffer, offset);
		const machine = u16(ident, 18);
		const sectionTable = word(ident, is64 ? 0x28 : 0x20);
		const sectionSize = u16(ident, is64 ? 0x3a : 0x2e);
		const sectionCount = u16(ident, is64 ? 0x3c : 0x30);
		const needs = [];
		if (sectionTable === 0 || sectionCount === 0)
			return { machine, needs };
		const sections = await readAt(
			handle,
			sectionTable,
			sectionSize * sectionCount,
		);
		const section = (index) => {
			const base = index * sectionSize;
			return {
				type: u32(sections, base + 4),
				offset: word(sections, base + (is64 ? 24 : 16)),
				size: word(sections, base + (is64 ? 32 : 20)),
				link: u32(sections, base + (is64 ? 40 : 24)),
				info: u32(sections, base + (is64 ? 44 : 28)),
			};
		};
		for (let index = 0; index < sectionCount; index += 1) {
			const verneed = section(index);
			if (verneed.type !== SHT_GNU_VERNEED) continue;
			if (verneed.link >= sectionCount)
				throw new Error(`${path}: version needs link to no string table`);
			const strings = section(verneed.link);
			const table = await readAt(handle, strings.offset, strings.size);
			const data = await readAt(handle, verneed.offset, verneed.size);
			// Elf32_Verneed and Elf64_Verneed share one layout.
			let entry = 0;
			for (let count = 0; count < verneed.info; count += 1) {
				const file = readCString(table, u32(data, entry + 4));
				const versions = [];
				let aux = entry + u32(data, entry + 8);
				for (let item = 0; item < u16(data, entry + 2); item += 1) {
					versions.push(readCString(table, u32(data, aux + 8)));
					const next = u32(data, aux + 12);
					if (next === 0) break;
					aux += next;
				}
				needs.push({ file, versions });
				const next = u32(data, entry + 12);
				if (next === 0) break;
				entry += next;
			}
		}
		return { machine, needs };
	} finally {
		await handle.close();
	}
}

/** The floored versions a file needs above the floor. */
export function versionsAboveFloor(needs, floor = LINUX_GLIBC_FLOOR) {
	const above = [];
	for (const { file, versions } of needs) {
		for (const version of versions) {
			const match = FLOORED_VERSION.exec(version);
			if (match === null) continue;
			const [, family, number] = match;
			if (compareVersions(number, floor[family]) > 0)
				above.push({ library: file, version });
		}
	}
	return above;
}

async function* regularFiles(root) {
	const entries = await readdir(root, { withFileTypes: true });
	for (const entry of entries) {
		const path = join(root, entry.name);
		// Symlinks are never followed: they point at files already walked, or
		// outside the artifact.
		if (entry.isSymbolicLink()) continue;
		if (entry.isDirectory()) yield* regularFiles(path);
		else if (entry.isFile()) yield path;
	}
}

/**
 * Check every ELF file of `elfMachine` under `root` against the floor. Files
 * built for another machine are counted and skipped: they are never loaded on
 * this target.
 */
export async function checkGlibcFloor(root, { elfMachine, floor } = {}) {
	if (!Number.isSafeInteger(elfMachine))
		throw new Error('checkGlibcFloor needs the target ELF machine');
	const result = { checked: 0, foreign: 0, violations: [] };
	for await (const path of regularFiles(root)) {
		const elf = await readElfVersionNeeds(path);
		if (elf === undefined) continue;
		if (elf.machine !== elfMachine) {
			result.foreign += 1;
			continue;
		}
		result.checked += 1;
		for (const above of versionsAboveFloor(elf.needs, floor))
			result.violations.push({ path: relative(root, path), ...above });
	}
	return result;
}

async function extractArtifact(artifact, destination) {
	const details = await lstat(artifact);
	if (details.isDirectory()) return artifact;
	if (!details.isFile()) throw new Error(`${artifact} is not a regular file`);
	if (artifact.endsWith('.tar.gz')) {
		await execFileAsync('tar', [
			'-xzf',
			artifact,
			'--no-same-owner',
			'-C',
			destination,
		]);
		return destination;
	}
	if (artifact.endsWith('.AppImage')) {
		// The AppImage runtime is static and extracts without FUSE.
		await execFileAsync(resolve(artifact), ['--appimage-extract'], {
			cwd: destination,
			maxBuffer: 64 * 1024 * 1024,
		});
		return join(destination, 'squashfs-root');
	}
	throw new Error(
		`${artifact}: expected a directory, an .AppImage, or a .tar.gz`,
	);
}

function describeFloor(floor = LINUX_GLIBC_FLOOR) {
	return `GLIBC_${floor.GLIBC}, GLIBCXX_${floor.GLIBCXX}, CXXABI_${floor.CXXABI}`;
}

async function main(argv) {
	const [command, ...rest] = argv;
	if (command === 'build-image') {
		process.stdout.write(`${LINUX_FLOOR_BUILD_IMAGE}\n`);
		return 0;
	}
	if (command === 'runtime-image') {
		process.stdout.write(`${LINUX_FLOOR_RUNTIME_IMAGE}\n`);
		return 0;
	}
	const targetIndex = rest.indexOf('--target');
	if (command !== 'check' || targetIndex === -1 || rest.length < 3) {
		process.stderr.write(
			'Usage: linux-glibc-floor.mjs check --target <linux-x64|linux-arm64> <artifact>...\n' +
				'       linux-glibc-floor.mjs build-image|runtime-image\n',
		);
		return 64;
	}
	const { elfMachine } = getPtyRuntimePlatform(rest[targetIndex + 1]);
	const artifacts = rest.filter(
		(_, index) => index !== targetIndex && index !== targetIndex + 1,
	);
	let failed = false;
	for (const artifact of artifacts) {
		const temporary = await mkdtemp(join(tmpdir(), 'terminay-glibc-floor-'));
		try {
			const root = await extractArtifact(artifact, temporary);
			const result = await checkGlibcFloor(root, { elfMachine });
			if (result.checked === 0)
				throw new Error(`${artifact}: no ELF file for the target machine`);
			const summary = `${basename(artifact)}: ${result.checked} ELF files checked against ${describeFloor()}, ${result.foreign} for other machines skipped`;
			if (result.violations.length === 0) {
				process.stdout.write(`${summary}; all within the floor\n`);
				continue;
			}
			failed = true;
			process.stderr.write(`${summary}; above the floor:\n`);
			for (const violation of result.violations)
				process.stderr.write(
					`  ${violation.path} needs ${violation.version} (${violation.library})\n`,
				);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	}
	return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).then(
		(code) => {
			process.exitCode = code;
		},
		(error) => {
			process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
			process.exitCode = 1;
		},
	);
}
