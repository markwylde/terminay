import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A directory of stub executables placed first on PATH.
 *
 * The CLI drives `systemctl`, `useradd`, `loginctl`, and `git` as external
 * programs, which is what makes it testable without a systemd host: the stub
 * records how it was called and returns whatever the test scripted.
 */

export async function createFakeBin() {
	const directory = await mkdtemp(join(tmpdir(), 'terminay-fake-bin-'));
	const log = join(directory, 'invocations.log');
	writeFileSync(log, '');
	return {
		directory,
		/**
		 * `script` is shell run after the invocation is logged. Use `exit` for a
		 * status and `echo` for stdout.
		 */
		install(name, script = '') {
			const path = join(directory, name);
			writeFileSync(
				path,
				`#!/bin/sh\nprintf '%s' "${name}" >> ${JSON.stringify(log)}\nfor a in "$@"; do printf ' %s' "$a" >> ${JSON.stringify(log)}; done\nprintf '\\n' >> ${JSON.stringify(log)}\n${script}\n`,
			);
			chmodSync(path, 0o755);
			return path;
		},
		invocations() {
			return readFileSync(log, 'utf8')
				.split('\n')
				.filter((line) => line.length > 0);
		},
		env(base = process.env) {
			return { ...base, PATH: `${directory}:${base.PATH ?? ''}` };
		},
		async close() {
			await rm(directory, { recursive: true, force: true });
		},
	};
}

export function writeExecutable(path, contents) {
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, contents);
	chmodSync(path, 0o755);
}
