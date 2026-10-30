import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { nonX64Images, peMachine } from './check-windows-pe-architecture.mjs';

/** The smallest bytes a PE reader accepts: a DOS stub pointing at a PE header. */
function peImage(machine) {
	const bytes = Buffer.alloc(0x100);
	bytes.write('MZ', 0, 'latin1');
	bytes.writeUInt32LE(0x80, 0x3c);
	bytes.write('PE\0\0', 0x80, 'latin1');
	bytes.writeUInt16LE(machine, 0x84);
	return bytes;
}

test('the PE machine is read from the header the DOS stub points at', () => {
	assert.equal(peMachine(peImage(0x8664)), 0x8664);
	assert.equal(peMachine(peImage(0xaa64)), 0xaa64);
	assert.equal(peMachine(Buffer.from('\x7fELF not a PE image at all, but long enough to read...........')), null);
	const truncated = peImage(0x8664);
	truncated.writeUInt32LE(0xffff, 0x3c);
	assert.equal(peMachine(truncated), null);
});

test('every image that is not x64 is named, and other files are ignored', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'pe-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	mkdirSync(join(root, 'resources', 'koffi', 'win32_arm64'), { recursive: true });
	writeFileSync(join(root, 'Terminay.exe'), peImage(0x8664));
	writeFileSync(join(root, 'resources', 'koffi', 'win32_arm64', 'koffi.node'), peImage(0xaa64));
	writeFileSync(join(root, 'resources', 'app.asar'), 'not a PE image');
	assert.deepEqual(nonX64Images(root), [
		{ path: join('resources', 'koffi', 'win32_arm64', 'koffi.node'), machine: 'arm64' },
	]);
});

test('only declared images that load into their own architecture are allowed', (t) => {
	const root = mkdtempSync(join(tmpdir(), 'pe-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const koffi = join(root, 'resources', 'built-in-extensions', 'artifacts', 'com.terminay.builtin-agents', 'node_modules', 'koffi', 'build', 'koffi');
	mkdirSync(join(koffi, 'win32_arm64'), { recursive: true });
	mkdirSync(join(koffi, 'win32_ia32'), { recursive: true });
	writeFileSync(join(root, 'resources', 'elevate.exe'), peImage(0x14c));
	writeFileSync(join(koffi, 'win32_arm64', 'koffi.node'), peImage(0xaa64));
	writeFileSync(join(koffi, 'win32_ia32', 'koffi.node'), peImage(0x14c));
	assert.deepEqual(nonX64Images(root), []);

	// The same allowance does not cover another machine or another place.
	writeFileSync(join(koffi, 'win32_arm64', 'koffi.node'), peImage(0x14c));
	mkdirSync(join(root, 'resources', 'app.asar.unpacked', 'node_modules', 'koffi', 'build', 'koffi', 'win32_arm64'), { recursive: true });
	writeFileSync(join(root, 'resources', 'app.asar.unpacked', 'node_modules', 'koffi', 'build', 'koffi', 'win32_arm64', 'koffi.node'), peImage(0xaa64));
	assert.deepEqual(nonX64Images(root).map((image) => image.machine).sort(), ['arm64', 'x86']);
});
