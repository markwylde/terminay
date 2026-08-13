import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const output = join(
	tmpdir(),
	`terminay-safe-storage-vault-${process.pid}-${Date.now()}.mjs`,
);
await build({
	bundle: true,
	entryPoints: ['electron/vault/safeStorageVault.ts'],
	format: 'esm',
	logLevel: 'silent',
	outfile: output,
	platform: 'node',
	target: 'node20',
});
const { ElectronSafeStorageVaultAdapter, FileSafeStorageVaultRepository } =
	await import(`file://${output}?${Date.now()}`);

function codec(backend = 'keychain') {
	const key = randomBytes(32);
	return {
		backend: () => backend,
		isAvailable: () => true,
		encrypt(value) {
			const nonce = randomBytes(12);
			const cipher = createCipheriv('aes-256-gcm', key, nonce);
			return Buffer.concat([
				nonce,
				cipher.update(value, 'utf8'),
				cipher.final(),
				cipher.getAuthTag(),
			]);
		},
		decrypt(value) {
			const nonce = value.subarray(0, 12);
			const tag = value.subarray(value.length - 16);
			const decipher = createDecipheriv('aes-256-gcm', key, nonce);
			decipher.setAuthTag(tag);
			return Buffer.concat([
				decipher.update(value.subarray(12, -16)),
				decipher.final(),
			]).toString('utf8');
		},
	};
}

class MemoryRepository {
	value;
	async load() {
		return this.value;
	}
	async commit(value) {
		this.value = structuredClone(value);
	}
}

test('embedded vault persists ciphertext only and clears callback bytes', async () => {
	const repository = new MemoryRepository();
	const adapter = await ElectronSafeStorageVaultAdapter.open({
		repository,
		codec: codec(),
	});
	assert.equal(adapter.status(), 'locked');
	await adapter.unlock({ secret: new Uint8Array() });
	const plaintext = new TextEncoder().encode('private-key-sentinel');
	await adapter.put({
		id: 'extensions.ssh.key',
		label: 'SSH key',
		value: plaintext,
	});
	assert.doesNotMatch(JSON.stringify(repository.value), /private-key-sentinel/);
	let observed;
	assert.equal(
		await adapter.withSecret('extensions.ssh.key', (bytes) => {
			observed = bytes;
			return new TextDecoder().decode(bytes);
		}),
		'private-key-sentinel',
	);
	assert.ok(observed.every((byte) => byte === 0));
	adapter.lock();
	await assert.rejects(
		adapter.withSecret('extensions.ssh.key', () => undefined),
		/locked/,
	);
});

test('basic_text is unavailable and never encrypts', async () => {
	let encryptions = 0;
	const unsafe = codec('basic_text');
	const adapter = await ElectronSafeStorageVaultAdapter.open({
		repository: new MemoryRepository(),
		codec: {
			...unsafe,
			encrypt(value) {
				encryptions += 1;
				return unsafe.encrypt(value);
			},
		},
	});
	assert.equal(adapter.status(), 'unavailable');
	await assert.rejects(
		adapter.unlock({ secret: new Uint8Array() }),
		/OS-backed/,
	);
	assert.equal(encryptions, 0);
});

test('file repository atomically writes an owner-only encrypted record', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-vault-'));
	const file = join(directory, 'vault', 'safe-storage.v1.json');
	const adapter = await ElectronSafeStorageVaultAdapter.open({
		repository: new FileSafeStorageVaultRepository(file),
		codec: codec(),
	});
	await adapter.unlock({ secret: new Uint8Array() });
	await adapter.put({
		id: 'puzed.api-key',
		value: new TextEncoder().encode('api-key-sentinel'),
	});
	const serialized = await readFile(file, 'utf8');
	assert.doesNotMatch(serialized, /api-key-sentinel/);
	if (process.platform !== 'win32')
		assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('failed commits do not publish in-memory mutations', async () => {
	const repository = new MemoryRepository();
	const adapter = await ElectronSafeStorageVaultAdapter.open({
		repository,
		codec: codec(),
	});
	await adapter.unlock({ secret: new Uint8Array() });
	repository.commit = async () => {
		throw new Error('disk unavailable');
	};
	await assert.rejects(
		adapter.put({ id: 'test.secret', value: new Uint8Array([1, 2, 3]) }),
		/disk unavailable/,
	);
	assert.deepEqual(adapter.list(), []);
});
