import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const viteCommand = process.platform === 'win32' ? 'vite.cmd' : 'vite';

const children = [
	spawn(
		npmCommand,
		[
			'exec',
			'--',
			'vite',
			'build',
			'--watch',
			'--config',
			'vite.server-ui.config.ts',
		],
		{ stdio: 'inherit' },
	),
	spawn(viteCommand, [], { stdio: 'inherit' }),
];

let stopping = false;
function stop(signal = 'SIGTERM') {
	if (stopping) return;
	stopping = true;
	for (const child of children) {
		if (child.exitCode === null && child.signalCode === null)
			child.kill(signal);
	}
}

for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, () => stop(signal));
}

const exits = children.map(
	(child) =>
		new Promise((resolve) => {
			child.once('error', (error) => resolve({ code: 1, error }));
			child.once('exit', (code, signal) =>
				resolve({ code: code ?? (signal === null ? 1 : 0) }),
			);
		}),
);

const firstExit = await Promise.race(exits);
stop();
await Promise.all(exits);
if (firstExit.error !== undefined) {
	console.error(firstExit.error);
}
process.exitCode = firstExit.code;
