import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/**
 * The files Dockerfile.e2e-base reads: the Dockerfile itself and every COPY
 * source. Derived from the Dockerfile so a new COPY cannot be left out of the
 * key; the contract test checks the derivation.
 */
export async function e2eBaseImageInputs(dockerfile = 'Dockerfile.e2e-base') {
	const source = await readFile(dockerfile, 'utf8');
	const inputs = new Set([dockerfile]);
	for (const line of source.split('\n')) {
		const match = /^COPY\s+(?:--\S+\s+)*(.+)$/u.exec(line.trim());
		if (match === null) continue;
		const parts = match[1].trim().split(/\s+/u);
		for (const part of parts.slice(0, -1))
			inputs.add(part.replace(/^\.\//u, ''));
	}
	return [...inputs].sort();
}

/** The scripts npm runs while installing; every other script is inert then. */
const INSTALL_SCRIPTS = new Set([
	'preinstall',
	'install',
	'postinstall',
	'prepublish',
	'preprepare',
	'prepare',
	'postprepare',
]);

/**
 * What an input contributes to the base image. A manifest contributes
 * everything except the scripts npm does not run during an install: the base
 * holds installed dependencies, and the per-commit image copies the real
 * manifest over the one the base was built with. Adding a test to an npm
 * script therefore leaves the base, and every runner's copy of it, in place.
 */
export function e2eBaseImageInputContent(input, bytes) {
	if (!/(?:^|\/)package\.json$/u.test(input)) return bytes;
	const manifest = JSON.parse(bytes.toString('utf8'));
	if (manifest.scripts !== undefined) {
		manifest.scripts = Object.fromEntries(
			Object.entries(manifest.scripts).filter(([name]) =>
				INSTALL_SCRIPTS.has(name),
			),
		);
	}
	return Buffer.from(JSON.stringify(manifest));
}

/** Content hash of the base image's inputs: each path and what it contributes. */
export async function e2eBaseImageKey() {
	const hash = createHash('sha256');
	for (const input of await e2eBaseImageInputs()) {
		hash.update(`${input}\0`);
		hash.update(e2eBaseImageInputContent(input, await readFile(input)));
		hash.update('\0');
	}
	return hash.digest('hex');
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.stdout.write(await e2eBaseImageKey());
}
