/**
 * A real TigerVNC display server for tests, on a private display number, with
 * helpers that read what the display itself holds: pointer position, held
 * keys and buttons, screen size, clipboard.
 *
 * Tests that need it skip when the machine has no display server; they run in
 * the container `scripts/run-real-display-tests.sh` builds.
 */

import { execFile, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

function which(...names) {
	for (const name of names) {
		for (const dir of (process.env.PATH ?? '').split(':')) {
			const candidate = path.join(dir, name);
			if (existsSync(candidate)) return candidate;
		}
	}
	return undefined;
}

export const displayServerBinary = () => which('Xtigervnc', 'Xvnc');

/** Why real-display tests cannot run here, or undefined when they can. */
export function realDisplayUnavailable() {
	if (process.platform !== 'linux') return 'needs Linux';
	const missing = [
		['Xtigervnc', displayServerBinary()],
		['vncpasswd', which('vncpasswd', 'tigervncpasswd')],
		['xauth', which('xauth')],
		['xdotool', which('xdotool')],
		['xinput', which('xinput')],
		['xclip', which('xclip')],
		['xdpyinfo', which('xdpyinfo')],
	]
		.filter(([, found]) => !found)
		.map(([name]) => name);
	return missing.length ? `missing ${missing.join(', ')}` : undefined;
}

/** The display server's package version, such as `1.12.0+dfsg-8`. */
export function displayServerVersion() {
	try {
		return execFileSync(
			'dpkg-query',
			// dpkg-query's own placeholder, not a template string.
			['-W', ['-f=$', '{Version}'].join(''), 'tigervnc-standalone-server'],
			{ encoding: 'utf8' },
		).trim();
	} catch {
		return 'unknown';
	}
}

let nextDisplay = 870 + (process.pid % 40);

/** A display number no display server on this machine holds. Test files run
 * in separate processes, so the lock file is what tells them apart. */
function freeDisplayNumber() {
	while (
		existsSync(`/tmp/.X${nextDisplay}-lock`) ||
		existsSync(`/tmp/.X11-unix/X${nextDisplay}`)
	)
		nextDisplay++;
	return nextDisplay++;
}

/**
 * Start a display server. `listen` picks how RFB is reached:
 * `{ unix: true }` for an owner-only socket and no TCP listener, or
 * `{ tcp: port }` for loopback TCP as the bot image runs it.
 */
export async function startDisplay({
	listen = { unix: true },
	passwords = ['fullpass', 'viewpass'],
	geometry = '1280x800',
	extraArgs = [],
	launcher = [],
} = {}) {
	const directory = await mkdtemp(path.join(tmpdir(), 'terminay-display-'));
	await chmod(directory, 0o700);
	const number = freeDisplayNumber();
	const display = `:${number}`;
	const cookie = path.join(directory, 'Xauthority');
	await writeFile(cookie, '', { mode: 0o600 });
	await run('xauth', [
		'-f',
		cookie,
		'add',
		display,
		'.',
		randomBytes(16).toString('hex'),
	]);
	const passwordFile = path.join(directory, 'passwd');
	const obfuscated = await new Promise((resolve, reject) => {
		const child = spawn(which('vncpasswd', 'tigervncpasswd'), ['-f'], {
			stdio: ['pipe', 'pipe', 'ignore'],
		});
		const chunks = [];
		child.stdout.on('data', (chunk) => chunks.push(chunk));
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0
				? resolve(Buffer.concat(chunks))
				: reject(new Error('vncpasswd failed')),
		);
		child.stdin.end(`${passwords.join('\n')}\n`);
	});
	await writeFile(passwordFile, obfuscated, { mode: 0o600 });
	const socket = path.join(directory, 'rfb.sock');
	const args = [
		display,
		...(listen.unix
			? ['-rfbport', '-1', '-rfbunixpath', socket, '-rfbunixmode', '0600']
			: ['-rfbport', String(listen.tcp), '-localhost', 'yes']),
		'-nolisten',
		'tcp',
		'-auth',
		cookie,
		'-SecurityTypes',
		'VncAuth',
		'-PasswordFile',
		passwordFile,
		'-geometry',
		geometry,
		'-depth',
		'24',
		'-AlwaysShared',
		'-SendPrimary=0',
		'-MaxCutText=1048576',
		...extraArgs,
	];
	const command = [...launcher, displayServerBinary(), ...args];
	const log = [];
	const child = spawn(command[0], command.slice(1), {
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	child.stdout.on('data', (chunk) => log.push(chunk));
	child.stderr.on('data', (chunk) => log.push(chunk));
	const env = { ...process.env, DISPLAY: display, XAUTHORITY: cookie };
	const x = async (file, argv, options = {}) =>
		(await run(file, argv, { env, timeout: 10_000, ...options })).stdout;
	const deadline = Date.now() + 15_000;
	while (true) {
		if (child.exitCode !== null)
			throw new Error(
				`display server exited: ${Buffer.concat(log).toString().slice(-600)}`,
			);
		try {
			await x('xdpyinfo', []);
			if (!listen.unix || existsSync(socket)) break;
		} catch {
			// Not up yet.
		}
		if (Date.now() > deadline)
			throw new Error(
				`display server did not start: ${Buffer.concat(log).toString().slice(-600)}`,
			);
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	const devices = async () => {
		const list = await x('xinput', ['list']);
		const id = (kind) =>
			list
				.split('\n')
				.filter(
					(line) =>
						line.toLowerCase().includes(kind) &&
						!line.toLowerCase().includes('virtual core'),
				)
				.map((line) => /id=(\d+)/.exec(line)?.[1])
				.find(Boolean);
		return { keyboard: id('keyboard'), pointer: id('pointer') };
	};
	return {
		display,
		number,
		directory,
		cookie,
		socket,
		pid: child.pid,
		env,
		passwords: {
			full: Buffer.from(passwords[0]),
			viewOnly: Buffer.from(passwords[1] ?? ''),
		},
		log: () => Buffer.concat(log).toString(),
		x,
		/** Pointer position as `{ x, y }`. */
		async pointer() {
			const out = await x('xdotool', ['getmouselocation']);
			const match = /x:(\d+) y:(\d+)/.exec(out);
			return { x: Number(match[1]), y: Number(match[2]) };
		},
		/** Names of keys and buttons the display holds down, such as `key[50]`. */
		async held() {
			const { keyboard, pointer } = await devices();
			const lines = [];
			for (const id of [keyboard, pointer]) {
				if (!id) continue;
				const state = await x('xinput', ['query-state', id]);
				for (const line of state.split('\n')) {
					const match = /((?:key|button)\[\d+\])=down/.exec(line);
					if (match) lines.push(match[1]);
				}
			}
			return lines.sort();
		},
		async size() {
			const out = await x('xdpyinfo', []);
			return /dimensions:\s+(\d+x\d+)/.exec(out)[1];
		},
		/** Put text on the display's CLIPBOARD selection, as a program would. */
		async setClipboard(text) {
			await new Promise((resolve, reject) => {
				const owner = spawn('xclip', ['-selection', 'clipboard'], {
					env,
					stdio: ['pipe', 'ignore', 'ignore'],
				});
				owner.on('error', reject);
				owner.on('close', resolve);
				owner.stdin.end(text);
			});
		},
		async stop() {
			child.kill('SIGTERM');
			await new Promise((resolve) => {
				if (child.exitCode !== null) return resolve();
				const force = setTimeout(() => child.kill('SIGKILL'), 3_000);
				child.once('close', () => {
					clearTimeout(force);
					resolve();
				});
			});
			await rm(directory, { recursive: true, force: true });
			await rm(`/tmp/.X${number}-lock`, { force: true });
			await rm(`/tmp/.X11-unix/X${number}`, { force: true });
		},
	};
}
