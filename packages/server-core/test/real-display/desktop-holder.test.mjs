/**
 * The desktop holder on a real host: what it starts, what it exposes, and
 * what it leaves alone. Runs in the real-display container.
 */

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
	DESKTOP_SESSION_SCRIPT,
	DISPLAY_LAUNCHER_SCRIPT,
	desktopSessionDirectory,
} from '@terminay/remote-desktop/session';
import {
	adoptOrStartDesktopHolder,
	connectDesktopHolder,
	desktopHolderLockHeld,
	examineServerDesktopHost,
	hostFacts,
	serverDesktopPaths,
	xDisplayFiles,
} from '../../dist/serverDesktop/index.js';

const run = promisify(execFile);
const launcher = path.join(desktopSessionDirectory(), DISPLAY_LAUNCHER_SCRIPT);
const sessionScript = path.join(desktopSessionDirectory(), DESKTOP_SESSION_SCRIPT);
const skip =
	process.platform === 'linux' && existsSync('/usr/bin/Xtigervnc') && existsSync('/usr/bin/xfwm4')
		? undefined
		: 'needs the desktop packages';

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(t, options = {}) {
	const root = await mkdtemp(path.join(tmpdir(), 'tdh-'));
	const directory = path.join(root, 'd');
	const dataRoot = path.join(root, 'data');
	const home = path.join(root, 'home');
	await mkdir(dataRoot, { mode: 0o700 });
	await mkdir(home, { mode: 0o700 });
	const support = await examineServerDesktopHost(hostFacts(launcher));
	assert.equal(support.supported, true, JSON.stringify(support));
	assert.deepEqual(support.missing, []);
	const launch = {
		dataRoot,
		home,
		programs: {
			displayServer: support.programs.displayServer,
			passwordTool: support.programs.passwordTool,
			python: support.programs.python,
			shell: support.programs.shell,
		},
		launcher,
		sessionScript,
		env: { PATH: process.env.PATH, HOME: home, LANG: 'C.UTF-8' },
		...options,
	};
	const clients = [];
	const adopt = async () => {
		const adoption = await adoptOrStartDesktopHolder(directory, launch);
		if (adoption.outcome === 'ready') clients.push(adoption.client);
		return adoption;
	};
	t.after(async () => {
		// Stop whatever holder is left, through its own protocol.
		const connection = await connectDesktopHolder(directory);
		if (connection.outcome === 'adopted') await connection.client.stop();
		for (const client of clients) client.disconnect();
		await settle(200);
		await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});
	return { root, directory, dataRoot, home, launch, adopt, paths: serverDesktopPaths(directory) };
}

async function running(client, timeoutMs = 40_000) {
	const deadline = Date.now() + timeoutMs;
	while (true) {
		const state = await client.status();
		if (state.phase === 'running') return state;
		if (state.phase === 'failed') throw new Error(`holder failed: ${state.reason}`);
		if (Date.now() > deadline) throw new Error('holder did not reach running');
		await new Promise((resolve) => {
			const off = client.onState(() => {
				off();
				resolve();
			});
			setTimeout(resolve, 1000);
		});
	}
}

const pidOf = async (pattern) =>
	(await run('pgrep', ['-f', pattern]).then(
		({ stdout }) => stdout.trim().split('\n').filter(Boolean),
		() => [],
	)).map(Number);

async function listeners(flag) {
	const { stdout } = await run('ss', ['-H', flag]);
	return stdout.split('\n').filter(Boolean);
}

test('the holder starts a display with no TCP or UDP listener, owner-only files, and a session', { skip }, async (t) => {
	const f = await fixture(t);
	const tcpBefore = await listeners('-ltn');
	const udpBefore = await listeners('-lun');
	const adoption = await f.adopt();
	assert.equal(adoption.outcome, 'ready', JSON.stringify(adoption));
	assert.equal(adoption.started, true);
	const state = await running(adoption.client);
	assert.equal(state.display, 765);
	await settle(2500);

	assert.deepEqual(await listeners('-ltn'), tcpBefore);
	assert.deepEqual(await listeners('-lun'), udpBefore);
	assert.deepEqual(tcpBefore, []);

	// Every desktop file is the owner's alone, except the X socket and its
	// lock file, which have to be where every X client looks.
	const mode = async (file) => (await stat(file)).mode & 0o777;
	assert.equal(await mode(f.directory), 0o700);
	for (const name of await readdir(f.directory)) {
		const file = path.join(f.directory, name);
		const info = await stat(file);
		assert.equal(info.mode & 0o077, 0, `${name} is ${(info.mode & 0o777).toString(8)}`);
	}
	assert.equal(await mode(f.paths.rfb), 0o600);
	assert.equal(await mode(f.paths.cookie), 0o600);
	assert.equal(await mode(f.paths.passwords), 0o600);
	assert.equal(await mode(f.paths.secret), 0o600);
	assert.equal(existsSync(xDisplayFiles(765).socket), true);

	// The display server's command line: no TCP anywhere, and no secret.
	const [display] = await pidOf('Xtigervnc :765');
	const argv = (await readFile(`/proc/${display}/cmdline`, 'utf8')).split('\0');
	assert.deepEqual(argv.slice(argv.indexOf('-rfbport'), argv.indexOf('-rfbport') + 2), ['-rfbport', '-1']);
	assert.ok(argv.includes('-nolisten') && argv[argv.indexOf('-nolisten') + 1] === 'tcp');
	const credentials = await adoption.client.credentials();
	assert.notEqual(credentials.full.slice(0, 8), credentials.viewOnly.slice(0, 8));
	const secret = (await readFile(f.paths.secret, 'utf8')).trim();
	for (const pid of [display, ...(await pidOf('holderEntry.js'))]) {
		const text = await readFile(`/proc/${pid}/cmdline`, 'utf8');
		for (const hidden of [credentials.full, credentials.viewOnly, secret])
			assert.equal(text.includes(hidden), false, `pid ${pid} argv holds a secret`);
	}
	for (const log of [f.paths.displayLog, f.paths.sessionLog, f.paths.holderLog]) {
		const text = await readFile(log, 'utf8').catch(() => '');
		for (const hidden of [credentials.full, credentials.viewOnly, secret])
			assert.equal(text.includes(hidden), false, `${log} holds a secret`);
	}

	// The session is the shared one, with no extra services.
	const tree = await run('xwininfo', ['-root', '-tree'], {
		env: { DISPLAY: ':765', XAUTHORITY: f.paths.cookie, PATH: process.env.PATH },
	}).then(({ stdout }) => stdout);
	assert.match(tree, /xfwm4/i);
	assert.match(tree, /xfce4-panel/i);
	assert.equal(await adoption.client.windows(), 0);
});

test('the display server cannot open a network connection, and a program on the display can', { skip }, async (t) => {
	const f = await fixture(t);
	const adoption = await f.adopt();
	await running(adoption.client);
	const env = { DISPLAY: ':765', XAUTHORITY: f.paths.cookie, PATH: process.env.PATH };
	// A listening "viewer" on loopback.
	let accepted = 0;
	const viewer = createServer((socket) => {
		accepted += 1;
		socket.destroy();
	});
	await new Promise((resolve) => viewer.listen(0, '127.0.0.1', resolve));
	t.after(() => viewer.close());
	const port = viewer.address().port;
	// Ask the display server to dial out to it, as any X client can.
	const reverse = await run('vncconfig', ['-display', ':765', '-connect', `127.0.0.1::${port}`], {
		env,
		timeout: 15_000,
	}).then(
		({ stdout, stderr }) => ({ ok: true, text: stdout + stderr }),
		(error) => ({ ok: false, text: String(error.stderr ?? error.message) }),
	);
	await settle(1000);
	assert.equal(accepted, 0, `the display server reached the viewer: ${reverse.text}`);
	// The restriction is the display server's alone: a program on the display
	// still reaches the network.
	const client = await run(
		'python3',
		['-c', `import socket,os\nassert os.environ["DISPLAY"]==":765"\ns=socket.create_connection(("127.0.0.1",${port}),3)\ns.close()`],
		{ env, timeout: 10_000 },
	).then(
		() => true,
		() => false,
	);
	assert.equal(client, true);
	await settle(300);
	assert.equal(accepted, 1);
});

test('a display on 765 that Terminay did not start is left untouched, and the next number is used', { skip }, async (t) => {
	// Someone else's display server on :765.
	const foreignDirectory = await mkdtemp(path.join(tmpdir(), 'tdh-foreign-'));
	const foreign = spawn('Xtigervnc', [':765', '-rfbport', '-1', '-rfbunixpath', path.join(foreignDirectory, 'rfb.sock'), '-SecurityTypes', 'None', '-nolisten', 'tcp'], {
		stdio: 'ignore',
	});
	t.after(async () => {
		foreign.kill('SIGTERM');
		await settle(300);
		await rm(foreignDirectory, { recursive: true, force: true });
	});
	const files = xDisplayFiles(765);
	for (let i = 0; i < 50 && !existsSync(files.socket); i++) await settle(100);
	const before = { socket: (await stat(files.socket)).ino, lock: await readFile(files.lock, 'utf8') };

	const f = await fixture(t);
	const adoption = await f.adopt();
	const state = await running(adoption.client);
	assert.equal(state.display, 766);
	assert.equal(foreign.exitCode, null, 'the foreign display server is still running');
	assert.equal((await stat(files.socket)).ino, before.socket);
	assert.equal(await readFile(files.lock, 'utf8'), before.lock);
	assert.equal((await readFile(path.join(f.dataRoot, 'server-desktop-display'), 'utf8')).trim(), '766');
});

test('a server that comes back adopts the same holder: same display, same program, still running', { skip }, async (t) => {
	const f = await fixture(t);
	const first = await f.adopt();
	const state = await running(first.client);
	const env = { DISPLAY: `:${state.display}`, XAUTHORITY: f.paths.cookie, PATH: process.env.PATH };
	const program = spawn('xterm', ['-e', 'sleep', '600'], { env, stdio: 'ignore', detached: true });
	t.after(() => program.kill('SIGKILL'));
	for (let i = 0; i < 50 && (await first.client.windows()) < 1; i++) await settle(200);
	assert.equal(await first.client.windows(), 1);
	const [holderPid] = await pidOf('holderEntry.js');
	const [displayPid] = await pidOf(`Xtigervnc :${state.display}`);

	// The server goes away: its connection ends, nothing else.
	first.client.disconnect();
	await settle(500);

	const second = await f.adopt();
	assert.equal(second.outcome, 'ready');
	assert.equal(second.started, false, 'the running holder was adopted, not replaced');
	const again = await second.client.status();
	assert.deepEqual(again, state);
	assert.deepEqual(await pidOf('holderEntry.js'), [holderPid]);
	assert.deepEqual(await pidOf(`Xtigervnc :${state.display}`), [displayPid]);
	assert.equal(program.exitCode, null, 'the program kept running');
	assert.equal(await second.client.windows(), 1);
});

test('a killed display server is restarted on the same number with the same cookie, and the generation changes', { skip }, async (t) => {
	const f = await fixture(t);
	const adoption = await f.adopt();
	const state = await running(adoption.client);
	const cookie = await readFile(f.paths.cookie);
	const [displayPid] = await pidOf(`Xtigervnc :${state.display}`);
	const changed = new Promise((resolve) => {
		const off = adoption.client.onState((next) => {
			if (next.phase === 'running' && next.generation > state.generation) {
				off();
				resolve(next);
			}
		});
	});
	process.kill(displayPid, 'SIGKILL');
	const next = await Promise.race([
		changed,
		settle(40_000).then(() => {
			throw new Error('the display was not restarted');
		}),
	]);
	assert.equal(next.display, state.display);
	assert.equal(next.generation, state.generation + 1);
	assert.deepEqual(await readFile(f.paths.cookie), cookie);
	const [restarted] = await pidOf(`Xtigervnc :${state.display}`);
	assert.notEqual(restarted, displayPid);
});

test('a planted socket or record names nothing the server will trust; a lock held without the secret is not adopted', { skip }, async (t) => {
	const f = await fixture(t);
	await mkdir(f.directory, { mode: 0o700 });
	// A process that answers on the control socket but holds no credential.
	const victim = spawn('sleep', ['600'], { stdio: 'ignore' });
	t.after(() => victim.kill('SIGKILL'));
	await writeFile(path.join(f.directory, 'state.json'), JSON.stringify({ pid: victim.pid, socket: '/tmp/elsewhere.sock' }));
	const impostor = createServer((socket) => {
		socket.on('data', () => socket.write(`${JSON.stringify({ t: 'proof', version: 1, nonce: 'a'.repeat(64), proof: 'b'.repeat(64) })}\n`));
		socket.on('error', () => undefined);
	});
	await new Promise((resolve) => impostor.listen(f.paths.control, resolve));
	const connection = await connectDesktopHolder(f.directory);
	assert.equal(connection.outcome, 'unproven');
	assert.equal(victim.exitCode, null, 'the process named in the planted file was not signalled');

	// The same impostor, now also holding the lock: nothing is started beside it.
	const holder = spawn(process.execPath, ['-e', `
		const { DatabaseSync } = require('node:sqlite');
		const db = new DatabaseSync(${JSON.stringify(f.paths.lock)});
		db.exec('BEGIN EXCLUSIVE');
		process.stdout.write('held\\n');
		setInterval(() => {}, 1000);
	`], { stdio: ['ignore', 'pipe', 'ignore'] });
	t.after(() => holder.kill('SIGKILL'));
	await new Promise((resolve) => holder.stdout.once('data', resolve));
	assert.equal(await desktopHolderLockHeld(f.directory), true);
	const adoption = await f.adopt();
	assert.equal(adoption.outcome, 'failed');
	assert.match(adoption.reason, /could not be reached/);
	assert.deepEqual(await pidOf('Xtigervnc :765'), []);
	assert.equal(holder.exitCode, null, 'the lock holder was not signalled');
	assert.equal(victim.exitCode, null);
	holder.kill('SIGKILL');
	await new Promise((resolve) => impostor.close(resolve));
});

test('a stale socket left by a holder that is gone is cleaned up and a new holder starts', { skip }, async (t) => {
	const f = await fixture(t);
	await mkdir(f.directory, { mode: 0o700 });
	// What a reboot leaves: socket files nobody listens on, and an old secret.
	const stale = createServer();
	await new Promise((resolve) => stale.listen(f.paths.control, resolve));
	stale.unref();
	await new Promise((resolve) => {
		// Close the listener but keep its file, as a killed process does.
		stale.close(resolve);
	});
	await writeFile(f.paths.control, '');
	await writeFile(f.paths.rfb, '');
	assert.equal(await desktopHolderLockHeld(f.directory), false);
	const adoption = await f.adopt();
	assert.equal(adoption.outcome, 'ready', JSON.stringify(adoption));
	assert.equal(adoption.started, true);
	const state = await running(adoption.client);
	assert.equal(state.phase, 'running');
});

test('stop ends the session and the display server and leaves no holder, window, or socket', { skip }, async (t) => {
	const f = await fixture(t);
	const adoption = await f.adopt();
	const state = await running(adoption.client);
	await settle(1500);
	await adoption.client.stop();
	await settle(500);
	assert.deepEqual(await pidOf('holderEntry.js'), []);
	assert.deepEqual(await pidOf(`Xtigervnc :${state.display}`), []);
	assert.deepEqual(await pidOf('xfwm4|xfce4-panel|xfdesktop|xfsettingsd'), []);
	assert.equal(existsSync(f.paths.control), false);
	assert.equal(existsSync(f.paths.rfb), false);
	assert.equal(existsSync(f.paths.passwords), false);
	assert.equal(existsSync(xDisplayFiles(state.display).socket), false);
	assert.equal(await desktopHolderLockHeld(f.directory), false);
	assert.equal((await connectDesktopHolder(f.directory)).outcome, 'absent');
});
