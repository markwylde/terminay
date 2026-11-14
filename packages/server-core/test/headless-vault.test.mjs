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

test("a corrupt envelope file opens an empty vault that cannot read old secrets, and is kept aside (ADR-0088)", async () => {
	const { readdir, writeFile } = await import("node:fs/promises");
	const { takeStateRecoveryNotices } = await import("../dist/index.js");
	const directory = await mkdtemp(join(tmpdir(), "terminay-headless-vault-corrupt-"));
	try {
		const filePath = join(directory, "vault.json");
		const storage = new FileVaultEnvelopeStorage(filePath);
		const service = new ServerVaultService(await HeadlessPassphraseVaultAdapter.open({ serverId: "server-file", storage }));
		await service.unlock({ secret: passphrase() });
		await service.put({ id: "old-secret", value: new TextEncoder().encode("old-value") });
		await service.put({ id: "newer-secret", value: new TextEncoder().encode("newer-value") });
		const good = await readFile(filePath, "utf8");
		assert.equal((await readdir(directory)).some((name) => name.endsWith(".previous")), false, "a secret store keeps no .previous");
		for (const [shape, bytes] of [["zero-filled", Buffer.alloc(Buffer.byteLength(good))], ["truncated", good.slice(0, good.length >> 1)], ["invalid JSON", "{not json"]]) {
			takeStateRecoveryNotices();
			await writeFile(filePath, bytes);
			// An older envelope beside it is never read.
			await writeFile(`${filePath}.previous`, good);
			const reopened = await HeadlessPassphraseVaultAdapter.open({ serverId: "server-file", storage });
			const reopenedService = new ServerVaultService(reopened);
			await reopenedService.unlock({ secret: passphrase() });
			assert.deepEqual(reopenedService.status().entries, [], shape);
			await assert.rejects(reopenedService.withSecret("old-secret", () => undefined), shape);
			assert.deepEqual(takeStateRecoveryNotices(), [{ kind: "secret-reset", store: "vault" }], shape);
			const names = await readdir(directory);
			assert.ok(names.some((name) => name.startsWith("vault.json.corrupt-")), shape);
			assert.equal(await readFile(`${filePath}.previous`, "utf8"), good, shape);
		}
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("rewrap moves the data key to a new secret and keeps every entry", async () => {
	const storage = new MemoryStorage();
	const adapter = await HeadlessPassphraseVaultAdapter.open({ serverId: "server-a", storage });
	const encode = (text) => new TextEncoder().encode(text);
	assert.equal(adapter.initialized, false);
	await assert.rejects(adapter.rewrap({ secret: encode("new-secret-for-vault") }), /locked/);
	await adapter.unlock({ secret: passphrase() });
	assert.equal(adapter.initialized, true);
	await adapter.put({ id: "provider.token", label: "", value: encode("kept-value") });
	await assert.rejects(adapter.rewrap({ secret: encode("short") }), RangeError);

	const next = encode("new-secret-for-vault");
	await adapter.rewrap({ secret: next });
	await adapter.put({ id: "after.rewrap", label: "", value: encode("second") });

	const reopenedOld = await HeadlessPassphraseVaultAdapter.open({ serverId: "server-a", storage });
	await assert.rejects(reopenedOld.unlock({ secret: passphrase() }), /unlock failed/);

	const reopened = await HeadlessPassphraseVaultAdapter.open({ serverId: "server-a", storage });
	await reopened.unlock({ secret: encode("new-secret-for-vault") });
	for (const [id, expected] of [["provider.token", "kept-value"], ["after.rewrap", "second"]]) {
		await reopened.withSecret(id, (value) => assert.equal(new TextDecoder().decode(value), expected));
	}
});

test("a rewrap whose write fails leaves the adapter on its previous envelope", async () => {
	const storage = new MemoryStorage();
	const adapter = await HeadlessPassphraseVaultAdapter.open({ serverId: "server-a", storage });
	const encode = (text) => new TextEncoder().encode(text);
	await adapter.unlock({ secret: passphrase() });
	await adapter.put({ id: "provider.token", label: "", value: encode("kept-value") });
	const before = storage.serialized;
	storage.write = async () => { throw new Error("disk full"); };
	await assert.rejects(adapter.rewrap({ secret: encode("new-secret-for-vault") }), /write failed/);
	assert.equal(adapter.status(), "unlocked");
	await adapter.withSecret("provider.token", (value) => assert.equal(new TextDecoder().decode(value), "kept-value"));
	assert.equal(storage.serialized, before);
	delete storage.write;
	await adapter.put({ id: "after.failure", label: "", value: encode("second") });
	const reopened = await HeadlessPassphraseVaultAdapter.open({ serverId: "server-a", storage });
	await reopened.unlock({ secret: passphrase() });
	await reopened.withSecret("after.failure", (value) => assert.equal(new TextDecoder().decode(value), "second"));
});
