import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const [outputDirectory, sourceRevision] = process.argv.slice(2);
if (!outputDirectory || !sourceRevision) {
	throw new Error(
		'usage: write-web-release-marker.mjs <output-directory> <source-revision>',
	);
}
if (sourceRevision !== 'local' && !/^[0-9a-f]{40}$/u.test(sourceRevision)) {
	throw new Error(
		'source revision must be "local" or a full lowercase Git revision',
	);
}

const markerDirectory = resolve(outputDirectory, '.well-known');
await mkdir(markerDirectory, { recursive: true });
await writeFile(
	resolve(markerDirectory, 'terminay-release.json'),
	`${JSON.stringify({ product: 'terminay-web', sourceRevision, schemaVersion: 1 })}\n`,
	{ encoding: 'utf8', mode: 0o644 },
);
