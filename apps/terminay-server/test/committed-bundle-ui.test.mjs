import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY, UiBundleStore, deriveUiBundleId } from "@terminay/server-core";
import { createLocalUiServer } from "../dist/index.js";

function bundle(serverVersion, html, script) {
	const files = new Map([["index.html", new TextEncoder().encode(html)]]);
	if (script !== undefined) files.set("assets/app.js", new TextEncoder().encode(script));
	const provisional = [...files].map(([relativePath, bytes]) => ({
		contentType: relativePath.endsWith(".html") ? "text/html; charset=utf-8" : "application/javascript; charset=utf-8",
		hash: createHash("sha256").update(bytes).digest("base64url"),
		path: `/remote-app/provisional/${relativePath}`,
		size: bytes.byteLength,
	}));
	const bundleId = deriveUiBundleId(provisional, "provisional");
	return {
		manifest: {
			schemaVersion: 1,
			bundleId,
			entryPath: `/remote-app/${bundleId}/index.html`,
			protocolVersion: "1",
			serverVersion,
			assets: provisional.map((asset) => ({ ...asset, path: asset.path.replace("provisional", bundleId) })),
		},
		files: new Map([...files].map(([relativePath, bytes]) => [`/remote-app/${bundleId}/${relativePath}`, bytes])),
	};
}

test("Local UI launches only the committed server bundle and keeps the prior version on failed update", async () => {
	const root = await mkdtemp(join(tmpdir(), "terminay-committed-ui-"));
	const store = new UiBundleStore({ rootDirectory: join(root, "bundles") });
	const first = bundle("1.0.0", "<!doctype html><title>old</title><script src=\"/assets/app.js\"></script>", "console.log('committed')");
	const second = bundle("1.0.0", "<!doctype html><title>new</title>");
	await store.install({ manifest: first.manifest, read: (path) => first.files.get(path) ?? assert.fail(`unexpected asset read: ${path}`) });
	await assert.rejects(store.install({ manifest: second.manifest, read: () => new TextEncoder().encode("partial") }), /size mismatch|hash mismatch/);

	const server = createLocalUiServer({
		rootDirectory: root,
		bundleStore: store,
		serverId: "server-a",
		serverVersion: "1.0.0",
		authToken: "committed-ui-test-token",
	});
	try {
		const address = await server.start();
		const response = await fetch(`${address.origin}/`, { headers: { Authorization: "Bearer committed-ui-test-token" } });
		assert.equal(response.status, 200);
		assert.equal(await response.text(), "<!doctype html><title>old</title><script src=\"/assets/app.js\"></script>");
		assert.equal(response.headers.get("content-security-policy"), DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY);
		const scriptResponse = await fetch(`${address.origin}/assets/app.js`, { headers: { Authorization: "Bearer committed-ui-test-token" } });
		assert.equal(scriptResponse.status, 200);
		assert.equal(await scriptResponse.text(), "console.log('committed')");
		const manifestResponse = await fetch(`${address.origin}/manifest.json`, { headers: { Authorization: "Bearer committed-ui-test-token" } });
		assert.equal(manifestResponse.status, 200);
		const servedManifest = await manifestResponse.json();
		assert.equal(servedManifest.entryPath, first.manifest.entryPath);
		assert.equal(servedManifest.contentSecurityPolicy, DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY);
	} finally {
		await server.stop();
		await rm(root, { recursive: true, force: true });
	}
});
