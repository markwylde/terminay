import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readFile, readdir, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { activate, activeVersion, installArchive, installedVersions, retain, rollback } from '../dist/install.js';
import { installLayout, parseInstallRecord, readInstallRecord, stagedName, writeInstallRecord } from '../dist/layout.js';
import { ManifestError, validateUnpackedArchive } from '../dist/manifest.js';
import { buildArchiveFixture } from './archive-fixture.mjs';

async function withPrefix(run) {
	const home = await mkdtemp(join(tmpdir(), 'terminay-install-'));
	try {
		await run(installLayout('user', home), home);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
}

test('the layout puts every version under versions/ with current as the only pointer', () => {
	const system = installLayout('system');
	assert.equal(system.prefix, '/opt/terminay');
	assert.equal(system.versionsDirectory, '/opt/terminay/versions');
	assert.equal(system.currentLink, '/opt/terminay/current');
	assert.equal(system.environmentFile, '/etc/terminay/server.env');
	assert.equal(system.defaultDataRoot, '/var/lib/terminay');
	assert.equal(system.unitPath, '/etc/systemd/system/terminay-server.service');

	const user = installLayout('user', '/home/ada');
	assert.equal(user.prefix, '/home/ada/.local/share/terminay');
	assert.equal(user.environmentFile, '/home/ada/.config/terminay/server.env');
	assert.equal(user.defaultDataRoot, '/home/ada/.local/share/terminay/data');
	assert.equal(user.unitPath, '/home/ada/.config/systemd/user/terminay-server.service');
});

test('a fresh install lands under versions/<version> and current points at it', async () => {
	await withPrefix(async (layout, home) => {
		const fixture = await buildArchiveFixture({ directory: home });
		const installed = await installArchive({ layout, archivePath: fixture.archivePath, channel: 'tag' });
		assert.equal(installed.name, '4.1.1');
		assert.equal(installed.directory, join(layout.versionsDirectory, '4.1.1'));
		assert.equal(installed.manifest.version, '4.1.1');

		await activate(layout, installed.name);
		assert.equal(await activeVersion(layout), '4.1.1');
		assert.equal(await readlink(layout.currentLink), 'versions/4.1.1');
		// Reached through the link, which is what the unit's ExecStart uses.
		assert.ok((await stat(join(layout.currentLink, 'bin/terminay-server'))).isFile());
	});
});

test('permissions keep the installed tree readable and the launcher executable', async () => {
	await withPrefix(async (layout, home) => {
		const fixture = await buildArchiveFixture({ directory: home });
		const installed = await installArchive({ layout, archivePath: fixture.archivePath, channel: 'tag' });
		assert.equal((await stat(installed.directory)).mode & 0o777, 0o755);
		assert.ok(((await stat(join(installed.directory, 'bin/terminay-server'))).mode & 0o111) !== 0);
	});
});

test('an archive whose payload does not match its manifest is refused', async () => {
	await withPrefix(async (layout, home) => {
		const fixture = await buildArchiveFixture({ directory: home });
		// Swap the payload for one of exactly the same length, so the digest —
		// not the size — is what has to catch it.
		const original = await readFile(join(fixture.root, 'server/dist/cli.js'), 'utf8');
		const tampered = '// terminay server 9.9.9\n';
		assert.equal(tampered.length, original.length);
		await writeFile(join(fixture.root, 'server/dist/cli.js'), tampered);
		const { execFile } = await import('node:child_process');
		const { promisify } = await import('node:util');
		await promisify(execFile)('tar', ['-czf', fixture.archivePath, '-C', home, fixture.rootName]);

		await assert.rejects(
			() => installArchive({ layout, archivePath: fixture.archivePath, channel: 'tag' }),
			(error) => error instanceof ManifestError && /does not match the digest/u.test(error.message),
		);
		assert.deepEqual(await installedVersions(layout), [], 'a refused archive must leave nothing installed');
	});
});

test('an archive whose release coordinates differ from what was asked for is refused', async () => {
	await withPrefix(async (layout, home) => {
		const fixture = await buildArchiveFixture({ directory: home });
		await assert.rejects(
			() =>
				installArchive({
					layout,
					archivePath: fixture.archivePath,
					channel: 'tag',
					expected: { architecture: 'arm64' },
				}),
			(error) => error instanceof ManifestError && /architecture/u.test(error.message),
		);
	});
});

test('a manifest listing a symbolic link is refused', async () => {
	await withPrefix(async (layout, home) => {
		const fixture = await buildArchiveFixture({ directory: home });
		const { symlink, rm: remove } = await import('node:fs/promises');
		await remove(join(fixture.root, 'ui-placeholder'));
		await symlink('/etc/shadow', join(fixture.root, 'ui-placeholder'));
		const { execFile } = await import('node:child_process');
		const { promisify } = await import('node:util');
		await promisify(execFile)('tar', ['-czf', fixture.archivePath, '-C', home, fixture.rootName]);

		await assert.rejects(
			() => installArchive({ layout, archivePath: fixture.archivePath, channel: 'tag' }),
			(error) => error instanceof ManifestError && /symbolic link/u.test(error.message),
		);
	});
});

test('rolling installs are named for the commit so two builds can coexist', async () => {
	await withPrefix(async (layout, home) => {
		const first = await buildArchiveFixture({
			directory: home,
			version: 'main',
			channel: 'main',
			revision: 'a'.repeat(40),
		});
		const installedFirst = await installArchive({ layout, archivePath: first.archivePath, channel: 'main' });
		assert.equal(installedFirst.name, `main-${'a'.repeat(12)}`);

		const second = await mkdtemp(join(tmpdir(), 'terminay-rolling-'));
		const next = await buildArchiveFixture({
			directory: second,
			version: 'main',
			channel: 'main',
			revision: 'b'.repeat(40),
		});
		const installedSecond = await installArchive({ layout, archivePath: next.archivePath, channel: 'main' });
		assert.equal(installedSecond.name, `main-${'b'.repeat(12)}`);
		assert.deepEqual(await installedVersions(layout), [`main-${'a'.repeat(12)}`, `main-${'b'.repeat(12)}`]);
		await rm(second, { recursive: true, force: true });

		assert.equal(stagedName('tag', '4.1.1', 'f'.repeat(40)), '4.1.1');
	});
});

test('activation is atomic: current always names a complete version', async () => {
	await withPrefix(async (layout, home) => {
		const first = await buildArchiveFixture({ directory: home, version: '4.1.0' });
		await installArchive({ layout, archivePath: first.archivePath, channel: 'tag' });
		await activate(layout, '4.1.0');

		const second = await mkdtemp(join(tmpdir(), 'terminay-upgrade-'));
		const next = await buildArchiveFixture({ directory: second, version: '4.1.1' });

		// Staging the new version must not disturb the running one.
		await installArchive({ layout, archivePath: next.archivePath, channel: 'tag' });
		assert.equal(await activeVersion(layout), '4.1.0', 'staging must not move current');
		assert.ok((await stat(join(layout.currentLink, 'bin/terminay-server'))).isFile());

		await activate(layout, '4.1.1');
		assert.equal(await activeVersion(layout), '4.1.1');
		assert.equal((await lstat(layout.currentLink)).isSymbolicLink(), true);

		// No temporary link is left behind for a later command to trip over.
		const entries = await readdir(layout.prefix);
		assert.ok(!entries.includes('current.tmp'));

		await rollback(layout, '4.1.0');
		assert.equal(await activeVersion(layout), '4.1.0');
		assert.ok((await stat(join(layout.currentLink, 'bin/terminay-server'))).isFile());
		await rm(second, { recursive: true, force: true });
	});
});

test('activating a version that is not installed fails without moving current', async () => {
	await withPrefix(async (layout, home) => {
		const fixture = await buildArchiveFixture({ directory: home });
		await installArchive({ layout, archivePath: fixture.archivePath, channel: 'tag' });
		await activate(layout, '4.1.1');
		await assert.rejects(() => activate(layout, '9.9.9'), /not installed/u);
		assert.equal(await activeVersion(layout), '4.1.1');
	});
});

test('retention keeps the active version and one previous', async () => {
	await withPrefix(async (layout, home) => {
		for (const version of ['4.0.0', '4.1.0', '4.1.1']) {
			const directory = await mkdtemp(join(tmpdir(), 'terminay-retain-'));
			const fixture = await buildArchiveFixture({ directory, version });
			await installArchive({ layout, archivePath: fixture.archivePath, channel: 'tag' });
			await rm(directory, { recursive: true, force: true });
		}
		await activate(layout, '4.1.1');
		const removed = await retain(layout, ['4.1.1', '4.1.0']);
		assert.deepEqual(removed, ['4.0.0']);
		assert.deepEqual(await installedVersions(layout), ['4.1.0', '4.1.1']);
		assert.equal(await activeVersion(layout), '4.1.1');
	});
});

test('installed versions are never edited: only files outside versions/ change', async () => {
	await withPrefix(async (layout, home) => {
		const fixture = await buildArchiveFixture({ directory: home });
		const installed = await installArchive({ layout, archivePath: fixture.archivePath, channel: 'tag' });
		await activate(layout, installed.name);

		const before = await validateUnpackedArchive(installed.directory);

		await writeInstallRecord(layout, {
			schemaVersion: 1,
			scope: 'user',
			channel: 'tag',
			version: '4.1.1',
			revision: installed.manifest.revision,
			runAs: 'ada',
			dataRoot: layout.defaultDataRoot,
			projectRoot: '/home/ada',
			port: 8443,
			healthPort: 8444,
			expose: 'hosted,direct',
			hostedDomain: 'terminay.com',
			installedAt: new Date().toISOString(),
		});

		// The versioned directory still matches its manifest byte for byte.
		const after = await validateUnpackedArchive(installed.directory);
		assert.deepEqual(after, before);
		const record = await readInstallRecord(layout);
		assert.equal(record.version, '4.1.1');
		assert.equal(record.channel, 'tag');
		assert.ok(layout.recordPath.startsWith(layout.prefix));
		assert.ok(!layout.recordPath.startsWith(layout.versionsDirectory));
	});
});

test('an unreadable install record is refused rather than half-believed', () => {
	assert.throws(() => parseInstallRecord({ schemaVersion: 2 }), /unsupported schema version/u);
	assert.throws(() => parseInstallRecord({ schemaVersion: 1 }), /missing scope/u);
	assert.throws(() => parseInstallRecord(null), /not readable/u);
});

test('an archive with no manifest is refused', async () => {
	await withPrefix(async (layout, home) => {
		const { mkdir } = await import('node:fs/promises');
		const rootName = 'terminay-server-0.0.0-linux-x64';
		await mkdir(join(home, rootName, 'bin'), { recursive: true });
		await writeFile(join(home, rootName, 'bin/terminay-server'), '#!/bin/sh\n');
		await chmod(join(home, rootName, 'bin/terminay-server'), 0o755);
		const archivePath = join(home, 'empty.tar.gz');
		const { execFile } = await import('node:child_process');
		const { promisify } = await import('node:util');
		await promisify(execFile)('tar', ['-czf', archivePath, '-C', home, rootName]);

		await assert.rejects(
			() => installArchive({ layout, archivePath, channel: 'tag' }),
			(error) => error instanceof ManifestError && /artifact-manifest\.json/u.test(error.message),
		);
	});
});
