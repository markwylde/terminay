// A portable command deadline for runners without GNU timeout (including macOS).
import { spawn } from 'node:child_process';

const [limit, command, ...args] = process.argv.slice(2);
const timeout = Number(limit);
if (!Number.isSafeInteger(timeout) || timeout <= 0 || !command) {
	throw new TypeError(
		'Usage: run-ci-command.mjs <milliseconds> <command> [args...]',
	);
}
const child = spawn(command, args, {
	stdio: 'inherit',
	detached: true,
});
let timedOut = false;
const killCommand = () => {
	if (child.pid === undefined) return;
	// Kill the whole command group, including lifecycle-script descendants.
	try {
		process.kill(-child.pid, 'SIGKILL');
	} catch (error) {
		if (error.code !== 'ESRCH') throw error;
	}
};
for (const [signal, code] of [
	['SIGINT', 130],
	['SIGTERM', 143],
]) {
	process.on(signal, () => {
		killCommand();
		process.exit(code);
	});
}
const timer = setTimeout(() => {
	timedOut = true;
	console.error(`CI command exceeded ${timeout}ms: ${command}`);
	killCommand();
}, timeout);
child.on('error', (error) => console.error(error.message));
child.on('close', (code) => {
	clearTimeout(timer);
	process.exit(timedOut ? 124 : (code ?? 1));
});
