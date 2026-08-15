import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('standalone settings migration preserves the raw source and safely retries after an existing backup', async () => {
	const root = await mkdtemp(join(tmpdir(), 'terminay-settings-migration-'));
	const dataRoot = join(root, 'data');
	const settingsPath = join(dataRoot, 'settings.v1.json');
	const backupPath = `${settingsPath}.pre-migration.json`;
	const legacy = {
		shell: { program: '/bin/sh', startupMode: 'non-login', extraArgs: '-i' },
	};
	const priorBackup = { retained: 'earlier exact source' };
	let child;
	try {
		await mkdir(dataRoot, { recursive: true });
		await writeFile(settingsPath, JSON.stringify(legacy));
		// Models a crash after the recoverable backup was written but before the
		// canonical replacement committed. Retry must not overwrite that backup.
		await writeFile(backupPath, JSON.stringify(priorBackup));
		child = spawn(
			process.execPath,
			[
				'dist/cli.js',
				'--server-id',
				'settings-migration',
				'--data-root',
				dataRoot,
				'--project-root',
				root,
				'--endpoint',
				'disabled',
				'--agent-integration',
				'disabled',
				'--vault-unlock-fd',
				'3',
			],
			{
				cwd: new URL('../', import.meta.url),
				env: { ...process.env, HOME: root, TERMINAY_REMOTE_PAIRING_PIN: '736941', TERMINAY_SERVER_VERSION: 'test' },
				stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
			},
		);
		child.stdio[3].end('test-vault-passphrase\n');
		const ready = await readiness(child);
		assert.equal(ready.ready, true);
		assert.deepEqual(
			JSON.parse(await readFile(backupPath, 'utf8')),
			priorBackup,
		);
		const migrated = JSON.parse(await readFile(settingsPath, 'utf8'));
		assert.equal(migrated.schemaVersion, 2);
		assert.equal(
			migrated.settings.shellProfiles.defaultProfileId,
			'migrated-shell',
		);
		assert.deepEqual(migrated.settings.shellProfiles.profiles[0].args, ['-i']);
	} finally {
		if (child?.exitCode === null) {
			child.kill('SIGTERM');
			await once(child, 'exit');
		}
		await rm(root, { recursive: true, force: true });
	}
});

async function readiness(child) {
	let stdout = '';
	let stderr = '';
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error(`CLI readiness timed out: ${stderr}`)),
			5_000,
		);
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
			const newline = stdout.indexOf('\n');
			if (newline < 0) return;
			clearTimeout(timeout);
			try {
				resolve(JSON.parse(stdout.slice(0, newline)));
			} catch (error) {
				reject(error);
			}
		});
		child.once('error', reject);
		child.once('exit', (code, signal) =>
			reject(
				new Error(`CLI exited before readiness (${code ?? signal}): ${stderr}`),
			),
		);
	});
}
