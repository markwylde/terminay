import test from "node:test";
import assert from "node:assert/strict";
import { CanonicalProjectPathResolver, FileContentError, FileContentStreamService } from "../dist/fileService/index.js";

function memoryContent(options = {}) {
  const files = new Map([
    ["/project/README.md", new TextEncoder().encode("# Hello\nworld\n")],
    ["/project/image.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["/project/document.pdf", new TextEncoder().encode("%PDF-1.7\n")],
    ["/project/blob.bin", new Uint8Array([0, 1, 2, 3, 4])],
    ["/project/raw", new Uint8Array([0, 1, 2, 3])],
    ["/project/huge.txt", new Uint8Array([65, 66, 67, 68, 69])],
    ["/project/huge.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
    ["/project/malformed.md", new Uint8Array([0xff, 0xfe, 0xfd])],
    ["/project/malformed.txt", new Uint8Array([0xff, 0xfe])],
  ]);
  const stats = new Map([
    ["/project", { isDirectory: true, size: 0 }],
    ...[...files.entries()].map(([path, bytes]) => [path, { isFile: true, size: path.endsWith("huge.txt") || path.endsWith("huge.png") ? 100 : bytes.byteLength }]),
  ]);
  const missing = (path) => Object.assign(new Error(`ENOENT ${path}`), { code: "ENOENT" });
  const storage = {
    realpath(path) { if (!stats.has(path)) throw missing(path); return path; },
    stat(path) { const value = stats.get(path); if (!value) throw missing(path); return value; },
    readRange(path, offset, length, signal) {
      if (signal?.aborted) throw signal.reason;
      if (options.waitForRead) return new Promise((resolve) => { options.releaseRead = () => resolve((files.get(path) ?? new Uint8Array()).slice(offset, offset + length)); });
      return (files.get(path) ?? new Uint8Array()).slice(offset, offset + length);
    },
  };
  return { service: new FileContentStreamService(new CanonicalProjectPathResolver("/project", storage), storage, { maxRangeBytes: 4, maxPreviewBytes: 16, maxTextBytes: 4, maxHexRows: 2, maxConcurrentReads: 1, largeFileBytes: 50 }), storage };
}

test("content stream classifies canonical files and serves bounded text, HEX, and previews", async () => {
  const { service } = memoryContent();
  const markdown = await service.capabilities("README.md");
  assert.equal(markdown.kind, "markdown");
  assert.equal(markdown.canText, true);
  assert.equal(markdown.canPreview, true);
  assert.equal((await service.readText("README.md", 0, 4)).text, "# He");
  const hex = await service.readHex("blob.bin", 0, 4, 2);
  assert.deepEqual(hex.rows.map((row) => [row.offset, row.hex, row.ascii]), [[0, "00 01", ".."], [2, "02 03", ".."]]);
  const image = await service.readPreview("image.png");
  assert.equal(image.kind, "image");
  assert.equal(image.contentType, "image/png");
  assert.equal(image.decodedImagePixelLimit, 16_000_000);
  assert.equal((await service.capabilities("document.pdf")).kind, "pdf");
});

test("content stream rejects oversized ranges, unsafe paths, and unsupported previews", async () => {
  const { service } = memoryContent();
  await assert.rejects(() => service.readRange("README.md", 0, 5), (error) => error instanceof FileContentError && error.code === "range_too_large");
  await assert.rejects(() => service.readText("blob.bin", 0, 2), (error) => error instanceof FileContentError && error.code === "unsupported_preview");
  await assert.rejects(() => service.readPreview("blob.bin"), (error) => error instanceof FileContentError && error.code === "unsupported_preview");
  await assert.rejects(() => service.readRange("../outside", 0, 1), (error) => error instanceof FileContentError && error.code === "invalid_path");
  await assert.rejects(() => service.readPreview("huge.png"), (error) => error instanceof FileContentError && error.code === "preview_too_large");
});

test("content stream enforces concurrent read and cancellation limits", async () => {
  const options = { waitForRead: true };
  const { service } = memoryContent(options);
  const first = service.readRange("README.md", 0, 2);
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => service.readRange("README.md", 0, 2), (error) => error instanceof FileContentError && error.code === "concurrency_limit");
  options.releaseRead?.();
  await first;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => service.readRange("README.md", 0, 1, controller.signal), /aborted/i);
});

test("content transport reports bounded large-text metadata and all preview/HEX sources", async () => {
  const { service } = memoryContent();
  const large = await service.capabilities("huge.txt");
  assert.equal(large.isLarge, true);
  assert.equal(large.canText, true);
  assert.equal(large.canHex, true);
  const largeRange = await service.readText("huge.txt", 0, 4);
  assert.equal(largeRange.text, "ABCD");
  assert.equal(largeRange.totalSize, 100);
  assert.equal(largeRange.truncated, false);

  const markdown = await service.readPreview("README.md");
  assert.equal(markdown.kind, "markdown");
  assert.equal(markdown.contentType, "text/markdown");
  assert.equal(markdown.truncated, false);
  const pdf = await service.readPreview("document.pdf");
  assert.equal(pdf.kind, "pdf");
  assert.equal(pdf.contentType, "application/pdf");
  assert.equal(pdf.truncated, false);
  const binary = await service.readHex("blob.bin", 0, 4, 4);
  assert.equal(binary.kind, "binary");
  assert.equal(binary.rows.length, 1);
  assert.equal(binary.rows[0].hex, "00 01 02 03");
  await assert.rejects(() => service.readText("raw", 0, 4), (error) => error instanceof FileContentError && error.code === "unsupported_preview");
  const malformedMarkdown = await service.capabilities("malformed.md");
  assert.equal(malformedMarkdown.kind, "binary");
  assert.equal(malformedMarkdown.canText, false);
  await assert.rejects(() => service.readText("malformed.md", 0, 3), (error) => error instanceof FileContentError && error.code === "unsupported_preview");
  const malformedText = await service.readText("malformed.txt", 0, 2);
  assert.equal(malformedText.kind, "text");
  assert.equal(malformedText.invalidEncoding, true);
  assert.equal(malformedText.text, "��");
});
