import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = resolve('scripts/prepare-release-credentials.mjs');

test('explicit release-key rotation writes a matching protected Ed25519 keypair without printing values', async () => {
	const parent = await mkdtemp(
		join(tmpdir(), 'terminay-release-credentials-test-'),
	);
	const output = join(parent, 'credentials');
	try {
		const { stdout } = await execFileAsync(process.execPath, [
			script,
			'release-key',
			'--output-dir',
			output,
			'--rotate-release-key',
		]);
		assert.match(stdout, /Credential values were not printed/u);

		const directoryInfo = await lstat(output);
		assert.equal(directoryInfo.mode & 0o777, 0o700);

		const privatePath = join(
			output,
			'TERMINAY_RELEASE_SIGNING_PRIVATE_KEY_B64',
		);
		const publicPath = join(output, 'TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64');
		assert.equal((await lstat(privatePath)).mode & 0o777, 0o600);
		assert.equal((await lstat(publicPath)).mode & 0o777, 0o600);

		const privateValue = (await readFile(privatePath, 'utf8')).trim();
		const publicValue = (await readFile(publicPath, 'utf8')).trim();
		assert.doesNotMatch(stdout, new RegExp(privateValue.slice(0, 24), 'u'));
		assert.doesNotMatch(stdout, new RegExp(publicValue.slice(0, 24), 'u'));

		const privateKey = createPrivateKey(Buffer.from(privateValue, 'base64'));
		const publicKey = createPublicKey(Buffer.from(publicValue, 'base64'));
		assert.equal(privateKey.asymmetricKeyType, 'ed25519');
		assert.equal(publicKey.asymmetricKeyType, 'ed25519');
		assert.deepEqual(
			createPublicKey(privateKey).export({ type: 'spki', format: 'der' }),
			publicKey.export({ type: 'spki', format: 'der' }),
		);
	} finally {
		await rm(parent, { recursive: true, force: true });
	}
});

test('refuses to overwrite an existing credential directory', async () => {
	const output = await mkdtemp(
		join(tmpdir(), 'terminay-release-credentials-existing-'),
	);
	try {
		await assert.rejects(
			execFileAsync(process.execPath, [
				script,
				'release-key',
				'--output-dir',
				output,
				'--rotate-release-key',
			]),
			/EEXIST/u,
		);
	} finally {
		await rm(output, { recursive: true, force: true });
	}
});

test('refuses to write credentials inside the repository', async () => {
	const output = resolve('release-credential-output-must-not-exist');
	await assert.rejects(
		execFileAsync(process.execPath, [
			script,
			'release-key',
			'--output-dir',
			output,
			'--rotate-release-key',
		]),
		/output directory must be outside the repository/u,
	);
});
