import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	HOLDER_RUNTIME_EXECUTABLE,
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
	assert.deepEqual(readdirSync(copy).sort(), ['.complete', 'app', 'ffmpeg.dll', 'icudtl.dat', HOLDER_RUNTIME_EXECUTABLE].sort());
	assert.ok(existsSync(join(copy, 'app', 'node_modules', 'node-pty', 'build', 'Release', 'conpty.dll')));
	// The same build reuses its copy.
	writeFileSync(join(host.executablePath), 'changed');
	assert.equal(readFileSync(prepareHolderRuntime({ ...host, buildId: '1.0.0:1' }).executablePath, 'utf8'), 'exe');
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
