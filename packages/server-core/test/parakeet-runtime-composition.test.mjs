import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
	PARAKEET_AUDIO_FORMAT,
	PARAKEET_MODEL,
	ParakeetRuntime,
	ServerParakeetDictationProvider,
} from '../dist/index.js';

test('server-owned runtime reports bounded unsupported status without spawning', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'terminay-runtime-test-'));
	try {
		let spawned = false;
		const runtime = new ParakeetRuntime({
			rootDirectory: root,
			platform: 'linux',
			arch: 'x64',
			spawnProcess() { spawned = true; throw new Error('must not spawn'); },
		});
		const provider = new ServerParakeetDictationProvider(runtime, path.join(root, 'inputs'));
		assert.deepEqual(await provider.status(), {
			audioFormat: PARAKEET_AUDIO_FORMAT,
			engine: { license: 'Apache-2.0', package: 'parakeet-mlx', version: '0.5.2' },
			message: 'On-device Parakeet requires an Apple Silicon Mac.',
			model: PARAKEET_MODEL,
			modelLicense: 'CC-BY-4.0',
			modelRevision: 'ed2b7e8c15f9aaa0b5772e2efb986255eaef7e15',
			state: 'unsupported',
		});
		assert.equal((await provider.install()).state, 'unsupported');
		assert.equal(spawned, false);
	} finally {
		await rm(root, { force: true, recursive: true });
	}
});
