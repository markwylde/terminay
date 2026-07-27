import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import electronPath from 'electron';
import {
	CIPHER,
	ElectronSafeStorageKeyProtector,
	EMBEDDED_PROTECTOR,
	ENTRY_VERSION,
	MAX_ENVELOPE_BYTES,
	MAX_PASSPHRASE_BYTES,
	MAX_SECRET_BYTES,
	MAX_VAULT_ENTRIES,
	PASSPHRASE_PROTECTOR,
	PassphraseKeyProtector,
	ReferenceVault,
	readHeadlessPassphrase,
	recoverReferenceVault,
	SCRYPT_PARAMETERS,
	VAULT_FORMAT,
	VAULT_VERSION,
	VaultFormatError,
	VaultLockedError,
	VaultUnlockError,
	vaultAadContract,
} from './vault-reference.mjs';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const inputFixture = join(
	scriptsDirectory,
	'vault-reference-input-fixture.mjs',
);
const electronFixture = join(
	scriptsDirectory,
	'vault-reference-electron-fixture.cjs',
);
const persistenceFixture = join(
	scriptsDirectory,
	'vault-reference-persistence-fixture.mjs',
);

function passphrase(value = 'correct horse battery staple') {
	return Buffer.from(value);
}

function parseEnvelope(vault) {
	return JSON.parse(vault.serialize());
}

function flipBase64Url(value) {
	const bytes = Buffer.from(value, 'base64url');
	bytes[0] ^= 0x01;
	const changed = bytes.toString('base64url');
	bytes.fill(0);
	return changed;
}

async function createPassphraseVault(
	secret = Buffer.from('vault-plaintext-sentinel'),
) {
	const material = passphrase();
	const protector = new PassphraseKeyProtector();
	try {
		const vault = await ReferenceVault.create(
			'server-reference',
			protector,
			material,
		);
		vault.put('secret-one', 'Secret one', secret);
		return { vault, protector };
	} finally {
		material.fill(0);
	}
}

function runChild(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const { onSpawn, timeoutMs = 10_000, ...spawnOptions } = options;
		const child = spawn(command, args, spawnOptions);
		let stdout = '';
		let stderr = '';
		const timeout = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error(`Child process exceeded ${timeoutMs}ms.`));
		}, timeoutMs);
		child.stdout?.on('data', (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr?.on('data', (chunk) => {
			stderr += chunk.toString();
		});
		child.on('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on('exit', (code, signal) => {
			clearTimeout(timeout);
			resolve({ child, code, signal, stdout, stderr });
		});
		onSpawn?.(child);
	});
}

test('versioned envelope fixes cipher, KDF, AAD, salt, nonce, and resource metadata', async () => {
	const { vault } = await createPassphraseVault();
	const envelope = parseEnvelope(vault);

	assert.deepEqual(Object.keys(envelope).sort(), [
		'entries',
		'format',
		'keyEnvelope',
		'manifest',
		'revision',
		'serverId',
		'version',
	]);
	assert.equal(envelope.format, VAULT_FORMAT);
	assert.equal(envelope.version, VAULT_VERSION);
	assert.equal(envelope.revision, 1);
	assert.deepEqual(
		{
			version: envelope.manifest.version,
			cipher: envelope.manifest.cipher,
			ciphertext: envelope.manifest.ciphertext,
			nonceBytes: Buffer.from(envelope.manifest.nonce, 'base64url').length,
			tagBytes: Buffer.from(envelope.manifest.tag, 'base64url').length,
		},
		{
			version: VAULT_VERSION,
			cipher: CIPHER,
			ciphertext: '',
			nonceBytes: 12,
			tagBytes: 16,
		},
	);
	assert.deepEqual(envelope.keyEnvelope.kdf, SCRYPT_PARAMETERS);
	assert.equal(envelope.keyEnvelope.protector, PASSPHRASE_PROTECTOR);
	assert.equal(envelope.keyEnvelope.version, VAULT_VERSION);
	assert.equal(envelope.keyEnvelope.cipher, CIPHER);
	assert.equal(Buffer.from(envelope.keyEnvelope.salt, 'base64url').length, 16);
	assert.equal(Buffer.from(envelope.keyEnvelope.nonce, 'base64url').length, 12);
	assert.equal(Buffer.from(envelope.keyEnvelope.tag, 'base64url').length, 16);
	assert.equal(
		Buffer.from(envelope.keyEnvelope.ciphertext, 'base64url').length,
		32,
	);
	assert.deepEqual(vaultAadContract('server-reference', 'secret-one'), {
		entry: '["terminay-vault-entry",1,"server-reference","secret-one"]',
		wrappedKey: '["terminay-vault-data-key",1,"server-reference"]',
	});

	const entry = envelope.entries[0];
	assert.deepEqual(Object.keys(entry).sort(), [
		'cipher',
		'ciphertext',
		'id',
		'name',
		'nonce',
		'tag',
		'version',
	]);
	assert.equal(entry.version, ENTRY_VERSION);
	assert.equal(entry.cipher, CIPHER);
	assert.equal(Buffer.from(entry.nonce, 'base64url').length, 12);
	assert.equal(Buffer.from(entry.tag, 'base64url').length, 16);
	assert.equal(vault.serialize().includes('vault-plaintext-sentinel'), false);
	vault.lock();
});

test('vault lifecycle exposes metadata while locked and plaintext only inside withSecret', async () => {
	const original = Buffer.from('vault-plaintext-sentinel');
	const { vault } = await createPassphraseVault(original);
	original.fill(0);

	assert.deepEqual(vault.status(), {
		initialized: true,
		locked: false,
		protector: PASSPHRASE_PROTECTOR,
		entryCount: 1,
	});
	assert.deepEqual(vault.list(), [{ id: 'secret-one', name: 'Secret one' }]);

	let callbackBuffer;
	const callbackResult = await vault.withSecret(
		'secret-one',
		async (secret) => {
			callbackBuffer = secret;
			assert.equal(secret.toString(), 'vault-plaintext-sentinel');
			await Promise.resolve();
			return 'used';
		},
	);
	assert.equal(callbackResult, 'used');
	assert.equal(
		callbackBuffer.every((byte) => byte === 0),
		true,
	);

	vault.lock();
	assert.equal(vault.status().locked, true);
	assert.deepEqual(vault.list(), [{ id: 'secret-one', name: 'Secret one' }]);
	assert.throws(
		() => vault.put('locked', 'Locked', Buffer.from('not persisted')),
		VaultLockedError,
	);
	await assert.rejects(
		() => vault.withSecret('secret-one', () => undefined),
		VaultLockedError,
	);

	const unlock = passphrase();
	await vault.unlock(unlock);
	unlock.fill(0);
	vault.replace('secret-one', 'Renamed', Buffer.from('replacement secret'));
	vault.put('secret-two', 'Secret two', Buffer.from('second secret'));
	assert.throws(
		() => vault.put('secret-two', 'Duplicate', Buffer.from('duplicate')),
		/already exists/,
	);
	assert.equal(vault.delete('missing'), false);
	assert.equal(vault.delete('secret-two'), true);
	assert.deepEqual(vault.list(), [{ id: 'secret-one', name: 'Renamed' }]);
	await vault.withSecret('secret-one', (secret) => {
		assert.equal(secret.toString(), 'replacement secret');
	});
	vault.lock();
});

test('wrong passphrases, tampering, corrupt metadata, and KDF resource inflation fail closed', async () => {
	const { vault, protector } = await createPassphraseVault();
	vault.put('secret-two', 'Secret two', Buffer.from('second secret'));
	const serialized = vault.serialize();
	vault.lock();

	const wrong = passphrase('this passphrase is definitely wrong');
	await assert.rejects(() => vault.unlock(wrong), VaultUnlockError);
	wrong.fill(0);
	assert.equal(vault.status().locked, true);

	for (const mutate of [
		(envelope) => {
			envelope.entries[0].tag = flipBase64Url(envelope.entries[0].tag);
		},
		(envelope) => {
			envelope.entries[0].id = 'different-aad-id';
		},
		(envelope) => {
			envelope.entries[0].name = 'Attacker rename';
		},
		(envelope) => {
			envelope.entries.splice(0, 1);
		},
		(envelope) => {
			envelope.entries.reverse();
		},
	]) {
		const envelope = JSON.parse(serialized);
		mutate(envelope);
		const candidate = new ReferenceVault(envelope, protector);
		const unlock = passphrase();
		await assert.rejects(() => candidate.unlock(unlock), VaultUnlockError);
		unlock.fill(0);
		assert.equal(candidate.status().locked, true);
		candidate.lock();
	}

	const wrappedKeyTamper = JSON.parse(serialized);
	wrappedKeyTamper.keyEnvelope.ciphertext = flipBase64Url(
		wrappedKeyTamper.keyEnvelope.ciphertext,
	);
	const wrappedCandidate = new ReferenceVault(wrappedKeyTamper, protector);
	const wrappedUnlock = passphrase();
	await assert.rejects(
		() => wrappedCandidate.unlock(wrappedUnlock),
		VaultUnlockError,
	);
	wrappedUnlock.fill(0);

	const serverTamper = JSON.parse(serialized);
	serverTamper.serverId = 'different-server';
	const serverCandidate = new ReferenceVault(serverTamper, protector);
	const serverUnlock = passphrase();
	await assert.rejects(
		() => serverCandidate.unlock(serverUnlock),
		VaultUnlockError,
	);
	serverUnlock.fill(0);

	const expensive = JSON.parse(serialized);
	expensive.keyEnvelope.kdf.N = 2 ** 25;
	assert.throws(
		() => new ReferenceVault(expensive, protector),
		VaultFormatError,
	);

	const unknownField = JSON.parse(serialized);
	unknownField.keyEnvelope.kdf.parallelism = 1000;
	assert.throws(
		() => new ReferenceVault(unknownField, protector),
		VaultFormatError,
	);

	const corruptNonce = JSON.parse(serialized);
	corruptNonce.entries[0].nonce = 'not+base64';
	assert.throws(
		() => new ReferenceVault(corruptNonce, protector),
		VaultFormatError,
	);
	assert.throws(() => JSON.parse('{corrupt'), SyntaxError);
});

test('snapshot reload and passphrase rotation preserve committed values', async () => {
	const { vault, protector } = await createPassphraseVault(
		Buffer.from('committed value'),
	);
	const committedSnapshot = vault.serialize();

	vault.replace(
		'secret-one',
		'Secret one',
		Buffer.from('uncommitted candidate'),
	);
	vault.lock();

	const recovered = new ReferenceVault(
		JSON.parse(committedSnapshot),
		protector,
	);
	const initialPassphrase = passphrase();
	await recovered.unlock(initialPassphrase);
	initialPassphrase.fill(0);
	await recovered.withSecret('secret-one', (secret) => {
		assert.equal(secret.toString(), 'committed value');
	});

	const nextPassphrase = passphrase('a different strong rotation passphrase');
	await recovered.rewrap(protector, nextPassphrase);
	nextPassphrase.fill(0);
	const rotatedSnapshot = recovered.serialize();
	recovered.lock();

	const oldPassphrase = passphrase();
	await assert.rejects(() => recovered.unlock(oldPassphrase), VaultUnlockError);
	oldPassphrase.fill(0);

	const rotatedPassphrase = passphrase(
		'a different strong rotation passphrase',
	);
	await recovered.unlock(rotatedPassphrase);
	rotatedPassphrase.fill(0);
	await recovered.withSecret('secret-one', (secret) => {
		assert.equal(secret.toString(), 'committed value');
	});
	recovered.lock();

	const oldSnapshot = new ReferenceVault(
		JSON.parse(committedSnapshot),
		protector,
	);
	const oldSnapshotPassphrase = passphrase();
	await oldSnapshot.unlock(oldSnapshotPassphrase);
	oldSnapshotPassphrase.fill(0);
	oldSnapshot.lock();

	const rotatedRestart = new ReferenceVault(
		JSON.parse(rotatedSnapshot),
		protector,
	);
	const rotatedRestartPassphrase = passphrase(
		'a different strong rotation passphrase',
	);
	await rotatedRestart.unlock(rotatedRestartPassphrase);
	rotatedRestartPassphrase.fill(0);
	rotatedRestart.lock();
});

test('atomic snapshot installation recovers at every process-failure boundary', async (t) => {
	for (const boundary of [
		'temporary-synced',
		'previous-rotated',
		'current-installed',
	]) {
		await t.test(boundary, async () => {
			const recoveryPath = await mkdtemp(
				join(tmpdir(), `terminay-vault-${boundary}-`),
			);
			try {
				const { vault, protector } = await createPassphraseVault(
					Buffer.from('last committed value'),
				);
				const previousSnapshot = vault.serialize();
				vault.replace(
					'secret-one',
					'Secret one',
					Buffer.from('new committed value'),
				);
				const currentSnapshot = vault.serialize();
				vault.lock();

				const currentPath = join(recoveryPath, 'vault.current');
				const previousPath = join(recoveryPath, 'vault.previous');
				const candidatePath = join(recoveryPath, 'vault.candidate');
				await writeFile(currentPath, previousSnapshot, { mode: 0o600 });
				await writeFile(candidatePath, currentSnapshot, { mode: 0o600 });

				const failed = await runChild(
					process.execPath,
					[persistenceFixture, recoveryPath, candidatePath, boundary],
					{ stdio: ['ignore', 'pipe', 'pipe'] },
				);
				assert.equal(failed.code, null);
				assert.equal(failed.signal, 'SIGKILL');

				const snapshots = [];
				for (const path of [currentPath, previousPath]) {
					try {
						await access(path);
						snapshots.push(await readFile(path, 'utf8'));
					} catch (error) {
						if (error?.code !== 'ENOENT') {
							throw error;
						}
					}
				}
				const unlock = passphrase();
				const recovered = await recoverReferenceVault(
					snapshots,
					protector,
					unlock,
				);
				unlock.fill(0);
				const expectedAfterFailure =
					boundary === 'current-installed'
						? 'new committed value'
						: 'last committed value';
				await recovered.vault.withSecret('secret-one', (secret) => {
					assert.equal(secret.toString(), expectedAfterFailure);
				});
				recovered.vault.lock();

				const resumed = await runChild(
					process.execPath,
					[persistenceFixture, recoveryPath, candidatePath],
					{ stdio: ['ignore', 'pipe', 'pipe'] },
				);
				assert.equal(resumed.code, 0, resumed.stderr);
				const finalUnlock = passphrase();
				const final = await recoverReferenceVault(
					[
						await readFile(currentPath, 'utf8'),
						await readFile(previousPath, 'utf8'),
					],
					protector,
					finalUnlock,
				);
				finalUnlock.fill(0);
				await final.vault.withSecret('secret-one', (secret) => {
					assert.equal(secret.toString(), 'new committed value');
				});
				final.vault.lock();

				const corruptCurrent = JSON.parse(await readFile(currentPath, 'utf8'));
				corruptCurrent.manifest.tag = flipBase64Url(
					corruptCurrent.manifest.tag,
				);
				await writeFile(currentPath, JSON.stringify(corruptCurrent), {
					mode: 0o600,
				});
				const fallbackUnlock = passphrase();
				const fallback = await recoverReferenceVault(
					[
						await readFile(currentPath, 'utf8'),
						await readFile(previousPath, 'utf8'),
					],
					protector,
					fallbackUnlock,
				);
				fallbackUnlock.fill(0);
				assert.equal(fallback.snapshotIndex, 1);
				fallback.vault.lock();

				for (const path of [currentPath, previousPath, candidatePath]) {
					const persisted = await readFile(path, 'utf8');
					assert.equal(persisted.includes('last committed value'), false);
					assert.equal(persisted.includes('new committed value'), false);
				}
			} finally {
				await rm(recoveryPath, { force: true, recursive: true });
			}
		});
	}
});

test('envelope, ciphertext, entry count, and secret inputs are bounded', async () => {
	const { vault, protector } = await createPassphraseVault();
	assert.throws(
		() =>
			vault.put('oversized', 'Oversized', Buffer.alloc(MAX_SECRET_BYTES + 1)),
		/exceed/,
	);
	assert.throws(
		() =>
			ReferenceVault.fromSerialized(
				'x'.repeat(MAX_ENVELOPE_BYTES + 1),
				protector,
			),
		VaultFormatError,
	);

	const duplicateNonce = parseEnvelope(vault);
	duplicateNonce.entries.push({
		...duplicateNonce.entries[0],
		id: 'duplicate-nonce',
	});
	assert.throws(
		() => new ReferenceVault(duplicateNonce, protector),
		/nonces must be unique/,
	);

	const tooManyEntries = parseEnvelope(vault);
	tooManyEntries.entries = Array.from(
		{ length: MAX_VAULT_ENTRIES + 1 },
		() => tooManyEntries.entries[0],
	);
	assert.throws(
		() => new ReferenceVault(tooManyEntries, protector),
		/entry count exceeds/,
	);

	const oversizedCiphertext = parseEnvelope(vault);
	oversizedCiphertext.entries[0].ciphertext = 'A'.repeat(
		Math.ceil((MAX_SECRET_BYTES * 4) / 3) + 5,
	);
	assert.throws(
		() => new ReferenceVault(oversizedCiphertext, protector),
		/ciphertext exceeds/,
	);
	vault.lock();
});

test('same-key entry nonces stay unique across writes, replacement, and rewrap', async () => {
	const { vault, protector } = await createPassphraseVault();
	for (let index = 2; index <= 32; index += 1) {
		vault.put(
			`secret-${index}`,
			`Secret ${index}`,
			Buffer.from(`secret value ${index}`),
		);
	}
	const beforeReplace = parseEnvelope(vault);
	const beforeNonces = beforeReplace.entries.map((entry) => entry.nonce);
	assert.equal(new Set(beforeNonces).size, beforeNonces.length);

	vault.replace(
		'secret-one',
		'Secret one',
		Buffer.from('replacement under same data key'),
	);
	const afterReplace = parseEnvelope(vault);
	const afterNonces = afterReplace.entries.map((entry) => entry.nonce);
	assert.equal(new Set(afterNonces).size, afterNonces.length);
	assert.notEqual(afterNonces[0], beforeNonces[0]);

	const rotated = passphrase('nonce-preserving rewrap passphrase');
	await vault.rewrap(protector, rotated);
	rotated.fill(0);
	const afterRewrap = parseEnvelope(vault);
	assert.deepEqual(
		afterRewrap.entries.map((entry) => entry.nonce),
		afterNonces,
	);
	assert.equal(
		new Set(afterRewrap.entries.map((entry) => entry.nonce)).size,
		afterRewrap.entries.length,
	);
	vault.lock();
});

test('embedded protector wraps with safeStorage and rejects Linux basic_text', async () => {
	const fakeSafeStorage = {
		isEncryptionAvailable: () => true,
		encryptString: (value) => Buffer.from(value, 'utf8'),
		decryptString: (value) => value.toString('utf8'),
		getSelectedStorageBackend: () => 'kwallet6',
	};
	const protector = new ElectronSafeStorageKeyProtector(
		fakeSafeStorage,
		'linux',
	);
	const key = Buffer.alloc(32, 0x42);
	const envelope = await protector.wrap(key);
	assert.deepEqual(
		{
			protector: envelope.protector,
			version: envelope.version,
			backend: envelope.backend,
		},
		{
			protector: EMBEDDED_PROTECTOR,
			version: VAULT_VERSION,
			backend: 'kwallet6',
		},
	);
	const restored = await protector.unwrap(envelope);
	assert.equal(restored.equals(key), true);
	key.fill(0);
	restored.fill(0);

	await assert.rejects(
		() => protector.unwrap({ ...envelope, backend: 'gnome_libsecret' }),
		VaultUnlockError,
	);
	assert.throws(
		() =>
			new ElectronSafeStorageKeyProtector(
				{ ...fakeSafeStorage, getSelectedStorageBackend: () => 'basic_text' },
				'linux',
			),
		/not a secure key protector/,
	);
});

test('rewrap moves the same data key between headless and embedded protectors', async () => {
	const headless = new PassphraseKeyProtector();
	const initialPassphrase = passphrase();
	const vault = await ReferenceVault.create(
		'cross-protector',
		headless,
		initialPassphrase,
	);
	initialPassphrase.fill(0);
	vault.put(
		'cross-secret',
		'Cross secret',
		Buffer.from('cross-protector value'),
	);

	const fakeSafeStorage = {
		isEncryptionAvailable: () => true,
		encryptString: (value) => Buffer.from(value, 'utf8'),
		decryptString: (value) => value.toString('utf8'),
	};
	const embedded = new ElectronSafeStorageKeyProtector(
		fakeSafeStorage,
		'darwin',
	);
	await vault.rewrap(embedded);
	const embeddedSnapshot = vault.serialize();
	vault.lock();

	const embeddedRestart = new ReferenceVault(
		JSON.parse(embeddedSnapshot),
		embedded,
	);
	await embeddedRestart.unlock();
	await embeddedRestart.withSecret('cross-secret', (secret) => {
		assert.equal(secret.toString(), 'cross-protector value');
	});

	const rotatedPassphrase = passphrase('headless protector restored securely');
	await embeddedRestart.rewrap(headless, rotatedPassphrase);
	rotatedPassphrase.fill(0);
	const headlessSnapshot = embeddedRestart.serialize();
	embeddedRestart.lock();

	const headlessRestart = new ReferenceVault(
		JSON.parse(headlessSnapshot),
		headless,
	);
	const restartPassphrase = passphrase('headless protector restored securely');
	await headlessRestart.unlock(restartPassphrase);
	restartPassphrase.fill(0);
	await headlessRestart.withSecret('cross-secret', (secret) => {
		assert.equal(secret.toString(), 'cross-protector value');
	});
	headlessRestart.lock();
});

test('failed unlock and tamper paths expose neither secret nor passphrase text', async () => {
	const secret = 'failure-path-plaintext-sentinel';
	const { vault, protector } = await createPassphraseVault(Buffer.from(secret));
	const envelope = parseEnvelope(vault);
	vault.lock();

	const wrongText = 'failure-path-wrong-passphrase';
	const wrong = passphrase(wrongText);
	let wrongError;
	try {
		await vault.unlock(wrong);
	} catch (error) {
		wrongError = error;
	} finally {
		wrong.fill(0);
	}
	assert.equal(wrongError instanceof VaultUnlockError, true);
	assert.equal(wrongError.message.includes(secret), false);
	assert.equal(wrongError.message.includes(wrongText), false);

	envelope.keyEnvelope.tag = flipBase64Url(envelope.keyEnvelope.tag);
	const tampered = new ReferenceVault(envelope, protector);
	const correct = passphrase();
	let tamperError;
	try {
		await tampered.unlock(correct);
	} catch (error) {
		tamperError = error;
	} finally {
		correct.fill(0);
	}
	assert.equal(tamperError instanceof VaultUnlockError, true);
	assert.equal(tamperError.message.includes(secret), false);
	assert.equal(tampered.serialize().includes(secret), false);
	assert.equal(tampered.serialize().includes(wrongText), false);
});

test('real Electron safeStorage executes the embedded protector contract', async (t) => {
	const profilePath = await mkdtemp(join(tmpdir(), 'terminay-vault-embedded-'));
	try {
		const result = await runChild(
			electronPath,
			[electronFixture, profilePath],
			{
				env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);
		assert.equal(result.code, 0, result.stderr);
		const output = JSON.parse(result.stdout.trim().split('\n').at(-1));
		if (!output.available) {
			t.skip('Electron safeStorage is unavailable on this host.');
			return;
		}
		if (output.backend === 'basic_text') {
			assert.equal(output.secure, false);
			return;
		}
		assert.deepEqual(
			{
				secure: output.secure,
				protector: output.protector,
				version: output.version,
				matches: output.matches,
			},
			{
				secure: true,
				protector: EMBEDDED_PROTECTOR,
				version: VAULT_VERSION,
				matches: true,
			},
		);
	} finally {
		await rm(profilePath, { force: true, recursive: true });
	}
});

test('headless input accepts only TTY or inherited one-shot FD and zeroizes owned input', () => {
	for (const source of [
		{ kind: 'argv', value: 'secret' },
		{ kind: 'environment', name: 'TERMINAY_KEY' },
		{ kind: 'file', path: './vault.key' },
		{ kind: 'inherited-fd', fd: 2 },
		{ kind: 'tty', path: '/tmp/fake-tty' },
	]) {
		assert.throws(
			() => readHeadlessPassphrase(source),
			/Only interactive|at least 3|unexpected or missing/,
		);
	}

	let shortCollected;
	let shortOwned;
	assert.throws(
		() =>
			readHeadlessPassphrase(
				{ kind: 'inherited-fd', fd: 7 },
				{
					read(_fd, target) {
						shortCollected = target;
						Buffer.from('short\n').copy(target);
						return 6;
					},
					copy(value) {
						shortOwned = Buffer.from(value);
						return shortOwned;
					},
					close() {},
				},
			),
		/must contain/,
	);
	assert.equal(
		shortCollected.every((byte) => byte === 0),
		true,
	);
	assert.equal(
		shortOwned.every((byte) => byte === 0),
		true,
	);

	const events = [];
	const sourceBytes = Buffer.from('interactive passphrase\n');
	const result = readHeadlessPassphrase(
		{ kind: 'tty' },
		{
			open(path, flags) {
				events.push(['open', path, flags]);
				return 41;
			},
			setEcho(fd, enabled) {
				events.push(['echo', fd, enabled]);
			},
			read(_fd, target) {
				sourceBytes.copy(target);
				return sourceBytes.length;
			},
			close(fd) {
				events.push(['close', fd]);
			},
		},
	);
	assert.equal(result.toString(), 'interactive passphrase');
	result.fill(0);
	assert.equal(
		result.every((byte) => byte === 0),
		true,
	);
	assert.deepEqual(events, [
		['open', '/dev/tty', 'r+'],
		['echo', 41, false],
		['echo', 41, true],
		['close', 41],
	]);
});

test('real pseudo-terminal reads /dev/tty with passphrase echo disabled', async (t) => {
	if (process.platform === 'win32') {
		t.skip('/dev/tty is a Unix headless unlock mechanism.');
		return;
	}
	const { spawn: spawnPty } = await import('node-pty');
	const ttyPassphrase = 'pseudo terminal passphrase';
	const output = await new Promise((resolve, reject) => {
		const terminal = spawnPty(process.execPath, [inputFixture, 'tty'], {
			cols: 80,
			rows: 24,
			cwd: scriptsDirectory,
			env: { PATH: process.env.PATH ?? '' },
		});
		let content = '';
		let inputSent = false;
		const timeout = setTimeout(() => {
			terminal.kill('SIGKILL');
			reject(new Error('Pseudo-terminal unlock proof exceeded 10 seconds.'));
		}, 10_000);
		terminal.onData((data) => {
			content += data;
			if (!inputSent && content.includes('TERMINAY_TTY_READY')) {
				inputSent = true;
				terminal.write(`${ttyPassphrase}\r`);
			}
		});
		terminal.onExit(({ exitCode, signal }) => {
			clearTimeout(timeout);
			if (exitCode !== 0) {
				reject(
					new Error(
						`Pseudo-terminal fixture failed (exit=${exitCode}, signal=${signal}): ${content}`,
					),
				);
				return;
			}
			resolve(content);
		});
	});
	assert.equal(output.includes(ttyPassphrase), false);
	const result = JSON.parse(output.match(/\{[^\r\n]+\}/)?.[0] ?? '');
	assert.deepEqual(result, {
		length: Buffer.byteLength(ttyPassphrase),
		zeroized: true,
		fdClosed: true,
	});
});

test('unlockFromSource zeroizes the passphrase buffer after both success and failure', async () => {
	const material = passphrase();
	const delegate = new PassphraseKeyProtector();
	let unlockBuffer;
	const protector = {
		type: delegate.type,
		wrap: (...arguments_) => delegate.wrap(...arguments_),
		unwrap(keyEnvelope, unlockMaterial, serverId) {
			unlockBuffer = unlockMaterial;
			return delegate.unwrap(keyEnvelope, unlockMaterial, serverId);
		},
	};
	const vault = await ReferenceVault.create(
		'source-zeroization',
		protector,
		material,
	);
	material.fill(0);
	vault.lock();

	for (const value of [
		'correct horse battery staple\n',
		'wrong passphrase material\n',
	]) {
		let collectedBuffer;
		const io = {
			read(_fd, target) {
				collectedBuffer = target;
				const input = Buffer.from(value);
				input.copy(target);
				input.fill(0);
				return Buffer.byteLength(value);
			},
			close() {},
		};
		if (value.startsWith('wrong')) {
			await assert.rejects(
				() => vault.unlockFromSource({ kind: 'inherited-fd', fd: 8 }, io),
				VaultUnlockError,
			);
		} else {
			await vault.unlockFromSource({ kind: 'inherited-fd', fd: 8 }, io);
			vault.lock();
		}
		assert.equal(
			collectedBuffer.every((byte) => byte === 0),
			true,
		);
		assert.equal(
			unlockBuffer.every((byte) => byte === 0),
			true,
		);
	}
});

test('inherited key FD is consumed once, closed, bounded, and never placed in argv or env', async () => {
	const secretPassphrase = 'one shot inherited passphrase';
	const result = await runChild(process.execPath, [inputFixture, 'fd'], {
		env: { PATH: process.env.PATH },
		stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
		onSpawn(child) {
			child.stdio[3].end(`${secretPassphrase}\n`);
		},
	});
	assert.equal(result.code, 0, result.stderr);
	assert.equal(result.stdout.includes(secretPassphrase), false);
	assert.deepEqual(JSON.parse(result.stdout), {
		length: Buffer.byteLength(secretPassphrase),
		zeroized: true,
		fdClosed: true,
	});

	const oversizedBytes = Buffer.alloc(MAX_PASSPHRASE_BYTES + 2, 0x61);
	let closed = false;
	assert.throws(
		() =>
			readHeadlessPassphrase(
				{ kind: 'inherited-fd', fd: 9 },
				{
					read(_fd, target) {
						oversizedBytes.copy(target);
						return target.length;
					},
					close() {
						closed = true;
					},
				},
			),
		/exceeds/,
	);
	assert.equal(closed, true);
	oversizedBytes.fill(0);
});
