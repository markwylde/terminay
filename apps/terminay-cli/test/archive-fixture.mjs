import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Builds a miniature server archive with the same shape the real builder
 * produces: one top-level directory, a launcher, and an artifact manifest that
 * hashes every regular file in the tree.
 */
export async function buildArchiveFixture(options) {
	const {
		directory,
		version = '4.1.1',
		channel = 'tag',
		revision = 'c'.repeat(40),
		architecture = 'x64',
		target = 'linux-x64',
		extraFiles = {},
	} = options;
	const rootName = `terminay-server-${version}-${target}`;
	const root = join(directory, rootName);
	await mkdir(join(root, 'bin'), { recursive: true });
	await mkdir(join(root, 'server/dist'), { recursive: true });
	await writeFile(join(root, 'bin/terminay-server'), `#!/bin/sh\n: "\${TERMINAY_SERVER_VERSION:=${version}}"\nexec true\n`);
	await chmod(join(root, 'bin/terminay-server'), 0o755);
	await writeFile(join(root, 'server/dist/cli.js'), `// terminay server ${version}\n`);
	await writeFile(join(root, 'ui-placeholder'), 'ui\n');
	for (const [path, contents] of Object.entries(extraFiles)) {
		await mkdir(join(root, path, '..'), { recursive: true });
		await writeFile(join(root, path), contents);
	}

	const files = [];
	for (const path of ['bin/terminay-server', 'server/dist/cli.js', 'ui-placeholder', ...Object.keys(extraFiles)]) {
		const absolute = join(root, path);
		const info = await stat(absolute);
		files.push({
			path,
			mode: (info.mode & 0o777).toString(8).padStart(3, '0'),
			size: info.size,
			sha256: createHash('sha256').update(await readFile(absolute)).digest('hex'),
		});
	}
	files.sort((left, right) => left.path.localeCompare(right.path));

	const manifest = {
		schemaVersion: 1,
		artifact: 'terminay-server',
		target,
		channel,
		revision,
		architecture,
		version,
		node: { version: '24.15.0' },
		entrypoints: { server: 'bin/terminay-server' },
		files,
	};
	await writeFile(join(root, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

	const archivePath = join(directory, `${rootName}.tar.gz`);
	await execFileAsync('tar', ['-czf', archivePath, '-C', directory, rootName]);
	return { archivePath, rootName, root, manifest };
}
