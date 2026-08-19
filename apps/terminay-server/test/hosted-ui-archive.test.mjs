import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { loadHostedUiArchive } from "../dist/remote/hostedUiArchive.js";

test("hosted UI archive packs renderer files as gzip ustar with bundle metadata", async () => {
	const root = await mkdtemp(join(tmpdir(), "terminay-hosted-ui-archive-"));
	try {
		await mkdir(join(root, "assets"));
		await writeFile(join(root, "server.html"), "<!doctype html><title>hosted</title>");
		await writeFile(join(root, "assets", "app.js"), "window.hostedUi = true;");
		await writeFile(join(root, "assets", "app.js.map"), "not transferred");
		const first = await loadHostedUiArchive(root);
		const second = await loadHostedUiArchive(root);
		assert.equal(first.bundleId, second.bundleId);
		assert.deepEqual(first.bytes, second.bytes);

		const entries = readTar(gunzipSync(first.bytes));
		assert.deepEqual(
			entries.map((entry) => entry.path),
			["terminay-bundle.json", "assets/app.js", "server.html"],
		);
		assert.deepEqual(JSON.parse(entries[0].bytes.toString("utf8")), {
			applicationProtocolVersion: "1",
			archiveFormatVersion: 1,
			bundleId: first.bundleId,
			entryPath: "server.html",
		});
		assert.equal(
			entries.find((entry) => entry.path === "server.html")?.bytes.toString("utf8"),
			"<!doctype html><title>hosted</title>",
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("hosted UI archive requires the declared workspace entry", async () => {
	const root = await mkdtemp(join(tmpdir(), "terminay-hosted-ui-archive-missing-"));
	try {
		await writeFile(join(root, "index.html"), "<!doctype html>");
		await assert.rejects(loadHostedUiArchive(root), /server\.html is missing/u);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("standalone CLI attaches the application protocol and optional UI archive", async () => {
	const cli = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8");
	assert.match(cli, /acceptApplication:\s*\(transport, authenticatedClient\) =>/u);
	assert.match(cli, /composition\.core\.accept\(transport, \{ authenticatedClient \}\)/u);
	assert.match(cli, /TERMINAY_UI_RENDERER_DIRECTORY/u);
	assert.match(cli, /loadHostedUiArchive\(rendererDirectory\)/u);
});

function readTar(bytes) {
	const entries = [];
	let offset = 0;
	while (offset + 512 <= bytes.byteLength) {
		const header = bytes.subarray(offset, offset + 512);
		offset += 512;
		if (header.every((byte) => byte === 0)) break;
		const name = tarText(header.subarray(0, 100));
		const size = Number.parseInt(tarText(header.subarray(124, 136)).trim() || "0", 8);
		entries.push({
			bytes: Buffer.from(bytes.subarray(offset, offset + size)),
			path: name,
		});
		offset += Math.ceil(size / 512) * 512;
	}
	return entries;
}

function tarText(bytes) {
	const end = bytes.indexOf(0);
	return Buffer.from(end < 0 ? bytes : bytes.subarray(0, end)).toString("utf8");
}
