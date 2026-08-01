import {
	closeSync,
	existsSync,
	fsyncSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2];
const candidatePath = process.argv[3];
const failureBoundary = process.argv[4] ?? null;
const currentPath = join(directory, 'vault.current');
const previousPath = join(directory, 'vault.previous');
const temporaryPath = join(directory, 'vault.current.tmp');

function syncPath(path, flags) {
	const fd = openSync(path, flags);
	try {
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

function failAt(boundary) {
	if (failureBoundary === boundary) {
		process.kill(process.pid, 'SIGKILL');
	}
}

if (existsSync(temporaryPath)) {
	unlinkSync(temporaryPath);
}
writeFileSync(temporaryPath, readFileSync(candidatePath), { mode: 0o600 });
syncPath(temporaryPath, 'r');
failAt('temporary-synced');

if (existsSync(currentPath)) {
	if (existsSync(previousPath)) {
		unlinkSync(previousPath);
	}
	renameSync(currentPath, previousPath);
}
syncPath(directory, 'r');
failAt('previous-rotated');

renameSync(temporaryPath, currentPath);
syncPath(directory, 'r');
failAt('current-installed');
