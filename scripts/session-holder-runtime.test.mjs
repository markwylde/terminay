import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	HOLDER_RUNTIME_EXECUTABLE,
	verifyHolderRuntime,
	holderRuntimeRoot,
	prepareHolderRuntime,
	pruneHolderRuntimes,
} from '../electron/sessionHolderRuntime.ts';

// Design decision 4: an installed Windows build runs its holders from a copy,
// so the installation can be replaced while they hold terminals.

function installation(t) {
	const root = mkdtempSync(join(tmpdir(), 'thr-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const install = join(root, 'Programs', 'Terminay');
	const resources = join(install, 'resources');
	const unpacked = join(resources, 'app.asar.unpacked');
	mkdirSync(join(unpacked, 'dist-electron'), { recursive: true });
	mkdirSync(join(unpacked, 'node_modules', 'node-pty', 'build', 'Release'), { recursive: true });
	mkdirSync(join(install, 'locales'), { recursive: true });
	writeFileSync(join(install, 'Terminay.exe'), 'exe');
	writeFileSync(join(install, 'ffmpeg.dll'), 'dll');
	writeFileSync(join(install, 'icudtl.dat'), 'icu');
	writeFileSync(join(install, 'Uninstall Terminay.exe'), 'uninstaller');
	writeFileSync(join(install, 'locales', 'en-US.pak'), 'pak');
	writeFileSync(join(resources, 'app.asar'), 'asar');
	writeFileSync(join(unpacked, 'dist-electron', 'sessionHolderEntry.js'), 'entry');
	writeFileSync(join(unpacked, 'node_modules', 'node-pty', 'build', 'Release', 'conpty.dll'), 'conpty');
	return {
		executablePath: join(install, 'Terminay.exe'),
		resourcesPath: resources,
		dataRoot: join(root, 'data'),
	};
}

test('the holder runtime is the renamed executable, its runtime files, the holder bundle and node-pty', (t) => {
	const host = installation(t);
	const runtime = prepareHolderRuntime({ ...host, buildId: '1.0.0:1' });
	assert.equal(readFileSync(runtime.executablePath, 'utf8'), 'exe');
	assert.ok(runtime.executablePath.endsWith(HOLDER_RUNTIME_EXECUTABLE));
	assert.equal(readFileSync(runtime.entryPath, 'utf8'), 'entry');
	const copy = join(runtime.executablePath, '..');
	assert.deepEqual(readdirSync(copy).sort(), ['.complete', 'app', 'ffmpeg.dll', 'icudtl.dat', 'manifest.json', HOLDER_RUNTIME_EXECUTABLE].sort());
	assert.ok(existsSync(join(copy, 'app', 'node_modules', 'node-pty', 'build', 'Release', 'conpty.dll')));
	assert.equal(runtime.verification.outcome, 'copied');
	// The same build reuses its copy, once the copy has proved itself.
	writeFileSync(join(host.executablePath), 'changed');
	const reused = prepareHolderRuntime({ ...host, buildId: '1.0.0:1' });
	assert.equal(reused.verification.outcome, 'reused');
	assert.equal(readFileSync(reused.executablePath, 'utf8'), 'exe');
});

test("another build's copy is removed once nothing runs from it, and an unfinished copy is never used", (t) => {
	const host = installation(t);
	const old = prepareHolderRuntime({ ...host, buildId: '1.0.0:1' });
	const unfinished = join(holderRuntimeRoot(host.dataRoot), 'abc.tmp');
	mkdirSync(unfinished);
	const current = prepareHolderRuntime({ ...host, buildId: '1.0.1:2' });
	pruneHolderRuntimes(host.dataRoot, '1.0.1:2');
	assert.equal(existsSync(old.executablePath), false);
	assert.equal(existsSync(unfinished), false);
	assert.ok(existsSync(current.executablePath));
	assert.deepEqual(readdirSync(holderRuntimeRoot(host.dataRoot)).length, 1);
});

// ADR-0088: after a power loss a copy's files can keep their sizes and be all
// zeros. Such a copy is set aside and made again, never run.
for (const [name, damage] of [
	['a zero-filled native module', (copy) => writeFileSync(join(copy, 'app', 'node_modules', 'node-pty', 'build', 'Release', 'conpty.dll'), Buffer.alloc(6))],
	['a zero-filled executable', (copy) => writeFileSync(join(copy, HOLDER_RUNTIME_EXECUTABLE), Buffer.alloc(3))],
	['a zero-filled holder bundle', (copy) => writeFileSync(join(copy, 'app', 'dist-electron', 'sessionHolderEntry.js'), Buffer.alloc(5))],
	['a missing file', (copy) => rmSync(join(copy, 'ffmpeg.dll'))],
	['a zero-filled manifest', (copy) => writeFileSync(join(copy, 'manifest.json'), Buffer.alloc(64))],
	['no manifest (a copy from an older build of Terminay)', (copy) => rmSync(join(copy, 'manifest.json'))],
]) {
	test(`a copy with ${name} is set aside and copied again`, (t) => {
		const host = installation(t);
		const first = prepareHolderRuntime({ ...host, buildId: '2.0.0:1' });
		const copy = join(first.executablePath, '..');
		damage(copy);
		assert.equal(verifyHolderRuntime(copy, '2.0.0:1'), false);
		const again = prepareHolderRuntime({ ...host, buildId: '2.0.0:1' });
		assert.equal(again.verification.outcome, 'recopied-corrupt');
		assert.equal(readFileSync(again.executablePath, 'utf8'), 'exe');
		assert.equal(readFileSync(join(copy, 'app', 'node_modules', 'node-pty', 'build', 'Release', 'conpty.dll'), 'utf8'), 'conpty');
		assert.equal(verifyHolderRuntime(copy, '2.0.0:1'), true);
		const root = holderRuntimeRoot(host.dataRoot);
		assert.equal(readdirSync(root).filter((entry) => entry.includes('.corrupt-')).length, 1, 'the damaged copy is kept aside');
		pruneHolderRuntimes(host.dataRoot, '2.0.0:1');
		assert.deepEqual(readdirSync(root).length, 1, 'and pruned once nothing runs from it');
	});
}

test('a copy whose manifest names another build is not trusted', (t) => {
	const host = installation(t);
	const runtime = prepareHolderRuntime({ ...host, buildId: '3.0.0:1' });
	assert.equal(verifyHolderRuntime(join(runtime.executablePath, '..'), '3.0.0:2'), false);
});
