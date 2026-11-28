import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { SERVER_DESKTOP_OPERATIONS as op } from '@terminay/protocol';
import { vncChallengeResponse } from '@terminay/remote-desktop/server';
import {
	ServerDesktopService,
	serverDesktopOffRecord,
} from '../dist/serverDesktop/index.js';

const word = (value, bytes = 4) => {
	const out = Buffer.alloc(bytes);
	out.writeUIntBE(value, 0, bytes);
	return out;
};
const pixel = Buffer.from([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]);
const PASSWORDS = { full: 'fullpass', viewOnly: 'viewpass' };
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** One upstream connection of a fake display; records what it was sent. */
function fakeUpstream(log) {
	const source = new PassThrough();
	const challenge = Buffer.from('0123456789abcdef');
	const entry = { as: undefined, writes: [], closed: false };
	log.push(entry);
	let stage = 0;
	let pending = Buffer.alloc(0);
	const listeners = [];
	const sink = new Writable({
		write(chunk, _enc, done) {
			pending = Buffer.concat([pending, chunk]);
			while (pending.length > 0) {
				if (stage === 4) {
					entry.writes.push(pending);
					pending = Buffer.alloc(0);
					break;
				}
				const size = [12, 1, 16, 1][stage];
				if (pending.length < size) break;
				const part = pending.subarray(0, size);
				pending = pending.subarray(size);
				if (stage === 0) source.write(Buffer.from([1, 2]));
				else if (stage === 1) source.write(challenge);
				else if (stage === 2) {
					for (const [name, password] of Object.entries(PASSWORDS))
						if (part.equals(vncChallengeResponse(Buffer.from(password), challenge)))
							entry.as = name;
					source.write(word(entry.as === undefined ? 1 : 0));
				} else
					source.write(
						Buffer.concat([word(1024, 2), word(768, 2), pixel, word(4), Buffer.from('fake')]),
					);
				stage++;
			}
			done();
		},
	});
	const close = () => {
		if (entry.closed) return;
		entry.closed = true;
		source.destroy();
		sink.destroy();
		for (const listener of listeners.splice(0)) listener();
	};
	queueMicrotask(() => source.write(Buffer.from('RFB 003.008\n')));
	return {
		source,
		sink,
		onEnd: (listener) => (entry.closed ? listener() : listeners.push(listener)),
		close,
	};
}

function fakeHolder(initial = { phase: 'running', display: 765, generation: 1 }) {
	const state = new Set();
	const closed = new Set();
	const holder = {
		alive: true,
		state: initial,
		windowCount: 0,
		stops: 0,
		credentialCalls: 0,
		onState: (listener) => {
			state.add(listener);
			return () => state.delete(listener);
		},
		onClosed: (listener) => {
			closed.add(listener);
			return () => closed.delete(listener);
		},
		status: async () => holder.state,
		credentials: async () => {
			holder.credentialCalls += 1;
			return { ...PASSWORDS };
		},
		windows: async () => holder.windowCount,
		stop: async () => {
			holder.stops += 1;
			holder.die();
		},
		disconnect: () => holder.die(),
		set(next) {
			holder.state = next;
			for (const listener of [...state]) listener(next);
		},
		die() {
			if (!holder.alive) return;
			holder.alive = false;
			for (const listener of [...closed]) listener();
		},
	};
	return holder;
}

const PROGRAMS = [
	'Xtigervnc', 'tigervncpasswd', 'xfwm4', 'xfce4-panel', 'xfsettingsd', 'xfdesktop',
	'dbus-run-session', 'xset', 'python3', 'bash',
];

async function fixture(t, options = {}) {
	const root = await mkdtemp(path.join(tmpdir(), 'sds-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const events = [];
	const upstreams = [];
	const holders = [];
	const installed = { value: options.installed ?? true };
	const setup = {
		means: options.means ?? 'server',
		runs: 0,
		finish: undefined,
		progress: undefined,
	};
	const facts = {
		platform: options.platform ?? 'linux',
		osRelease: async () => options.osRelease ?? 'ID=debian\nVERSION_ID="13"\n',
		mountinfo: async () => '36 25 0:32 / /tmp rw - tmpfs tmpfs rw\n',
		executable: async (file) =>
			installed.value && file.startsWith('/usr/bin/') && PROGRAMS.includes(path.basename(file)),
		list: async () => (installed.value ? ['seccomp.cpython-313-x86_64-linux-gnu.so'] : []),
		networkDenialWorks: async () => options.networkDenial ?? true,
	};
	let adoptions = 0;
	const service = new ServerDesktopService({
		eventJournal: { publishTransient: (event, payload) => events.push({ event, payload }) },
		directory: path.join(root, 'd'),
		dataRoot: root,
		home: root,
		env: options.env ?? { PATH: '/usr/bin' },
		facts,
		deviceName: (context) => `Device ${context.clientId}`,
		setup: {
			describe: async () => ({ means: setup.means, command: 'sudo terminay daemon desktop install' }),
			running: async () => options.runningSetup,
			run: (onProgress) => {
				setup.runs += 1;
				setup.progress = onProgress;
				return new Promise((resolve) => {
					setup.finish = resolve;
				});
			},
		},
		holders: {
			adoptOrStart: async () => {
				adoptions += 1;
				if (options.holderFails) return { outcome: 'failed', reason: options.holderFails };
				const holder = fakeHolder(options.holderState);
				holders.push(holder);
				return { outcome: 'ready', client: holder, started: true };
			},
			connect: async () => {
				const live = holders.find((holder) => holder.alive);
				return live ? { outcome: 'adopted', client: live } : { outcome: 'absent' };
			},
		},
		connector: () => ({ open: () => fakeUpstream(upstreams) }),
	});
	t.after(() => service.dispose());
	const registry = service.operations();
	const context = (name, extra = {}) => ({
		connectionId: `conn-${name}`,
		clientId: `client-${name}`,
		authScope: 'write',
		signal: new AbortController().signal,
		...extra,
	});
	const call = (kind, name, ctx, payload = {}, body = new Uint8Array()) =>
		registry[kind][name]({ envelope: { payload }, body, context: ctx });
	const command = (name, ctx, payload, body) => call('commands', name, ctx, payload, body);
	const query = (name, ctx, payload) => call('queries', name, ctx, payload);
	const handshake = async (ctx, handle) => {
		await command(op.write, ctx, handle, Buffer.from('RFB 003.008\n'));
		await command(op.write, ctx, handle, Buffer.from([1]));
		await command(op.write, ctx, handle, Buffer.from([1]));
	};
	return {
		root, service, events, upstreams, holders, installed, setup, context, command, query, handshake,
		get adoptions() {
			return adoptions;
		},
	};
}

const refused = (code, reason) => (error) => {
	assert.equal(error.code, code, error.message);
	if (reason !== undefined) assert.equal(error.details?.reason, reason);
	return true;
};

test('status reports unsupported hosts with a reason and starts nothing', async (t) => {
	for (const [options, reason] of [
		[{ platform: 'darwin' }, 'not-linux'],
		[{ osRelease: 'ID=fedora\n' }, 'not-debian'],
		[{ networkDenial: false }, 'network-cannot-be-denied'],
	]) {
		const f = await fixture(t, options);
		const { status } = await f.query(op.status, f.context('a'));
		assert.equal(status.state, 'unsupported');
		assert.equal(status.reason, reason);
		assert.equal(f.adoptions, 0);
		await assert.rejects(f.command(op.setup, f.context('a')), refused('conflict', 'unsupported'));
	}
});

test('every operation refuses a narrowed connection as forbidden, before touching the desktop', async (t) => {
	const f = await fixture(t);
	const narrowed = [
		f.context('p', { claims: { projectId: 'p1' } }),
		f.context('s', { claims: { sessionId: 's1' } }),
		f.context('m', { clientId: 'system:mcp' }),
		f.context('r', { authScope: 'read' }),
		f.context('c', { claims: { capability: 'x' } }),
	];
	for (const ctx of narrowed) {
		await assert.rejects(f.query(op.status, ctx), refused('forbidden'));
		await assert.rejects(f.query(op.read, ctx, { streamId: 'x', generation: 1 }), refused('forbidden'));
		for (const name of [op.setup, op.enable, op.disable, op.open, op.takeControl, op.releaseControl, op.write, op.close])
			await assert.rejects(f.command(name, ctx, { generation: 1 }), refused('forbidden'));
	}
	assert.equal(f.adoptions, 0);
	assert.equal(f.events.length, 0);
	assert.equal(f.setup.runs, 0);
});

test('operations take no fields a client could steer setup with', async (t) => {
	const f = await fixture(t, { installed: false });
	const ctx = f.context('a');
	for (const payload of [{ packages: ['evil'] }, { command: 'x' }, { display: 1 }])
		await assert.rejects(f.command(op.setup, ctx, payload), refused('validation'));
	await assert.rejects(f.command(op.enable, ctx, { display: 9 }), refused('validation'));
	await assert.rejects(f.command(op.open, ctx, { generation: 1, mode: 'control' }), refused('validation'));
	assert.equal(f.setup.runs, 0);
});

test('setup runs once, publishes progress, is joined by a second request, and starts the desktop when it ends', async (t) => {
	const f = await fixture(t, { installed: false });
	const a = f.context('a');
	const b = f.context('b');
	assert.equal((await f.query(op.status, a)).status.state, 'needs-setup');
	const first = (await f.command(op.setup, a)).result.status;
	assert.deepEqual(first, { state: 'setting-up', step: 'waiting', fraction: 0 });
	const second = (await f.command(op.setup, b)).result.status;
	assert.equal(second.state, 'setting-up');
	assert.equal(f.setup.runs, 1);
	f.setup.progress({ step: 'installing', fraction: 0.5 });
	await tick();
	assert.deepEqual((await f.query(op.status, b)).status, { state: 'setting-up', step: 'installing', fraction: 0.5 });
	f.installed.value = true;
	f.setup.finish({ ok: true });
	await tick();
	assert.deepEqual((await f.query(op.status, a)).status, { state: 'ready', display: 765 });
	assert.equal(f.adoptions, 1);
	const states = f.events.filter((e) => e.event === 'server.desktop.changed').map((e) => e.payload.status.state);
	assert.deepEqual(states, ['needs-setup', 'setting-up', 'setting-up', 'ready']);
});

test('a failed setup reports its step and reason, and can be retried', async (t) => {
	const f = await fixture(t, { installed: false });
	const a = f.context('a');
	await f.command(op.setup, a);
	f.setup.finish({ ok: false, step: 'downloading', reason: 'no network' });
	await tick();
	const failed = (await f.query(op.status, a)).status;
	assert.equal(failed.state, 'failed');
	assert.equal(failed.step, 'downloading');
	assert.equal(failed.reason, 'no network');
	assert.equal(failed.setup, 'server');
	await f.command(op.setup, a);
	assert.equal(f.setup.runs, 2);
});

test('where the server cannot install, setup is refused and the command is reported; programs found later start the desktop', async (t) => {
	const f = await fixture(t, { installed: false, means: 'command' });
	const a = f.context('a');
	const status = (await f.query(op.status, a)).status;
	assert.deepEqual(status, { state: 'needs-setup', setup: 'command', command: 'sudo terminay daemon desktop install' });
	await assert.rejects(f.command(op.setup, a), refused('conflict', 'setup-by-command'));
	assert.equal(f.setup.runs, 0);
	f.installed.value = true;
	assert.equal((await f.query(op.status, a)).status.state, 'ready');
});

test('a setup already running when the server starts is joined', async (t) => {
	const f = await fixture(t, { installed: false, runningSetup: { step: 'installing', fraction: 0.3 } });
	await f.service.start();
	assert.equal(f.setup.runs, 1);
	assert.deepEqual((await f.query(op.status, f.context('a'))).status, { state: 'setting-up', step: 'installing', fraction: 0.3 });
});

test('a set-up desktop starts with the server and gives terminals its display; one that is off does neither', async (t) => {
	const f = await fixture(t);
	assert.equal(f.service.displayEnvironment(), undefined);
	await f.service.start();
	assert.equal(f.adoptions, 1);
	assert.deepEqual(f.service.displayEnvironment(), {
		DISPLAY: ':765',
		XAUTHORITY: path.join(f.root, 'd', 'Xauthority'),
	});
	const a = f.context('a');
	const off = (await f.command(op.disable, a, {})).result.status;
	assert.deepEqual(off, { state: 'off' });
	assert.equal(f.holders[0].stops, 1);
	assert.equal(f.service.displayEnvironment(), undefined);
	assert.equal(existsSync(serverDesktopOffRecord(f.root)), true);
	// Off is remembered: looking again starts nothing.
	assert.equal((await f.query(op.status, a)).status.state, 'off');
	assert.equal(f.adoptions, 1);
	await assert.rejects(f.command(op.open, a, { generation: 1 }), refused('conflict', 'not-ready'));
	assert.equal((await f.command(op.enable, a)).result.status.state, 'ready');
	assert.equal(f.adoptions, 2);
});

test('a server with a display of its own does not give terminals the desktop display', async (t) => {
	for (const env of [{ DISPLAY: ':0' }, { WAYLAND_DISPLAY: 'wayland-0' }]) {
		const f = await fixture(t, { env });
		await f.service.start();
		assert.equal(f.service.status.state, 'ready');
		assert.equal(f.service.displayEnvironment(), undefined);
	}
});

test('turning off with program windows open needs confirmation; unknown counts as open', async (t) => {
	const f = await fixture(t);
	await f.service.start();
	const a = f.context('a');
	f.holders[0].windowCount = 2;
	await assert.rejects(f.command(op.disable, a, {}), (error) => {
		assert.equal(error.details.reason, 'windows-open');
		assert.equal(error.details.windows, 2);
		return true;
	});
	f.holders[0].windowCount = -1;
	await assert.rejects(f.command(op.disable, a, {}), refused('conflict', 'windows-open'));
	assert.equal(f.holders[0].stops, 0);
	assert.equal((await f.command(op.disable, a, { confirmed: true })).result.status.state, 'off');
	assert.equal(f.holders[0].stops, 1);
});

test('the first to open controls with the full password; later clients view with the view-only password', async (t) => {
	const f = await fixture(t);
	await f.service.start();
	const a = f.context('a');
	const b = f.context('b');
	const first = (await f.command(op.open, a, { generation: 1 })).result;
	assert.equal(first.mode, 'control');
	assert.deepEqual(first.controller, { clientId: 'client-a', deviceName: 'Device client-a' });
	const second = (await f.command(op.open, b, { generation: 1 })).result;
	assert.equal(second.mode, 'view-only');
	assert.deepEqual(second.controller, first.controller);
	assert.deepEqual(f.upstreams.map((u) => u.as), ['full', 'viewOnly']);
	assert.notEqual(first.handle.streamId, second.handle.streamId);
	// Each stream has its own connection to the display.
	assert.equal(f.upstreams.length, 2);
	// The passwords were asked of the holder per connection.
	assert.equal(f.holders[0].credentialCalls, 2);
	const control = f.events.filter((e) => e.event === 'server.desktop.control');
	assert.deepEqual(control.map((e) => e.payload.controller?.clientId), ['client-a']);
});

test('a viewer\'s input never reaches the display; the controller\'s does', async (t) => {
	const f = await fixture(t);
	await f.service.start();
	const a = f.context('a');
	const b = f.context('b');
	const control = (await f.command(op.open, a, { generation: 1 })).result.handle;
	const view = (await f.command(op.open, b, { generation: 1 })).result.handle;
	await f.handshake(a, control);
	await f.handshake(b, view);
	const key = Buffer.concat([Buffer.from([4, 1, 0, 0]), word(0x61)]);
	await f.command(op.write, a, control, key);
	await f.command(op.write, b, view, key);
	await tick();
	const sent = (index) => Buffer.concat(f.upstreams[index].writes);
	assert.equal(sent(0).includes(key), true);
	assert.equal(sent(1).includes(key), false);
});

test('taking control closes the old controller\'s connection before the new one opens, and names the new controller', async (t) => {
	const f = await fixture(t);
	await f.service.start();
	const a = f.context('a');
	const b = f.context('b');
	const old = (await f.command(op.open, a, { generation: 1 })).result.handle;
	await f.command(op.open, b, { generation: 1 });
	const order = [];
	const originalClosed = Object.getOwnPropertyDescriptor(f.upstreams[0], 'closed');
	assert.equal(originalClosed.value, false);
	let closedAt;
	Object.defineProperty(f.upstreams[0], 'closed', {
		get: () => closedAt !== undefined,
		set: (value) => {
			if (value) {
				closedAt = f.upstreams.length;
				order.push('old-closed');
			}
		},
	});
	const taken = (await f.command(op.takeControl, b, { generation: 2 })).result;
	assert.equal(taken.mode, 'control');
	assert.deepEqual(taken.controller, { clientId: 'client-b', deviceName: 'Device client-b' });
	// When the old control connection closed, no newer upstream existed yet.
	assert.equal(closedAt, 2);
	assert.equal(f.upstreams[2].as, 'full');
	assert.equal(f.upstreams[1].closed, true, 'the taker\'s viewer stream was replaced');
	// The old controller's handle is dead.
	await assert.rejects(f.command(op.write, a, old, Buffer.from([0])), refused('not_found'));
	const control = f.events.filter((e) => e.event === 'server.desktop.control');
	assert.deepEqual(control.at(-1).payload.controller, { clientId: 'client-b', deviceName: 'Device client-b' });
	// The displaced client reopens as a viewer.
	assert.equal((await f.command(op.open, a, { generation: 2 })).result.mode, 'view-only');
});

test('simultaneous takeovers leave exactly one controller', async (t) => {
	const f = await fixture(t);
	await f.service.start();
	const clients = ['a', 'b', 'c', 'd'].map((name) => f.context(name));
	await Promise.all(clients.map((ctx) => f.command(op.open, ctx, { generation: 1 })));
	const results = await Promise.all(
		clients.map((ctx) => f.command(op.takeControl, ctx, { generation: 2 }).then((r) => r.result)),
	);
	const last = results.at(-1).controller.clientId;
	const live = f.upstreams.filter((u) => !u.closed);
	assert.equal(live.filter((u) => u.as === 'full').length, 1);
	assert.equal((await f.query(op.status, clients[0])).controller.clientId, last);
});

test('giving up control or leaving frees it for the next to open', async (t) => {
	const f = await fixture(t);
	await f.service.start();
	const a = f.context('a');
	const b = f.context('b');
	await f.command(op.open, a, { generation: 1 });
	const released = (await f.command(op.releaseControl, a, { generation: 2 })).result;
	assert.equal(released.mode, 'view-only');
	assert.equal(released.controller, null);
	assert.equal((await f.command(op.open, b, { generation: 1 })).result.mode, 'control');
	// The controller's connection ends.
	f.service.closeConnection('conn-b');
	await tick();
	assert.equal((await f.query(op.status, a)).controller, null);
	assert.equal(f.upstreams.filter((u) => !u.closed).length, 1);
	assert.equal(f.events.at(-1).event, 'server.desktop.control');
	assert.equal(f.events.at(-1).payload.controller, null);
});

test('a stream belongs to its connection: another connection cannot read, write, or close it', async (t) => {
	const f = await fixture(t);
	await f.service.start();
	const a = f.context('a');
	const b = f.context('b');
	const handle = (await f.command(op.open, a, { generation: 1 })).result.handle;
	await assert.rejects(f.query(op.read, b, handle), refused('not_found'));
	await assert.rejects(f.command(op.write, b, handle, Buffer.from([0])), refused('not_found'));
	await assert.rejects(f.command(op.close, b, handle), refused('not_found'));
	await assert.rejects(f.command(op.write, a, { ...handle, generation: 9 }, Buffer.from([0])), refused('not_found'));
	// Same client identity on another connection is still another connection.
	const sibling = { ...a, connectionId: 'conn-other' };
	await assert.rejects(f.query(op.read, sibling, handle), refused('not_found'));
	assert.equal(f.upstreams[0].closed, false);
});

test('a connection that ends or is revoked loses its stream at once, and its handle stops working', async (t) => {
	const f = await fixture(t);
	await f.service.start();
	const a = f.context('a');
	const handle = (await f.command(op.open, a, { generation: 1 })).result.handle;
	f.service.closeConnection('conn-a');
	await tick();
	assert.equal(f.upstreams[0].closed, true);
	await assert.rejects(f.command(op.write, a, handle, Buffer.from([0])), refused('not_found'));
});

test('an older generation cannot replace a newer stream', async (t) => {
	const f = await fixture(t);
	await f.service.start();
	const a = f.context('a');
	await f.command(op.open, a, { generation: 5 });
	await assert.rejects(f.command(op.open, a, { generation: 5 }), refused('conflict', 'stale-generation'));
	await assert.rejects(f.command(op.takeControl, a, { generation: 4 }), refused('conflict', 'stale-generation'));
	assert.equal(f.upstreams[0].closed, false);
	assert.equal((await f.command(op.open, a, { generation: 6 })).result.mode, 'control');
	assert.equal(f.upstreams[0].closed, true);
});

test('a restarted display closes every stream, and a holder that goes away is replaced', async (t) => {
	const f = await fixture(t);
	await f.service.start();
	const a = f.context('a');
	await f.command(op.open, a, { generation: 1 });
	f.holders[0].set({ phase: 'running', display: 765, generation: 2 });
	await tick();
	assert.equal(f.upstreams[0].closed, true);
	assert.equal((await f.query(op.status, a)).controller, null);
	assert.equal((await f.command(op.open, a, { generation: 2 })).result.mode, 'control');
	f.holders[0].die();
	await tick(50);
	assert.equal(f.upstreams[1].closed, true);
	assert.equal(f.adoptions, 2);
	assert.equal((await f.query(op.status, a)).status.state, 'ready');
});

test('a holder that cannot be started is reported as failed, with the manual command', async (t) => {
	const f = await fixture(t, { holderFails: 'A desktop holder is already running here but could not be reached.' });
	await f.service.start();
	const status = (await f.query(op.status, f.context('a'))).status;
	assert.equal(status.state, 'failed');
	assert.match(status.reason, /could not be reached/);
	assert.equal(f.service.displayEnvironment(), undefined);
});

test('stopping the server leaves the desktop running', async (t) => {
	const f = await fixture(t);
	await f.service.start();
	await f.command(op.open, f.context('a'), { generation: 1 });
	f.service.dispose();
	await tick();
	assert.equal(f.holders[0].stops, 0);
	assert.equal(f.upstreams[0].closed, true);
	assert.equal(f.adoptions, 1);
});

test('setup that completes while the desktop is off starts nothing', async (t) => {
	const f = await fixture(t, { installed: false });
	const a = f.context('a');
	// Turned off before it was ever set up.
	await f.command(op.disable, a, {});
	assert.equal((await f.query(op.status, a)).status.state, 'needs-setup');
	await f.command(op.setup, a);
	f.installed.value = true;
	f.setup.finish({ ok: true });
	await tick();
	assert.deepEqual((await f.query(op.status, a)).status, { state: 'off' });
	assert.equal(f.adoptions, 0);
	assert.equal(f.service.displayEnvironment(), undefined);
});

test('on and off is its own record, not a setting: no operation but enable and disable changes it', async (t) => {
	const f = await fixture(t);
	await f.service.start();
	const a = f.context('a');
	// The desktop registers no settings operation and reads no settings.
	const registry = f.service.operations();
	for (const name of [...Object.keys(registry.commands), ...Object.keys(registry.queries)])
		assert.ok(name.startsWith('server.desktop.'), name);
	await f.command(op.disable, a, {});
	assert.equal(existsSync(serverDesktopOffRecord(f.root)), true);
	await f.command(op.enable, a);
	assert.equal(existsSync(serverDesktopOffRecord(f.root)), false);
});
