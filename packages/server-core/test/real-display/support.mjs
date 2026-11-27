/**
 * A bot desktop service wired to a real display server, for tests that must
 * see what the display itself does. The engine is a stand-in: its exec tunnel
 * is a child process that pipes its stdio to the display's loopback RFB port,
 * which is what `terminay-init --tunnel` does inside a bot container.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { BotDesktopService } from '../../dist/botService/index.js';

export const botId = 'abc123def456';

const tunnel = `
const socket = require('node:net').connect(Number(process.argv[1]), '127.0.0.1');
process.stdin.pipe(socket);
socket.pipe(process.stdout);
socket.on('close', () => process.exit(0));
socket.on('error', () => process.exit(1));
process.stdin.on('end', () => socket.end());
`;

function vncconfig() {
	for (const name of ['tigervncconfig', 'vncconfig'])
		for (const dir of (process.env.PATH ?? '').split(':'))
			if (existsSync(path.join(dir, name))) return path.join(dir, name);
	throw new Error('vncconfig not found');
}

/** `passwords` maps a desktop mode to the password the service is handed. */
export function botDesktop(display, port, passwords) {
	const tunnels = [];
	const service = new BotDesktopService({
		engine: async () => ({
			exec: async (_container, command) => {
				// The service addresses the bot's display `:1`; here it is ours.
				const argv = command
					.slice(1)
					.map((part) => (part === ':1' ? display.display : part));
				return display.x(vncconfig(), argv);
			},
			execStream: () => {
				const child = spawn(process.execPath, ['-e', tunnel, String(port)], {
					stdio: ['pipe', 'pipe', 'pipe'],
				});
				tunnels.push(child);
				return child;
			},
		}),
		running: () => true,
		withPassword: async (_id, callback, mode) =>
			callback(
				Buffer.from(
					typeof passwords === 'function' ? passwords(mode) : passwords,
				),
			),
		activity: () => undefined,
	});
	return { service, tunnels };
}

let connection = 0;
export const authority = (controller = new AbortController()) => ({
	connectionId: `connection-${++connection}`,
	clientId: 'client',
	authScope: 'write',
	signal: controller.signal,
	assertCurrent: () => {},
});
