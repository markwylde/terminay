import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UiBundleStore, deriveUiBundleId, UiBundleError } from "../dist/index.js";

function fixture(version, body = `<!doctype html><title>${version}</title>`) {
	const bytes = new TextEncoder().encode(body);
	const provisional = [{
		contentType: "text/html; charset=utf-8",
		hash: hash(bytes),
		path: "/remote-app/provisional/index.html",
		size: bytes.byteLength,
	}];
	const bundleId = deriveUiBundleId(provisional, "provisional");
	const manifest = {
		schemaVersion: 1,
		bundleId,
		entryPath: `/remote-app/${bundleId}/index.html`,
		protocolVersion: "1",
		serverVersion: version,
		assets: provisional.map((asset) => ({ ...asset, path: asset.path.replace("provisional", bundleId) })),
	};
	return { manifest, bytes };
}

test("UI bundle store commits verified bundles behind an atomic versioned pointer", async () => {
	const root = await mkdtemp(join(tmpdir(), "terminay-ui-bundle-store-"));
	try {
		const store = new UiBundleStore({ rootDirectory: root });
		assert.equal(await store.open(), undefined);
		const first = fixture("1.0.0");
		const firstVerified = await store.install({ manifest: first.manifest, read: () => first.bytes });
		assert.equal((await store.open())?.manifest.bundleId, first.manifest.bundleId);
		assert.equal(new TextDecoder().decode(firstVerified.read(first.manifest.entryPath)), first.bytes.length === 0 ? "" : "<!doctype html><title>1.0.0</title>");
		await stat(join(root, first.manifest.bundleId, "index.html"));
		assert.deepEqual(JSON.parse(await readFile(join(root, "current.json"), "utf8")), { schemaVersion: 1, bundleId: first.manifest.bundleId });

		const second = fixture("1.1.0");
		await store.install({ manifest: second.manifest, read: () => second.bytes });
		assert.equal((await store.open())?.manifest.serverVersion, "1.1.0");
		await assert.rejects(stat(join(root, first.manifest.bundleId, "index.html")), (error) => error?.code === "ENOENT");
		await stat(join(root, second.manifest.bundleId, "index.html"));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("failed verification never changes the committed bundle", async () => {
	const root = await mkdtemp(join(tmpdir(), "terminay-ui-bundle-store-failure-"));
	try {
		const store = new UiBundleStore({ rootDirectory: root });
		const first = fixture("1.0.0");
		await store.install({ manifest: first.manifest, read: () => first.bytes });
		const second = fixture("1.1.0");
		const wrong = new TextEncoder().encode("not-the-manifest-bytes");
		await assert.rejects(
			store.install({ manifest: second.manifest, read: () => wrong }),
			(error) => error instanceof UiBundleError && error.code === "integrity",
		);
		assert.equal((await store.open())?.manifest.serverVersion, "1.0.0");
		await stat(join(root, first.manifest.bundleId, "index.html"));
		assert.deepEqual(JSON.parse(await readFile(join(root, "current.json"), "utf8")), { schemaVersion: 1, bundleId: first.manifest.bundleId });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("a stalled remote asset transfer times out without replacing the committed bundle", async () => {
	const root = await mkdtemp(join(tmpdir(), "terminay-ui-bundle-store-timeout-"));
	try {
		const store = new UiBundleStore({ rootDirectory: root, sourceReadTimeoutMs: 15 });
		const first = fixture("1.0.0");
		await store.install({ manifest: first.manifest, read: () => first.bytes });
		const second = fixture("1.1.0");
		await assert.rejects(
			store.install({ manifest: second.manifest, read: () => new Promise(() => {}) }),
			(error) => error instanceof UiBundleError && error.code === "not_found" && /timed out/.test(error.message),
		);
		assert.equal((await store.open())?.manifest.serverVersion, "1.0.0");
		assert.deepEqual(JSON.parse(await readFile(join(root, "current.json"), "utf8")), {
			schemaVersion: 1,
			bundleId: first.manifest.bundleId,
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("an invalid executable asset graph cannot replace the committed bundle", async () => {
	const root = await mkdtemp(join(tmpdir(), "terminay-ui-bundle-store-invalid-graph-"));
	try {
		const store = new UiBundleStore({ rootDirectory: root });
		const first = fixture("1.0.0");
		await store.install({ manifest: first.manifest, read: () => first.bytes });
		const invalid = fixture("1.1.0", '<!doctype html><script src="https://attacker.invalid/app.js"></script>');
		await assert.rejects(
			store.install({ manifest: invalid.manifest, read: () => invalid.bytes }),
			(error) => error instanceof UiBundleError && error.code === "integrity" && /external asset/.test(error.message),
		);
		assert.equal((await store.open())?.manifest.serverVersion, "1.0.0");
		assert.deepEqual(JSON.parse(await readFile(join(root, "current.json"), "utf8")), {
			schemaVersion: 1,
			bundleId: first.manifest.bundleId,
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("committed UI bundles fail closed instead of following a substituted asset symlink", async () => {
	const root = await mkdtemp(join(tmpdir(), "terminay-ui-bundle-store-symlink-"));
	try {
		const store = new UiBundleStore({ rootDirectory: root });
		const bundle = fixture("1.0.0");
		await store.install({ manifest: bundle.manifest, read: () => bundle.bytes });
		const asset = join(root, bundle.manifest.bundleId, "index.html");
		const outside = join(root, "outside.html");
		await writeFile(outside, "unverified local content");
		await rm(asset);
		await symlink(outside, asset);

		await assert.rejects(
			store.open(),
			(error) => error instanceof UiBundleError && error.code === "integrity" && /not a regular file/.test(error.message),
		);
		assert.deepEqual(JSON.parse(await readFile(join(root, "current.json"), "utf8")), {
			schemaVersion: 1,
			bundleId: bundle.manifest.bundleId,
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("committed UI bundles fail closed instead of following a substituted manifest symlink", async () => {
	const root = await mkdtemp(join(tmpdir(), "terminay-ui-bundle-store-manifest-symlink-"));
	try {
		const store = new UiBundleStore({ rootDirectory: root });
		const bundle = fixture("1.0.0");
		await store.install({ manifest: bundle.manifest, read: () => bundle.bytes });
		const manifest = join(root, bundle.manifest.bundleId, "manifest.json");
		const outside = join(root, "outside-manifest.json");
		await writeFile(outside, await readFile(manifest));
		await rm(manifest);
		await symlink(outside, manifest);

		await assert.rejects(
			store.open(),
			(error) => error instanceof UiBundleError && error.code === "integrity" && /not a regular file/.test(error.message),
		);
		assert.deepEqual(JSON.parse(await readFile(join(root, "current.json"), "utf8")), {
			schemaVersion: 1,
			bundleId: bundle.manifest.bundleId,
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function hash(bytes) {
	return createHash("sha256").update(bytes).digest("base64url");
}
