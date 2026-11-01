import { readFileSync } from 'node:fs';

/** True once `pid` has ended. A zombie counts as ended: in a container whose
 * init does not reap, a killed orphan stays a zombie, and `kill(pid, 0)`
 * still succeeds on it. */
function ended(pid) {
	try {
		process.kill(pid, 0);
	} catch (error) {
		return error.code === 'ESRCH';
	}
	try {
		// Field 3 of /proc/<pid>/stat is the state; the name in () may hold spaces.
		const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
		return stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z');
	} catch {
		return false;
	}
}

/** Waits up to `ms` for `pid` to end, since a SIGKILL lands asynchronously. */
export async function processEnded(pid, ms = 2000) {
	const deadline = Date.now() + ms;
	while (!ended(pid)) {
		if (Date.now() > deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return true;
}
