import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { RELEASE_PUBLIC_KEY_PEM, VerificationError, parseChecksumSidecar, releasePublicKey, verifyArchive } from '../dist/verify.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(new URL('../../..', import.meta.url).pathname);

function keyPair() {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	return {
		publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
		publicB64: Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64'),
		privateB64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
	};
}

/**
 * Signs the fixture with the repository's own signing script, so the CLI is
 * verified against what the release pipeline actually produces rather than
 * against a signature this test invented.
 */
async function signedFixture(directory, bytes) {
	const keys = keyPair();
	const archive = join(directory, 'terminay-server-9.9.9-linux-x64.tar.gz');
	await writeFile(archive, bytes);
	const signature = `${archive}.sig`;
	await execFileAsync('node', [join(repositoryRoot, 'scripts/release-signature.mjs'), 'sign', archive, signature], {
		env: {
			...process.env,
			TERMINAY_RELEASE_SIGNING_PRIVATE_KEY_B64: keys.privateB64,
			TERMINAY_RELEASE_SIGNING_PUBLIC_KEY_B64: keys.publicB64,
		},
	});
	const digest = createHash('sha256').update(bytes).digest('hex');
	return {
		archivePath: archive,
		sidecar: `${digest}  terminay-server-9.9.9-linux-x64.tar.gz\n`,
		signature: await readFile(signature),
		publicKeyPem: keys.publicPem,
		digest,
	};
}

async function withDirectory(run) {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-verify-'));
	try {
		await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test('a validly signed archive verifies', async () => {
	await withDirectory(async (directory) => {
		const fixture = await signedFixture(directory, randomBytes(4096));
		const result = await verifyArchive(fixture);
		assert.equal(result.sha256, fixture.digest);
	});
});

test('a wrong hash is refused before the signature is considered', async () => {
	await withDirectory(async (directory) => {
		const fixture = await signedFixture(directory, randomBytes(4096));
		await assert.rejects(
			() => verifyArchive({ ...fixture, sidecar: `${'0'.repeat(64)}  archive\n`, digest: undefined }),
			(error) => error instanceof VerificationError && /does not match its published checksum/u.test(error.message),
		);
	});
});

test('a tampered archive whose sidecar was updated to match still fails the signature', async () => {
	await withDirectory(async (directory) => {
		const fixture = await signedFixture(directory, randomBytes(4096));
		const tampered = randomBytes(4096);
		await writeFile(fixture.archivePath, tampered);
		const digest = createHash('sha256').update(tampered).digest('hex');
		await assert.rejects(
			() => verifyArchive({ ...fixture, sidecar: `${digest}  archive\n`, digest: undefined }),
			(error) => error instanceof VerificationError && /not signed by the Terminay release key/u.test(error.message),
		);
	});
});

test('a signature made by a different key is refused', async () => {
	await withDirectory(async (directory) => {
		const fixture = await signedFixture(directory, randomBytes(4096));
		const other = keyPair();
		await assert.rejects(
			() => verifyArchive({ ...fixture, publicKeyPem: other.publicPem }),
			(error) => error instanceof VerificationError,
		);
	});
});

test('a corrupted signature is refused', async () => {
	await withDirectory(async (directory) => {
		const fixture = await signedFixture(directory, randomBytes(4096));
		const broken = Buffer.from(fixture.signature);
		broken[0] = broken[0] ^ 0xff;
		await assert.rejects(() => verifyArchive({ ...fixture, signature: broken }), (error) => error instanceof VerificationError);
	});
});

test('the embedded release key is a usable Ed25519 public key', () => {
	assert.equal(releasePublicKey().asymmetricKeyType, 'ed25519');
	assert.match(RELEASE_PUBLIC_KEY_PEM, /^-----BEGIN PUBLIC KEY-----\n/u);
});

test('a non-Ed25519 embedded key is rejected rather than used', () => {
	const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
	assert.throws(
		() => releasePublicKey(publicKey.export({ type: 'spki', format: 'pem' }).toString()),
		(error) => error instanceof VerificationError,
	);
});

test('checksum sidecars are parsed and malformed ones refused', () => {
	assert.equal(parseChecksumSidecar(`${'a'.repeat(64)}  file.tar.gz\n`), 'a'.repeat(64));
	assert.throws(() => parseChecksumSidecar('not a checksum'), VerificationError);
	assert.throws(() => parseChecksumSidecar(''), VerificationError);
});

test('no flag or environment variable can skip verification', async () => {
	// Scanned with comments removed: the module documents why there is no
	// bypass, and that prose must not be mistaken for a bypass.
	const source = (await readFile(resolve(repositoryRoot, 'apps/terminay-cli/src/verify.ts'), 'utf8'))
		.replaceAll(/\/\*[\s\S]*?\*\//gu, '')
		.replaceAll(/\/\/.*$/gmu, '');
	assert.doesNotMatch(source, /process\.env/u, 'verification must not consult the environment');
	assert.doesNotMatch(source, /process\.argv/u, 'verification must not consult the command line');
	assert.doesNotMatch(source, /\bskip|\binsecure|allowUnsigned|rejectUnauthorized/iu);
});
