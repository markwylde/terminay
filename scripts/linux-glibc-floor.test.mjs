import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	checkGlibcFloor,
	LINUX_FLOOR_BUILD_IMAGE,
	LINUX_FLOOR_RUNTIME_IMAGE,
	LINUX_GLIBC_FLOOR,
	readElfVersionNeeds,
	versionsAboveFloor,
} from './linux-glibc-floor.mjs';

const X64 = 62;
const AARCH64 = 183;
const ARM = 40;

/**
 * A minimal ELF file: header, a string table, one SHT_GNU_verneed section, and
 * the section table. `needs` is `[{ file, versions }]`.
 */
function elf({ machine, needs, is64 = true, little = true }) {
	const strings = ['\0'];
	const offsetOf = new Map();
	const intern = (text) => {
		if (!offsetOf.has(text)) {
			offsetOf.set(text, strings.join('').length);
			strings.push(`${text}\0`);
		}
		return offsetOf.get(text);
	};
	const verneed = [];
	needs.forEach(({ file, versions }, entryIndex) => {
		const entry = Buffer.alloc(16 + 16 * versions.length);
		const w16 = (value, offset) =>
			little ? entry.writeUInt16LE(value, offset) : entry.writeUInt16BE(value, offset);
		const w32 = (value, offset) =>
			little ? entry.writeUInt32LE(value, offset) : entry.writeUInt32BE(value, offset);
		w16(1, 0);
		w16(versions.length, 2);
		w32(intern(file), 4);
		w32(16, 8);
		w32(entryIndex === needs.length - 1 ? 0 : entry.length, 12);
		versions.forEach((version, index) => {
			const base = 16 + 16 * index;
			w32(intern(version), base + 8);
			w32(index === versions.length - 1 ? 0 : 16, base + 12);
		});
		verneed.push(entry);
	});
	const stringTable = Buffer.from(strings.join(''), 'latin1');
	const verneedData = Buffer.concat(verneed);
	const headerSize = is64 ? 64 : 52;
	const sectionSize = is64 ? 64 : 40;
	const stringOffset = headerSize;
	const verneedOffset = stringOffset + stringTable.length;
	const sectionTable = verneedOffset + verneedData.length;
	const header = Buffer.alloc(headerSize);
	header.writeUInt32BE(0x7f454c46, 0);
	header[4] = is64 ? 2 : 1;
	header[5] = little ? 1 : 2;
	header[6] = 1;
	const h16 = (value, offset) =>
		little ? header.writeUInt16LE(value, offset) : header.writeUInt16BE(value, offset);
	const h32 = (value, offset) =>
		little ? header.writeUInt32LE(value, offset) : header.writeUInt32BE(value, offset);
	h16(3, 16);
	h16(machine, 18);
	if (is64) {
		little
			? header.writeBigUInt64LE(BigInt(sectionTable), 0x28)
			: header.writeBigUInt64BE(BigInt(sectionTable), 0x28);
		h16(sectionSize, 0x3a);
		h16(3, 0x3c);
	} else {
		h32(sectionTable, 0x20);
		h16(sectionSize, 0x2e);
		h16(3, 0x30);
	}
	const sections = Buffer.alloc(sectionSize * 3);
	const section = (index, { type, offset, size, link = 0, info = 0 }) => {
		const base = index * sectionSize;
		const s32 = (value, at) =>
			little ? sections.writeUInt32LE(value, base + at) : sections.writeUInt32BE(value, base + at);
		const sWord = (value, at) =>
			is64
				? little
					? sections.writeBigUInt64LE(BigInt(value), base + at)
					: sections.writeBigUInt64BE(BigInt(value), base + at)
				: s32(value, at);
		s32(type, 4);
		sWord(offset, is64 ? 24 : 16);
		sWord(size, is64 ? 32 : 20);
		s32(link, is64 ? 40 : 24);
		s32(info, is64 ? 44 : 28);
	};
	section(1, { type: 3, offset: stringOffset, size: stringTable.length });
	section(2, {
		type: 0x6ffffffe,
		offset: verneedOffset,
		size: verneedData.length,
		link: 1,
		info: needs.length,
	});
	return Buffer.concat([header, stringTable, verneedData, sections]);
}

async function withDirectory(run) {
	const root = await mkdtemp(join(tmpdir(), 'terminay-glibc-floor-test-'));
	try {
		return await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('reads every versioned dependency of a 64-bit little-endian ELF file', async () => {
	await withDirectory(async (root) => {
		const path = join(root, 'pty.node');
		await writeFile(
			path,
			elf({
				machine: X64,
				needs: [
					{ file: 'libc.so.6', versions: ['GLIBC_2.2.5', 'GLIBC_2.42'] },
					{ file: 'libstdc++.so.6', versions: ['GLIBCXX_3.4'] },
				],
			}),
		);
		assert.deepEqual(await readElfVersionNeeds(path), {
			machine: X64,
			needs: [
				{ file: 'libc.so.6', versions: ['GLIBC_2.2.5', 'GLIBC_2.42'] },
				{ file: 'libstdc++.so.6', versions: ['GLIBCXX_3.4'] },
			],
		});
	});
});

test('reads 32-bit and big-endian ELF files', async () => {
	await withDirectory(async (root) => {
		const needs = [{ file: 'libc.so.6', versions: ['GLIBC_2.34'] }];
		const narrow = join(root, 'armhf.node');
		const big = join(root, 'big.node');
		await writeFile(narrow, elf({ machine: ARM, needs, is64: false }));
		await writeFile(big, elf({ machine: AARCH64, needs, little: false }));
		assert.deepEqual(await readElfVersionNeeds(narrow), { machine: ARM, needs });
		assert.deepEqual(await readElfVersionNeeds(big), { machine: AARCH64, needs });
	});
});

test('a file that is not ELF has no version needs', async () => {
	await withDirectory(async (root) => {
		const path = join(root, 'index.js');
		await writeFile(path, 'module.exports = 1;\n'.repeat(8));
		assert.equal(await readElfVersionNeeds(path), undefined);
	});
});

test('only GLIBC, GLIBCXX, and CXXABI versions above the floor are reported', () => {
	assert.deepEqual(
		versionsAboveFloor([
			{
				file: 'libc.so.6',
				versions: ['GLIBC_2.31', 'GLIBC_2.32', 'GLIBC_PRIVATE', 'GLIBC_2.2.5'],
			},
			{ file: 'libstdc++.so.6', versions: ['GLIBCXX_3.4.28', 'GLIBCXX_3.4.29', 'CXXABI_1.3.13'] },
			{ file: 'libgcc_s.so.1', versions: ['GCC_12.0.0'] },
		]),
		[
			{ library: 'libc.so.6', version: 'GLIBC_2.32' },
			{ library: 'libstdc++.so.6', version: 'GLIBCXX_3.4.29' },
			{ library: 'libstdc++.so.6', version: 'CXXABI_1.3.13' },
		],
	);
});

test('the check fails on the target machine and skips other machines and symlinks', async () => {
	await withDirectory(async (root) => {
		const release = join(root, 'node_modules', 'node-pty', 'build', 'Release');
		const koffi = join(root, 'koffi', 'linux_armhf');
		await mkdir(release, { recursive: true });
		await mkdir(koffi, { recursive: true });
		await writeFile(
			join(release, 'pty.node'),
			elf({ machine: X64, needs: [{ file: 'libc.so.6', versions: ['GLIBC_2.42'] }] }),
		);
		await writeFile(
			join(root, 'terminay'),
			elf({ machine: X64, needs: [{ file: 'libc.so.6', versions: ['GLIBC_2.25'] }] }),
		);
		await writeFile(
			join(koffi, 'koffi.node'),
			elf({ machine: ARM, is64: false, needs: [{ file: 'libc.so.6', versions: ['GLIBC_2.34'] }] }),
		);
		await symlink(join(release, 'pty.node'), join(root, 'pty-link.node'));
		assert.deepEqual(await checkGlibcFloor(root, { elfMachine: X64 }), {
			checked: 2,
			foreign: 1,
			violations: [
				{
					path: join('node_modules', 'node-pty', 'build', 'Release', 'pty.node'),
					library: 'libc.so.6',
					version: 'GLIBC_2.42',
				},
			],
		});
		assert.deepEqual(await checkGlibcFloor(root, { elfMachine: ARM }), {
			checked: 1,
			foreign: 2,
			violations: [
				{
					path: join('koffi', 'linux_armhf', 'koffi.node'),
					library: 'libc.so.6',
					version: 'GLIBC_2.34',
				},
			],
		});
	});
});

test('the floor is glibc 2.31 with GCC 10 libstdc++, built and probed in digest-pinned bullseye images', () => {
	assert.deepEqual(LINUX_GLIBC_FLOOR, {
		GLIBC: '2.31',
		GLIBCXX: '3.4.28',
		CXXABI: '1.3.12',
	});
	assert.match(LINUX_FLOOR_BUILD_IMAGE, /^node:24\.15\.0-bullseye@sha256:[0-9a-f]{64}$/u);
	assert.match(LINUX_FLOOR_RUNTIME_IMAGE, /^debian:bullseye-slim@sha256:[0-9a-f]{64}$/u);
});

test('the floor Dockerfiles build from the declared images', async () => {
	const build = await readFile(new URL('../Dockerfile.linux-floor', import.meta.url), 'utf8');
	const runtime = await readFile(
		new URL('../Dockerfile.linux-floor-runtime', import.meta.url),
		'utf8',
	);
	assert.deepEqual(build.match(/^FROM .*$/gmu), [`FROM ${LINUX_FLOOR_BUILD_IMAGE}`]);
	assert.deepEqual(runtime.match(/^FROM .*$/gmu), [`FROM ${LINUX_FLOOR_RUNTIME_IMAGE}`]);
	// The runtime host is clean: nothing in it can compile or run JavaScript
	// except the artifact under test.
	const instructions = runtime
		.split('\n')
		.filter((line) => !line.trimStart().startsWith('#'))
		.join('\n');
	assert.doesNotMatch(instructions, /\b(?:nodejs|npm|build-essential|gcc|g\+\+|make|python3)\b/u);
});

test('the floor image installs dependencies from the same manifests as the E2E base', async () => {
	const manifests = (text) =>
		[...text.matchAll(/^COPY (?:--chown=\S+ )?(\S+) /gmu)]
			.map(([, source]) => source)
			.filter((source) => source.endsWith('package.json') || source.endsWith('.mjs') || source === 'package-lock.json');
	const floor = await readFile(new URL('../Dockerfile.linux-floor', import.meta.url), 'utf8');
	const e2e = await readFile(new URL('../Dockerfile.e2e-base', import.meta.url), 'utf8');
	assert.deepEqual(manifests(floor), manifests(e2e));
});

test('every Linux lane builds in the floor image and is checked and probed before it publishes', async () => {
	const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
	const workflows = {
		release: await read('.github/workflows/trigger-release.yml'),
		main: await read('.github/workflows/main-prerelease.yml'),
		gitea: await read('.gitea/workflows/ci.yml'),
	};
	// A Linux build anywhere in a workflow runs through the floor wrapper: on
	// the same logical line, continuation lines joined.
	for (const [name, text] of Object.entries(workflows)) {
		const lines = text.replace(/\\\n\s*/gu, ' ').split('\n');
		for (const line of lines) {
			if (/^\s*#/u.test(line)) continue;
			if (/build-standalone-server-artifact\.mjs/u.test(line))
				assert.fail(`${name}: the archive builder runs only inside build-linux-standalone-archive.sh`);
			const linuxBuild =
				/npm run build:linux|build-linux-standalone-archive\.sh|electron-builder[^\n]*--linux|build-main-beta-desktop\.sh[^\n]*(?:linux|beta-release-notes\.md\b(?!"))/u;
			if (!linuxBuild.test(line)) continue;
			assert.match(line, /run-in-linux-floor\.sh/u, `${name}: ${line.trim()}`);
		}
	}
	const step = (text, title) => {
		const start = text.indexOf(`- name: ${title}\n`);
		assert.ok(start >= 0, `missing step ${title}`);
		return start;
	};
	const gated = (text, title, kind, before) => {
		const at = step(text, title);
		const block = text.slice(at, text.indexOf('- name:', at + 1));
		assert.match(block, /node scripts\/linux-glibc-floor\.mjs check --target /u, title);
		assert.match(block, new RegExp(`sh scripts/probe-linux-glibc-floor\\.sh ${kind} `, 'u'), title);
		assert.ok(at < step(text, before), `${title} must run before ${before}`);
	};
	gated(
		workflows.release,
		'Check the Linux AppImage against the glibc floor and run terminals from it there',
		'appimage',
		'Write release asset checksums',
	);
	gated(
		workflows.release,
		'Check the standalone server archive against the glibc floor and run terminals from it there',
		'server-archive',
		'Write and verify standalone server checksum',
	);
	gated(
		workflows.main,
		'Check the main channel archive against the glibc floor and run terminals from it there',
		'server-archive',
		'Probe the extracted main channel archive',
	);
	gated(
		workflows.main,
		'Check the Linux beta AppImage against the glibc floor and run terminals from it there',
		'appimage',
		'Write and verify beta checksum',
	);
});

test('the probe launches the holder with the environment the server gives it', async () => {
	const probe = await readFile(new URL('./linux-glibc-floor-probe.mjs', import.meta.url), 'utf8');
	const process = await readFile(
		new URL('../packages/server-core/src/sessionHolder/process.ts', import.meta.url),
		'utf8',
	);
	const declared = (text) =>
		Object.fromEntries([...text.matchAll(/^\t(\w+): '(TERMINAY_SESSION_HOLDER_\w+)',$/gmu)].map(([, key, name]) => [key, name]));
	const processEnvironment = declared(process);
	const linuxEnvironment = Object.fromEntries(
		Object.entries(processEnvironment).filter(([key]) => key !== 'userSid'),
	);
	assert.deepEqual(declared(probe), linuxEnvironment);
	assert.equal(Object.keys(declared(probe)).length, 5);
});

test('the floor scripts reach Docker without bind-mounting the repository', async () => {
	// A CI job's Docker daemon cannot see the job's filesystem, so sources go
	// in as the build context or by `docker cp`, never as a volume.
	for (const name of ['run-in-linux-floor.sh', 'probe-linux-glibc-floor.sh']) {
		const script = await readFile(new URL(`./${name}`, import.meta.url), 'utf8');
		assert.doesNotMatch(script, /^\s+(?:--volume|--mount|-v(?:[ =]|$))/mu, name);
		assert.match(script, /docker cp /u, name);
	}
});
