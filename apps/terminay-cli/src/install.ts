import { execFile } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';

import type { InstallLayout } from './layout.js';
import { stagedName } from './layout.js';
import { type ArchiveManifest, type ExpectedRelease, validateUnpackedArchive } from './manifest.js';
import type { ReleaseChannel } from './resolve.js';

/**
 * Laying a verified archive down on disk, and switching between versions
 * without ever pointing `current` at something incomplete.
 *
 * Unpack, verify, then rename: the new version is fully present and hashed
 * before anything references it, and the reference itself changes in a single
 * atomic step. An interrupt at any point leaves `current` pointing at a
 * complete version — either the old one or the new one, never a half-built
 * directory.
 */

const execFileAsync = promisify(execFile);

export interface InstalledVersion {
	readonly directory: string;
	readonly name: string;
	readonly manifest: ArchiveManifest;
}

/**
 * The archive contains a single top-level directory. It is extracted into a
 * scratch directory first so a failed or partial unpack never appears under
 * `versions/`, where the next command would treat it as installed.
 */
export async function installArchive(options: {
	readonly layout: InstallLayout;
	readonly archivePath: string;
	readonly channel: ReleaseChannel;
	readonly expected?: ExpectedRelease;
}): Promise<InstalledVersion> {
	const { layout, archivePath } = options;
	await mkdir(layout.versionsDirectory, { recursive: true, mode: 0o755 });
	const scratch = await mkdtemp(join(layout.versionsDirectory, '.staging-'));
	try {
		await execFileAsync('tar', ['-xzf', archivePath, '-C', scratch], { maxBuffer: 8 * 1024 * 1024 });
		const entries = await readdir(scratch, { withFileTypes: true });
		const roots = entries.filter((entry) => entry.isDirectory());
		if (roots.length !== 1 || entries.length !== roots.length) {
			throw new Error('the server archive does not contain exactly one top-level directory');
		}
		const unpacked = join(scratch, (roots[0] as { name: string }).name);
		const manifest = await validateUnpackedArchive(unpacked, options.expected ?? {});
		const name = stagedName(options.channel, manifest.version, manifest.revision);
		const directory = join(layout.versionsDirectory, name);
		// Re-installing the same version replaces it, because the payload was
		// just proven to match its signed manifest byte for byte.
		await rm(directory, { recursive: true, force: true });
		await rename(unpacked, directory);
		await chmod(directory, 0o755);
		return Object.freeze({ directory, name, manifest });
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

/** Point `current` at a version. Written beside the link, then renamed over it. */
export async function activate(layout: InstallLayout, versionName: string): Promise<void> {
	const target = join(layout.versionsDirectory, versionName);
	const info = await lstat(target).catch(() => undefined);
	if (info === undefined || !info.isDirectory()) throw new Error(`cannot activate ${versionName}: it is not installed`);
	await mkdir(dirname(layout.currentLink), { recursive: true, mode: 0o755 });
	const temporary = `${layout.currentLink}.tmp`;
	await rm(temporary, { force: true });
	// Relative, so the tree can be relocated and inspected without the link
	// dangling in a way that hides which version was active.
	await symlink(join('versions', versionName), temporary);
	await rename(temporary, layout.currentLink);
}

export async function activeVersion(layout: InstallLayout): Promise<string | undefined> {
	const target = await readlink(layout.currentLink).catch(() => undefined);
	return target === undefined ? undefined : basename(target);
}

/** Roll back to a version known to have run. Identical to activation. */
export async function rollback(layout: InstallLayout, versionName: string): Promise<void> {
	await activate(layout, versionName);
}

export async function installedVersions(layout: InstallLayout): Promise<readonly string[]> {
	const entries = await readdir(layout.versionsDirectory, { withFileTypes: true }).catch(() => []);
	return entries
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
		.map((entry) => entry.name)
		.sort();
}

/**
 * Keep the active version and one previous, so a bad upgrade always has
 * something proven to fall back to and disk use stays bounded.
 */
export async function retain(layout: InstallLayout, keep: readonly string[]): Promise<readonly string[]> {
	const kept = new Set(keep.filter((name) => name.length > 0));
	const removed: string[] = [];
	for (const name of await installedVersions(layout)) {
		if (kept.has(name)) continue;
		await rm(join(layout.versionsDirectory, name), { recursive: true, force: true });
		removed.push(name);
	}
	return removed;
}
