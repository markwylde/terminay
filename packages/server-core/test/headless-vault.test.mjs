import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	FileVaultEnvelopeStorage,
	HeadlessPassphraseVaultAdapter,
	ServerVaultService,
	VaultServiceError,
} from "../dist/index.js";

const passphrase = () => new TextEncoder().encode("headless-passphrase");

class MemoryStorage {
	serialized;
	async read() { return this.serialized; }
	async write(value) { this.serialized = value; }
}

test("headless passphrase adapter persists only encrypted metadata and zeroizes scopes", async () => {
	const storage = new MemoryStorage();
	const adapter = await HeadlessPassphraseVaultAdapter.open({ serverId: "server-a", storage, now: () => 1_700_000_000_000 });
	const service = new ServerVaultService(adapter);
	assert.equal(service.status().state, "locked");

	const unlockBytes = passphrase();
	await service.unlock({ secret: unlockBytes });
	assert.deepEqual([...unlockBytes], new Array(unlockBytes.length).fill(0));
	const value = new TextEncoder().encode("super-secret-token");
	const result = await service.put({ id: "provider.token", label: "Provider token", value });
	assert.deepEqual(result.reference, {
		id: "provider.token",
		configured: true,
		label: "Provider token",
		version: 1,
		updatedAt: 1_700_000_000_000,
	});
	assert.deepEqual(service.status().entries.map(({ id, label }) => ({ id, label })), [{ id: "provider.token", label: "Provider token" }]);
	assert.equal(JSON.stringify(service.status()).includes("super-secret-token"), false);
	assert.equal(storage.serialized.includes("super-secret-token"), false);
	assert.equal(storage.serialized.includes("headless-passphrase"), false);

	let scoped;
	await service.withSecret("provider.token", (secret) => {
		scoped = secret;
		assert.equal(new TextDecoder().decode(secret), "super-secret-token");
	});
	assert.deepEqual([...scoped], new Array(scoped.length).fill(0));

	await service.restartLock();
	assert.equal(service.status().state, "locked");
	await assert.rejects(service.withSecret("provider.token", () => undefined), (error) => error instanceof VaultServiceError && error.code === "locked");

	const reopened = await HeadlessPassphraseVaultAdapter.open({ serverId: "server-a", storage });
	const reopenedService = new ServerVaultService(reopened);
	const wrong = new TextEncoder().encode("wrong-passphrase");
	await assert.rejects(reopenedService.unlock({ secret: wrong }), (error) => error instanceof VaultServiceError && error.code === "locked");
	assert.deepEqual([...wrong], new Array(wrong.length).fill(0));
	await reopenedService.unlock({ secret: passphrase() });
	assert.equal(await reopenedService.test("provider.token").then((testResult) => testResult.ok), true);
	assert.equal(await reopenedService.withSecret("provider.token", (secret) => new TextDecoder().decode(secret)), "super-secret-token");
});

test("rotation refreshes the wrapped data key and restart lock prevents access", async () => {
	const storage = new MemoryStorage();
	const adapter = await HeadlessPassphraseVaultAdapter.open({ serverId: "server-b", storage, now: () => 42 });
	const service = new ServerVaultService(adapter);
	await service.unlock({ secret: passphrase() });
	await service.put({ id: "one", value: new TextEncoder().encode("one-secret") });
	const before = storage.serialized;
	await service.rotate();
	assert.notEqual(storage.serialized, before);
	assert.equal(await service.withSecret("one", (secret) => new TextDecoder().decode(secret)), "one-secret");
	await service.lock();
	await assert.rejects(service.rotate(), (error) => error instanceof VaultServiceError && error.code === "locked");
});

test("file storage writes a bounded 0600 envelope atomically", async () => {
	const directory = await mkdtemp(join(tmpdir(), "terminay-headless-vault-"));
	try {
		const filePath = join(directory, "vault.json");
		const storage = new FileVaultEnvelopeStorage(filePath);
		const adapter = await HeadlessPassphraseVaultAdapter.open({ serverId: "server-file", storage });
		const service = new ServerVaultService(adapter);
		await service.unlock({ secret: passphrase() });
		await service.put({ id: "file-secret", value: new TextEncoder().encode("file-only-secret") });
		const serialized = await readFile(filePath, "utf8");
		assert.equal(serialized.includes("file-only-secret"), false);
		const reopened = await HeadlessPassphraseVaultAdapter.open({ serverId: "server-file", storage });
		const reopenedService = new ServerVaultService(reopened);
		await reopenedService.unlock({ secret: passphrase() });
		assert.equal(await reopenedService.withSecret("file-secret", (secret) => new TextDecoder().decode(secret)), "file-only-secret");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("an envelope cannot be opened under a different server identity", async () => {
	const storage = new MemoryStorage();
	const adapter = await HeadlessPassphraseVaultAdapter.open({ serverId: "server-canonical", storage });
	const service = new ServerVaultService(adapter);
	await service.unlock({ secret: passphrase() });
	await assert.rejects(HeadlessPassphraseVaultAdapter.open({ serverId: "server-other", storage }), /envelope is invalid/);
});
