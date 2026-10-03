#!/usr/bin/env node
// Run shell commands that share no outputs at the same time.
//
// Each command's output is held and printed whole when it ends, so the
// commands do not interleave in a log. The first failure ends the others and
// becomes this process's exit status.
//
// Usage: node scripts/run-together.mjs '<command>' '<command>' ...
import { spawn } from 'node:child_process';

const commands = process.argv.slice(2);
if (commands.length === 0) {
	process.stderr.write("usage: run-together.mjs '<command>' '<command>' ...\n");
	process.exit(64);
}

const children = new Set();
let failure = 0;

function stopOthers() {
	for (const child of children) {
		try {
			// A command is a shell with children of its own; end the group.
			process.kill(-child.pid, 'SIGTERM');
		} catch {
			/* already gone */
		}
	}
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
	process.on(signal, () => {
		failure ||= 130;
		stopOthers();
	});
}

await Promise.all(
	commands.map(
		(command) =>
			new Promise((resolve) => {
				const child = spawn('sh', ['-c', command], {
					detached: true,
					stdio: ['ignore', 'pipe', 'pipe'],
				});
				children.add(child);
				const chunks = [];
				child.stdout.on('data', (chunk) => chunks.push(chunk));
				child.stderr.on('data', (chunk) => chunks.push(chunk));
				child.on('error', (error) => {
					chunks.push(Buffer.from(`${error.message}\n`));
				});
				child.on('close', (status, signal) => {
					children.delete(child);
					process.stdout.write(`\n> ${command}\n`);
					process.stdout.write(Buffer.concat(chunks));
					const code = status ?? (signal ? 1 : 0);
					if (code !== 0 && failure === 0) {
						failure = code;
						process.stdout.write(`\n${command} failed (${signal ?? code})\n`);
						stopOthers();
					}
					resolve();
				});
			}),
	),
);

process.exit(failure);
