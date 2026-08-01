import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import {
	access,
	chmod,
	mkdir,
	mkdtemp,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ensureNodePtyHelperMode } from './ensure-node-pty-helper-mode.mjs';

test('clean install makes only regular node-pty spawn helpers executable', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-node-pty-mode-'));
	try {
		const prebuilt = join(root, 'prebuilds', 'darwin-arm64', 'spawn-helper');
		const built = join(root, 'build', 'Release', 'spawn-helper');
		await Promise.all([
			mkdir(join(root, 'prebuilds', 'darwin-arm64'), { recursive: true }),
			mkdir(join(root, 'build', 'Release'), { recursive: true }),
		]);
		await Promise.all([
			writeFile(prebuilt, 'prebuilt', { mode: 0o644 }),
			writeFile(built, 'built', { mode: 0o600 }),
		]);
		await chmod(prebuilt, 0o644);
		await chmod(built, 0o600);

		assert.equal(await ensureNodePtyHelperMode(root), 2);
		await Promise.all([
			access(prebuilt, constants.X_OK),
			access(built, constants.X_OK),
		]);
		assert.equal((await stat(prebuilt)).mode & 0o777, 0o755);
		assert.equal((await stat(built)).mode & 0o777, 0o711);
		assert.equal(await ensureNodePtyHelperMode(root), 2);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});
