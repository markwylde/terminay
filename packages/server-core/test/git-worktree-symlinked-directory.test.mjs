import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * A worktree commonly links its `node_modules` at the main checkout so the
 * dependencies are installed once. `.gitignore` patterns ending in `/` match
 * directories only, so Git reports that link as an ordinary untracked path and
 * the sidebar has no way to tell a folder from a file without help.
 */
test("a worktree's symlinked directory is reported as a directory, not a file", async () => {
  const { GitService } = await import("../dist/gitService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-worktree-symlink-"));
  const project = join(root, "project");
  const feature = join(root, "project-feature");
  try {
    await mkdir(project);
    await git(["init", "-b", "main"], project);
    await git(["config", "user.email", "test@example.invalid"], project);
    await git(["config", "user.name", "Terminay Test"], project);
    await writeFile(join(project, ".gitignore"), "node_modules/\n");
    await git(["add", ".gitignore"], project);
    await git(["commit", "-m", "initial"], project);
    await git(["worktree", "add", feature, "-b", "feature"], project);
    await mkdir(join(project, "node_modules"));
    await writeFile(join(project, "node_modules", "installed.js"), "module.exports = 1\n");
    await symlink(join(project, "node_modules"), join(feature, "node_modules"));
    await mkdir(join(feature, "notes"));
    await writeFile(join(feature, "notes", "todo.md"), "work\n");

    const service = new GitService();
    const binding = await service.bindProject("project", project);
    const list = await service.worktrees({ projectId: "project", repositoryId: binding.repositoryId });
    const worktree = list.worktrees.find((candidate) => candidate.path.endsWith("project-feature"));
    assert.ok(worktree, "expected the feature worktree to be listed");

    const linked = worktree.entries.find((entry) => entry.path === "node_modules");
    assert.ok(linked, "expected the symlinked node_modules to be an untracked entry");
    assert.equal(linked.kind, "untracked");
    assert.equal(linked.isDirectory, true);

    const file = worktree.entries.find((entry) => entry.path === "notes/todo.md");
    assert.ok(file, "expected the untracked file to be listed");
    assert.equal(file.isDirectory, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Deleting a link unlinks the link and never touches what it points at, so the
 * Explorer may remove a worktree's linked `node_modules` even though the link
 * leaves the project. Only the link's canonical parent is trusted, so no
 * intermediate link can redirect the removal out of the project.
 */
test("deleting a symlinked directory removes the link and keeps its target", async () => {
  const { CanonicalProjectPathResolver, FileCatalog, FileServiceError } = await import("../dist/fileService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-symlink-delete-"));
  const project = join(root, "project");
  const outside = join(root, "outside");
  try {
    await mkdir(project);
    await mkdir(outside);
    await writeFile(join(outside, "installed.js"), "module.exports = 1\n");
    await symlink(outside, join(project, "linked-outside"));
    await mkdir(join(project, "src"));
    await symlink(join(project, "src"), join(project, "linked-inside"));

    const storage = nodeStorage();
    const catalog = new FileCatalog(new CanonicalProjectPathResolver(project, storage), storage);

    await catalog.delete("linked-outside", { recursive: true });
    await assert.rejects(() => lstat(join(project, "linked-outside")), /ENOENT/);
    assert.equal((await stat(join(outside, "installed.js"))).isFile(), true);

    await catalog.delete("linked-inside", { recursive: true });
    await assert.rejects(() => lstat(join(project, "linked-inside")), /ENOENT/);
    assert.equal((await stat(join(project, "src"))).isDirectory(), true);

    await assert.rejects(
      () => catalog.delete("../outside", { recursive: true }),
      (error) => error instanceof FileServiceError && error.code === "path_escape",
    );
    assert.equal((await stat(outside)).isDirectory(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** A symlinked directory inside the project lists as an expandable folder. */
test("a listed symlink reports the kind it resolves to", async () => {
  const { CanonicalProjectPathResolver, FileCatalog } = await import("../dist/fileService/index.js");
  const root = await mkdtemp(join(tmpdir(), "terminay-symlink-list-"));
  const project = join(root, "project");
  try {
    await mkdir(project);
    await mkdir(join(project, "src"));
    await writeFile(join(project, "src", "main.ts"), "export {}\n");
    await symlink(join(project, "src"), join(project, "linked-src"));
    await symlink(join(project, "src", "main.ts"), join(project, "linked-main.ts"));

    const storage = nodeStorage();
    const catalog = new FileCatalog(new CanonicalProjectPathResolver(project, storage), storage);
    const page = await catalog.list(".");
    const directoryLink = page.entries.find((entry) => entry.name === "linked-src");
    const fileLink = page.entries.find((entry) => entry.name === "linked-main.ts");

    assert.equal(directoryLink?.kind, "symlink");
    assert.equal(directoryLink?.targetKind, "directory");
    assert.equal(fileLink?.kind, "symlink");
    assert.equal(fileLink?.targetKind, "file");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function nodeStorage() {
  return {
    realpath: (path) => realpath(path),
    stat: async (path) => toPathStat(await stat(path)),
    lstat: async (path) => toPathStat(await lstat(path)),
    readDirectory: async (path) =>
      (await readdir(path, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        isSymbolicLink: entry.isSymbolicLink(),
      })),
    readRange: async (path, offset, length) => {
      const handle = await open(path, "r");
      try {
        const bytes = new Uint8Array(length);
        const { bytesRead } = await handle.read(bytes, 0, length, offset);
        return bytes.slice(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
    makeDirectory: (path) => mkdir(path),
    rename: (from, to) => rename(from, to),
    remove: (path, options) => rm(path, { recursive: options?.recursive === true }),
    atomicWrite: (path, bytes) => writeFile(path, bytes),
  };
}

function toPathStat(value) {
  return {
    isFile: value.isFile(),
    isDirectory: value.isDirectory(),
    isSymbolicLink: value.isSymbolicLink(),
    size: value.size,
    mtimeMs: value.mtimeMs,
    mode: value.mode,
  };
}

async function git(args, cwd) {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}
