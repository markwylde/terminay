import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	APP_VIEW_PROXY_CONTENT_SECURITY_POLICY,
	DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY,
	UiBundleStore,
	deriveUiBundleId,
	isAppViewProxyAssetPath,
} from "@terminay/server-core";
import { createLocalUiServer } from "../dist/index.js";

function bundle(files) {
	const encoded = new Map([...Object.entries(files)].map(([path, text]) => [path, new TextEncoder().encode(text)]));
	const provisional = [...encoded].map(([relativePath, bytes]) => ({
		contentType: relativePath.endsWith(".html") ? "text/html; charset=utf-8" : "application/javascript; charset=utf-8",
		hash: createHash("sha256").update(bytes).digest("base64url"),
		path: `/remote-app/provisional/${relativePath}`,
		size: bytes.byteLength,
	}));
	const bundleId = deriveUiBundleId(provisional, "provisional");
	return {
		bundleId,
		manifest: {
			schemaVersion: 1,
			bundleId,
			entryPath: `/remote-app/${bundleId}/index.html`,
			protocolVersion: "1",
			serverVersion: "1.0.0",
			assets: provisional.map((asset) => ({ ...asset, path: asset.path.replace("provisional", bundleId) })),
		},
		files: new Map([...encoded].map(([relativePath, bytes]) => [`/remote-app/${bundleId}/${relativePath}`, bytes])),
	};
}

test("the proxy path is recognised only as a direct child of a bundle", () => {
	assert.equal(isAppViewProxyAssetPath("/remote-app/abc/app-view.html"), true);
	assert.equal(isAppViewProxyAssetPath("/remote-app/abc/nested/app-view.html"), false);
	assert.equal(isAppViewProxyAssetPath("/remote-app/abc/app-view.html.js"), false);
	assert.equal(isAppViewProxyAssetPath("/app-view.html"), false);
});

test("the proxy policy forces an opaque origin and admits only its own origin as an ancestor", () => {
	const directives = APP_VIEW_PROXY_CONTENT_SECURITY_POLICY.split(";").map((part) => part.trim());
	assert.equal(directives[0], "sandbox allow-scripts allow-forms");
	assert.ok(!directives[0].includes("allow-same-origin"));
	assert.ok(directives.includes("default-src 'none'"));
	assert.ok(directives.includes("frame-ancestors 'self'"));
	assert.ok(directives.includes("base-uri 'none'"));
});

test("the sandbox proxy is served with its own headers and every other asset is unchanged", async () => {
	const root = await mkdtemp(join(tmpdir(), "terminay-app-view-"));
	const store = new UiBundleStore({ rootDirectory: join(root, "bundles") });
	const built = bundle({
		"index.html": "<!doctype html><title>workspace</title><script src=\"/assets/app.js\"></script>",
		"assets/app.js": "console.log('workspace')",
		"app-view.html": "<!doctype html><title>proxy</title>",
	});
	await store.install({ manifest: built.manifest, read: (path) => built.files.get(path) ?? assert.fail(`unexpected asset read: ${path}`) });
	const server = createLocalUiServer({ rootDirectory: root, bundleStore: store, serverId: "server-a", serverVersion: "1.0.0", authToken: "app-view-test-token" });
	try {
		const { origin } = await server.start();
		for (const path of ["/app-view.html", `/remote-app/${built.bundleId}/app-view.html`]) {
			const proxy = await fetch(`${origin}${path}`);
			assert.equal(proxy.status, 200, path);
			assert.equal(await proxy.text(), "<!doctype html><title>proxy</title>");
			assert.equal(proxy.headers.get("content-security-policy"), APP_VIEW_PROXY_CONTENT_SECURITY_POLICY);
			// DENY would stop the workspace framing it; frame-ancestors 'self' is the guard.
			assert.equal(proxy.headers.get("x-frame-options"), null);
			assert.equal(proxy.headers.get("x-content-type-options"), "nosniff");
			assert.equal(proxy.headers.get("referrer-policy"), "no-referrer");
		}
		for (const path of ["/", "/assets/app.js"]) {
			const asset = await fetch(`${origin}${path}`);
			assert.equal(asset.status, 200, path);
			assert.equal(asset.headers.get("content-security-policy"), DEFAULT_UI_BUNDLE_CONTENT_SECURITY_POLICY);
			assert.equal(asset.headers.get("x-frame-options"), "DENY");
			assert.equal(asset.headers.get("cross-origin-opener-policy"), "same-origin");
		}
	} finally {
		await server.stop();
		await rm(root, { recursive: true, force: true });
	}
});
