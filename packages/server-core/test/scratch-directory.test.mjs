import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureScratchDirectory,
  scratchRoot,
  scratchSubdirectory,
  UnsafeScratchDirectoryError,
  writeClipboardImage,
} from "../dist/index.js";

const posix = process.platform !== "win32";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

async function sandbox(t) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "terminay-scratch-test-"));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  return { temporaryDirectory };
}

test("the scratch root is named for the account, and plain on Windows", () => {
  assert.equal(scratchRoot({ platform: "linux", uid: 1000, temporaryDirectory: "/tmp" }), "/tmp/terminay-1000");
  assert.equal(scratchRoot({ platform: "darwin", uid: 501, temporaryDirectory: "/var/t" }), "/var/t/terminay-501");
  assert.equal(scratchRoot({ platform: "win32", temporaryDirectory: "C:\\T" }).endsWith("terminay"), true);
  assert.equal(
    scratchSubdirectory("terminay-clipboard", { platform: "linux", uid: 7, temporaryDirectory: "/tmp" }),
    "/tmp/terminay-7/terminay-clipboard",
  );
});

test("a fresh scratch directory and its root are created owner-only", { skip: !posix }, async (t) => {
  const options = await sandbox(t);
  const directory = scratchSubdirectory("terminay-clipboard", options);
  await ensureScratchDirectory(directory, options);
  for (const path of [scratchRoot(options), directory]) {
    const info = await stat(path);
    assert.equal(info.isDirectory(), true);
    assert.equal(info.mode & 0o077, 0, `${path} is owner-only`);
    assert.equal(info.uid, process.getuid());
  }
  // Checking again is harmless.
  await ensureScratchDirectory(directory, options);
});

test("a root that others can reach is refused", { skip: !posix }, async (t) => {
  const options = await sandbox(t);
  const root = scratchRoot(options);
  await mkdir(root, { mode: 0o700 });
  await chmod(root, 0o775);
  await assert.rejects(
    ensureScratchDirectory(scratchSubdirectory("terminay-drops", options), options),
    (error) => error instanceof UnsafeScratchDirectoryError && /other accounts/.test(error.message),
  );
  assert.deepEqual(await readdir(root), [], "nothing was created inside the unsafe root");
});

test("a root owned by another account is refused", { skip: !posix }, async (t) => {
  const options = await sandbox(t);
  await mkdir(scratchRoot(options), { mode: 0o700 });
  // Pretend to be another account: the directory's real owner no longer matches.
  await assert.rejects(
    ensureScratchDirectory(scratchSubdirectory("terminay-drops", options), {
      ...options,
      uid: process.getuid() + 1,
    }),
    (error) => error instanceof UnsafeScratchDirectoryError && /another account/.test(error.message),
  );
});

test("a symbolic link planted at the root is refused", { skip: !posix }, async (t) => {
  const options = await sandbox(t);
  const elsewhere = join(options.temporaryDirectory, "elsewhere");
  await mkdir(elsewhere, { mode: 0o700 });
  await symlink(elsewhere, scratchRoot(options));
  await assert.rejects(
    ensureScratchDirectory(scratchSubdirectory("terminay-attachments", options), options),
    (error) => error instanceof UnsafeScratchDirectoryError && /symbolic link/.test(error.message),
  );
  assert.deepEqual(await readdir(elsewhere), [], "nothing was written through the link");
});

test("a file where a directory belongs is refused", { skip: !posix }, async (t) => {
  const options = await sandbox(t);
  await mkdir(scratchRoot(options), { mode: 0o700 });
  await writeFile(scratchSubdirectory("terminay-clipboard", options), "not a directory");
  await assert.rejects(
    ensureScratchDirectory(scratchSubdirectory("terminay-clipboard", options), options),
    (error) => error instanceof UnsafeScratchDirectoryError && /not a directory/.test(error.message),
  );
});

test("Windows skips the POSIX ownership checks", async (t) => {
  const options = { ...(await sandbox(t)), platform: "win32" };
  const directory = scratchSubdirectory("terminay-clipboard", options);
  await ensureScratchDirectory(directory, options);
  assert.equal((await stat(directory)).isDirectory(), true);
});

test("a clipboard image is written owner-only into a checked directory", { skip: !posix }, async (t) => {
  const { temporaryDirectory } = await sandbox(t);
  const directory = join(temporaryDirectory, "clipboard");
  const path = await writeClipboardImage({ bytes: PNG, mimeType: "image/png", directory });
  const info = await stat(path);
  assert.equal(info.mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o077, 0);
});

test("a clipboard image is not written into an unsafe directory", { skip: !posix }, async (t) => {
  const { temporaryDirectory } = await sandbox(t);
  const directory = join(temporaryDirectory, "clipboard");
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o777);
  await assert.rejects(writeClipboardImage({ bytes: PNG, mimeType: "image/png", directory }));
  assert.deepEqual(await readdir(directory), []);
});
