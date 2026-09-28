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

/** Content hash of the base image's inputs: each path and its bytes. */
export async function e2eBaseImageKey() {
	const hash = createHash('sha256');
	for (const input of await e2eBaseImageInputs()) {
		hash.update(`${input}\0`);
		hash.update(await readFile(input));
		hash.update('\0');
	}
	return hash.digest('hex');
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.stdout.write(await e2eBaseImageKey());
}
