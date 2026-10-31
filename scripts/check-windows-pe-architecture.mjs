#!/usr/bin/env node
// Every PE image in a Windows x64 build must be x64 (server-runtime-and-protocol,
// "Windows PE architecture checks"). Reads each file's PE `Machine` field; a
// file that is not a PE image is not checked. Usage:
//   node scripts/check-windows-pe-architecture.mjs <directory>...
import { closeSync, openSync, readdirSync, readSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `IMAGE_FILE_MACHINE_*` values, in decimal: 0x14c, 0x8664, 0xaa64, 0x1c4. */
export const PE_MACHINES = Object.freeze({
	332: 'x86',
	34404: 'x64',
	43620: 'arm64',
	452: 'arm',
});

/** The `Machine` of a PE image's bytes, or `null` when they are not one. */
export function peMachine(bytes) {
	if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const header = view.getUint32(0x3c, true);
	if (header + 6 > bytes.length) return null;
	if (view.getUint32(header, true) !== 0x00004550) return null;
	return view.getUint16(header + 4, true);
}

function readHead(path) {
	const fd = openSync(path, 'r');
	try {
		const head = Buffer.alloc(4096);
		const length = readSync(fd, head, 0, head.length, 0);
		return head.subarray(0, length);
	} finally {
		closeSync(fd);
	}
}

/**
 * Images that are not x64 but load only into a process of their own
 * architecture, matched against the path relative to the payload root.
 */
export const ALLOWED_NON_X64_IMAGES = Object.freeze([
	// electron-builder's 32-bit elevation helper, started as its own process.
	{ machine: 'x86', path: /^resources\/elevate\.exe$/u },
	// Built-in extension trees are byte-identical in every release, so they
	// carry each Windows architecture's koffi build; an x64 process loads only
	// win32_x64.
	{
		machine: 'arm64',
		path: /^resources\/built-in-extensions\/artifacts\/[^/]+\/node_modules\/koffi\/build\/koffi\/win32_arm64\/koffi\.node$/u,
	},
	{
		machine: 'x86',
		path: /^resources\/built-in-extensions\/artifacts\/[^/]+\/node_modules\/koffi\/build\/koffi\/win32_ia32\/koffi\.node$/u,
	},
]);

function allowed(path, machine) {
	const portable = path.split(sep).join('/');
	return ALLOWED_NON_X64_IMAGES.some(
		(entry) => entry.machine === machine && entry.path.test(portable),
	);
}

/** Every PE image under `root` that is not x64 and not allowed, as `{ path, machine }`. */
export function nonX64Images(root) {
	const found = [];
	const walk = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.isFile()) {
				const machine = peMachine(readHead(path));
				if (machine === null || machine === 0x8664) continue;
				const image = {
					path: relative(root, path),
					machine: PE_MACHINES[machine] ?? `0x${machine.toString(16)}`,
				};
				if (!allowed(image.path, image.machine)) found.push(image);
			}
		}
	};
	walk(root);
	return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const roots = process.argv.slice(2);
	if (roots.length === 0) {
		console.error('usage: check-windows-pe-architecture.mjs <directory>...');
		process.exit(2);
	}
	const failures = roots.flatMap((root) =>
		nonX64Images(root).map((image) => `${join(root, image.path)}: ${image.machine}`),
	);
	if (failures.length > 0) {
		console.error(`PE images that are not x64:\n${failures.join('\n')}`);
		process.exit(1);
	}
	console.log('every PE image is x64');
}
