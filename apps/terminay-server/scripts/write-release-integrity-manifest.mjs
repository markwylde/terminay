import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distRoot = join(packageRoot, 'dist');
const packageJson = JSON.parse(
	await readFile(join(packageRoot, 'package.json'), 'utf8'),
);
const files = await listReleaseFiles(distRoot);

if (!files.some((path) => path.endsWith('.js')))
	throw new Error('standalone release bundle has no JavaScript files');

const manifest = {
	schemaVersion: 1,
	packageName: packageJson.name,
	version: packageJson.version,
	files: await Promise.all(
		files.map(async (path) => {
			const bytes = await readFile(join(distRoot, path));
			return {
				path,
				size: bytes.byteLength,
				sha256: createHash('sha256').update(bytes).digest('hex'),
			};
		}),
	),
};

await writeFile(
	join(distRoot, 'release-integrity.json'),
	`${JSON.stringify(manifest, null, 2)}\n`,
);

async function listReleaseFiles(root, current = root) {
	const entries = await readdir(current, { withFileTypes: true });
	const paths = [];
	for (const entry of entries) {
		const target = join(current, entry.name);
		const metadata = await lstat(target);
		if (metadata.isSymbolicLink())
			throw new Error(`release bundle contains symlink: ${target}`);
		if (entry.isDirectory())
			paths.push(...(await listReleaseFiles(root, target)));
		else if (entry.isFile() && entry.name !== 'release-integrity.json') {
			const path = relative(root, target);
			if (path.startsWith(`..${sep}`) || path === '..')
				throw new Error('release file escapes dist');
			paths.push(path);
		}
	}
	return paths.sort((left, right) => left.localeCompare(right));
}
