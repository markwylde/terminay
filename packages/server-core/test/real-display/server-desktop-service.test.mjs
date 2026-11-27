/**
 * The server desktop service against a real holder and a real display,
 * reached as a client reaches it: only through the service's operations.
 * Assertions read the display itself. Runs in the real-display container.
 */

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Duplex } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';
import { SERVER_DESKTOP_OPERATIONS as op } from '@terminay/protocol';
import { ENCODING, settle, Viewer } from '../../../remote-desktop/test/support/viewer.mjs';
import {
	handshakeProof,
	LineReader,
	newNonce,
	sendLine,
} from '../../dist/serverDesktop/holderProtocol.js';
import {
	connectDesktopHolder,
	ServerDesktopService,
	serverDesktopPaths,
} from '../../dist/serverDesktop/index.js';

const run = promisify(execFile);
const skip =
	process.platform === 'linux' && existsSync('/usr/bin/Xtigervnc') && existsSync('/usr/bin/xfwm4')
		? undefined
		: 'needs the desktop packages';
const SHIFT = 0xffe1;

async function fixture(t) {
	const root = await mkdtemp(path.join(tmpdir(), 'tds-'));
	const directory = path.join(root, 'd');
	const events = [];
	const service = new ServerDesktopService({
		eventJournal: { publishTransient: (event, payload) => events.push({ event, payload }) },
		directory,
		dataRoot: root,
		home: root,
		env: { PATH: process.env.PATH, HOME: root, LANG: 'C.UTF-8' },
		deviceName: (context) => `Device ${context.clientId}`,
		setup: {
			describe: async () => ({ means: 'command', command: 'sudo terminay daemon desktop install' }),
			running: async () => undefined,
			run: async () => ({ ok: false, reason: 'not used' }),
		},
	});
	const registry = service.operations();
	const context = (name) => ({
		connectionId: `conn-${name}`,
		clientId: `client-${name}`,
		authScope: 'write',
		signal: new AbortController().signal,
	});
	const command = (name, ctx, payload = {}, body = new Uint8Array()) =>
		registry.commands[name]({ envelope: { payload }, body, context: ctx });
	const query = (name, ctx, payload = {}) =>
		registry.queries[name]({ envelope: { payload }, body: new Uint8Array(), context: ctx });
	t.after(async () => {
		service.dispose();
		const connection = await connectDesktopHolder(directory);
		if (connection.outcome === 'adopted') await connection.client.stop();
		await settle(200);
		await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});
	const ready = async () => {
		const deadline = Date.now() + 40_000;
		while (true) {
			const { status } = await query(op.status, context('probe'));
			if (status.state === 'ready') return status;
			if (status.state === 'failed') throw new Error(`desktop failed: ${status.reason}`);
			if (Date.now() > deadline) throw new Error(`desktop stuck in ${status.state}`);
			await settle(200);
		}
	};
	/** A client's viewer over the service's own read and write operations. */
	const view = async (ctx, opening) => {
		const { handle, mode } = opening;
		const stream = new Duplex({
			read() {},
			write(chunk, _encoding, done) {
				command(op.write, ctx, handle, chunk).then(() => done(), done);
			},
			destroy(error, done) {
				command(op.close, ctx, handle).catch(() => undefined).finally(() => done(error));
			},
		});
		stream.on('error', () => undefined);
		(async () => {
			try {
				while (true) {
					const reply = await query(op.read, ctx, handle);
					if (reply.result.done) break;
					stream.push(Buffer.from(reply.body));
				}
			} catch {
				// The stream ended.
			}
			stream.push(null);
			stream.destroy();
		})();
		return { viewer: await new Viewer(stream).connect(), mode, handle };
	};
	const open = async (ctx, name = op.open, generation = 1) =>
		view(ctx, (await command(name, ctx, { generation })).result);
	return { root, directory, service, events, context, command, query, ready, open, paths: serverDesktopPaths(directory) };
}

function desktopTools(f, display) {
	const env = { PATH: process.env.PATH, DISPLAY: `:${display}`, XAUTHORITY: f.paths.cookie };
	const x = async (file, argv) => (await run(file, argv, { env, timeout: 10_000 })).stdout;
	return {
		env,
		x,
		async pointer() {
			const match = /x:(\d+) y:(\d+)/.exec(await x('xdotool', ['getmouselocation']));
			return { x: Number(match[1]), y: Number(match[2]) };
		},
		async held() {
			const list = await x('xinput', ['list']);
			const down = [];
			for (const line of list.split('\n')) {
				if (line.toLowerCase().includes('virtual core')) continue;
				const id = /id=(\d+)/.exec(line)?.[1];
				if (!id) continue;
				const state = await x('xinput', ['query-state', id]).catch(() => '');
				for (const row of state.split('\n')) {
					const match = /((?:key|button)\[\d+\])=down/.exec(row);
					if (match) down.push(match[1]);
				}
			}
			return down.sort();
		},
		async size() {
			return /dimensions:\s+(\d+x\d+)/.exec(await x('xdpyinfo', []))[1];
		},
		setClipboard(text) {
			return new Promise((resolve, reject) => {
				const owner = spawn('xclip', ['-selection', 'clipboard'], { env, stdio: ['pipe', 'ignore', 'ignore'] });
				owner.on('error', reject);
				owner.on('close', resolve);
				owner.stdin.end(text);
			});
		},
	};
}

test('the controller drives the real desktop; a viewer delivers no input, receives no clipboard, and cannot resize', { skip }, async (t) => {
	const f = await fixture(t);
	await f.service.start();
	const status = await f.ready();
	const tools = desktopTools(f, status.display);
	assert.deepEqual(f.service.displayEnvironment(), { DISPLAY: `:${status.display}`, XAUTHORITY: f.paths.cookie });

	const a = f.context('a');
	const b = f.context('b');
	const control = await f.open(a);
	assert.equal(control.mode, 'control');
	await control.viewer.pointer(50, 60, 0);
	await settle(400);
	assert.deepEqual(await tools.pointer(), { x: 50, y: 60 });

	const viewer = await f.open(b);
	assert.equal(viewer.mode, 'view-only');
	await viewer.viewer.setEncodings([ENCODING.raw, ENCODING.extendedClipboard, ENCODING.extendedDesktopSize]);
	await viewer.viewer.pointer(111, 222, 1);
	await viewer.viewer.key(SHIFT, true);
	await settle(400);
	assert.deepEqual(await tools.pointer(), { x: 50, y: 60 });
	assert.deepEqual(await tools.held(), []);
	const before = await tools.size();
	await viewer.viewer.resize(900, 700);
	await tools.setClipboard('desktop-secret');
	await settle(1200);
	assert.equal(viewer.viewer.raw.length, 0, 'a viewer is sent no clipboard bytes of either form');
	assert.equal(await tools.size(), before);

	// The controller's window size becomes the desktop's.
	await control.viewer.setEncodings([ENCODING.raw, ENCODING.extendedDesktopSize]);
	await control.viewer.resize(1000, 700);
	await settle(1000);
	assert.equal(await tools.size(), '1000x700');
	// Out of range is clamped, not obeyed.
	await control.viewer.resize(9000, 9000);
	await settle(1000);
	assert.equal(await tools.size(), '3840x2160');

	// Nothing of the desktop listens on the network.
	const { stdout } = await run('ss', ['-H', '-ltnu']);
	assert.equal(stdout.trim(), '');
});

test('an unknown or oversized client message closes the stream, on the unix-socket connector too', { skip }, async (t) => {
	const f = await fixture(t);
	await f.service.start();
	await f.ready();
	const a = f.context('a');
	const first = await f.open(a);
	// The write that carries it may itself be refused as the stream closes.
	await first.viewer.send(Buffer.from([250, 0, 0, 0])).catch(() => undefined);
	await settle(500);
	assert.equal(first.viewer.closed, true);
	await assert.rejects(f.command(op.write, a, first.handle, Buffer.from([0])), (error) => error.code === 'not_found');
	assert.equal((await f.query(op.status, a)).controller, null);

	const second = await f.open(a, op.open, 2);
	// A clipboard message claiming more than the bound.
	const huge = Buffer.alloc(8);
	huge[0] = 6;
	huge.writeUInt32BE(2 * 1024 * 1024, 4);
	await second.viewer.send(huge).catch(() => undefined);
	await settle(500);
	assert.equal(second.viewer.closed, true);
});

test('taking control moves real input to the new controller and leaves nothing held by the old one', { skip }, async (t) => {
	const f = await fixture(t);
	await f.service.start();
	const status = await f.ready();
	const tools = desktopTools(f, status.display);
	const a = f.context('a');
	const b = f.context('b');
	const old = await f.open(a);
	await f.open(b);
	// The old controller is holding Shift and the left button.
	await old.viewer.pointer(400, 300, 0);
	await old.viewer.key(SHIFT, true);
	await old.viewer.pointer(400, 300, 1);
	await settle(500);
	assert.equal((await tools.held()).length, 2);

	const taken = await f.open(b, op.takeControl, 2);
	assert.equal(taken.mode, 'control');
	await settle(500);
	assert.deepEqual(await tools.held(), [], 'the old controller left nothing down');
	assert.equal(old.viewer.closed, true);
	await taken.viewer.pointer(70, 80, 0);
	await settle(400);
	assert.deepEqual(await tools.pointer(), { x: 70, y: 80 });
	const control = f.events.filter((e) => e.event === 'server.desktop.control');
	assert.deepEqual(control.at(-1).payload.controller, { clientId: 'client-b', deviceName: 'Device client-b' });
});

test('turning off leaves no holder, session, display server, or window; turning on brings a desktop back', { skip }, async (t) => {
	const f = await fixture(t);
	await f.service.start();
	const status = await f.ready();
	const tools = desktopTools(f, status.display);
	const a = f.context('a');
	const program = spawn('xterm', ['-e', 'sleep', '600'], { env: tools.env, stdio: 'ignore' });
	t.after(() => program.kill('SIGKILL'));
	const exited = new Promise((resolve) => program.once('exit', resolve));
	await settle(1500);
	await assert.rejects(f.command(op.disable, a, {}), (error) => {
		assert.equal(error.details.reason, 'windows-open');
		assert.equal(error.details.windows, 1);
		return true;
	});
	const off = (await f.command(op.disable, a, { confirmed: true })).result.status;
	assert.deepEqual(off, { state: 'off' });
	await Promise.race([exited, settle(5000)]);
	const pids = async (pattern) =>
		run('pgrep', ['-af', pattern]).then(({ stdout }) => stdout.trim(), () => '');
	// Killed processes are gone once the kernel has reaped them.
	const gone = async (pattern) => {
		for (let i = 0; i < 30 && (await pids(pattern)) !== ''; i++) await settle(100);
		return pids(pattern);
	};
	assert.equal(await gone('holderEntry.js'), '');
	assert.equal(await gone(`Xtigervnc :${status.display}`), '');
	assert.equal(await gone('xfwm4|xfce4-panel|xfdesktop|xfsettingsd|xfconfd|dbus-daemon'), '');
	assert.notEqual(program.exitCode ?? program.signalCode, null, 'the window closed with its display');
	assert.equal(f.service.displayEnvironment(), undefined);
	assert.equal((await f.query(op.status, a)).status.state, 'off');
	assert.equal(await pids('holderEntry.js'), '');

	await f.command(op.enable, a);
	assert.equal((await f.ready()).state, 'ready');
});

test('a holder speaking a control protocol this server does not is stopped and replaced, and the interruption is reported', { skip }, async (t) => {
	const f = await fixture(t);
	const diagnostics = [];
	// A stand-in holder of a future release: the right secret, another version.
	await mkdir(f.directory, { mode: 0o700 });
	const secret = 'c'.repeat(64);
	await writeFile(f.paths.secret, `${secret}\n`, { mode: 0o600 });
	let stopped = false;
	const future = createServer((socket) => {
		socket.on('error', () => undefined);
		(async () => {
			const reader = new LineReader(socket);
			const challenge = await reader.next();
			const nonce = newNonce();
			sendLine(socket, { t: 'proof', version: 99, nonce, proof: handshakeProof(secret, 'holder', nonce, challenge.nonce) });
			await reader.next();
			sendLine(socket, { t: 'welcome', state: { phase: 'running', display: 765, generation: 1 } });
			const request = await reader.next();
			if (request.t === 'stop') {
				stopped = true;
				await rm(f.paths.control, { force: true });
				future.close();
				socket.destroy();
			}
		})().catch(() => socket.destroy());
	});
	await new Promise((resolve) => future.listen(f.paths.control, resolve));
	const service = new ServerDesktopService({
		...f.service.options,
		onDiagnostic: (message) => diagnostics.push(message),
	});
	t.after(() => service.dispose());
	await service.start();
	assert.equal(stopped, true, 'the old holder was stopped through its own protocol');
	const deadline = Date.now() + 40_000;
	while (service.status?.state !== 'ready' && Date.now() < deadline) {
		await settle(200);
		await service.refresh();
	}
	assert.equal(service.status.state, 'ready');
	assert.equal(diagnostics.length, 1);
	assert.match(diagnostics[0], /control protocol 99/);
});
