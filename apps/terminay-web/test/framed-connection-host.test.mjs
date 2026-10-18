import assert from 'node:assert/strict';
import test from 'node:test';
import {
	FramedConnectionManagerHost,
	parseFramedConnectionRequest,
	parseFramedConnectionResponse,
	parseWorkspaceComposition,
	PwaWorkspaceCompositionStore,
	WEB_COMPOSITION_STORAGE_KEY,
} from '../dist/index.js';

const SESSION_ORIGIN = 'https://session-one.terminay.com';

function memoryStorage(seed = new Map()) {
	return {
		getItem(key) { return seed.has(key) ? seed.get(key) : null; },
		setItem(key, value) { seed.set(key, value); },
		removeItem(key) { seed.delete(key); },
	};
}

/** A minimal ByteTransport double: it records what the manager sent to the
 * server and lets a test push server bytes back. */
function fakeTransport() {
	const sent = [];
	const sentWaiters = [];
	const inbound = [];
	let push;
	return {
		sent,
		/** Resolves once the manager has sent the server `count` frames. */
		sentReach(count) {
			if (sent.length >= count) return Promise.resolve();
			return new Promise((resolve) => sentWaiters.push({ count, resolve }));
		},
		deliver(bytes) { push === undefined ? inbound.push(bytes) : push(bytes); },
		end() { push = undefined; inbound.push(undefined); },
		transport: {
			state: 'open',
			queuedBytes: 0,
			bufferedBytes: 0,
			async open() {},
			async close() {},
			onStateChange() { return () => {}; },
			async send(frame) {
				sent.push([...frame]);
				for (const waiter of sentWaiters.filter((entry) => sent.length >= entry.count)) {
					sentWaiters.splice(sentWaiters.indexOf(waiter), 1);
					waiter.resolve();
				}
			},
			get incoming() {
				return {
					async *[Symbol.asyncIterator]() {
						while (true) {
							const next = inbound.shift();
							if (next === undefined && inbound.length === 0) {
								const value = await new Promise((resolve) => { push = resolve; });
								if (value === undefined) return;
								yield value;
								continue;
							}
							if (next === undefined) return;
							yield next;
						}
					},
				};
			},
		},
	};
}

function harness(t, overrides = {}) {
	const posted = [];
	const postWaiters = [];
	/** Resolves once the manager has posted `count` messages to the frame. */
	const postedReach = (count) => {
		if (posted.length >= count) return Promise.resolve();
		return new Promise((resolve) => postWaiters.push({ count, resolve }));
	};
	const listeners = new Set();
	const opened = fakeTransport();
	const delegate = {
		listProfiles: async () => [
			{ id: 'profile-a', label: 'Build box', status: 'connected', serverId: 'server-a' },
		],
		openConnection: async (profileId) => {
			if (profileId !== 'profile-a') throw new Error('unknown connection bookmark');
			return { serverId: 'server-a', transport: opened.transport };
		},
		closeConnection: async () => {},
		readComposition: async () => undefined,
		writeComposition: async () => {},
		...overrides,
	};
	const host = new FramedConnectionManagerHost({
		sessionOrigin: SESSION_ORIGIN,
		frame: {
			postMessage(message, targetOrigin, transfer) {
				posted.push({ message, targetOrigin, transfer });
				for (const waiter of postWaiters.filter((entry) => posted.length >= entry.count)) {
					postWaiters.splice(postWaiters.indexOf(waiter), 1);
					waiter.resolve();
				}
			},
		},
		frameSource: 'the-frame',
		messageTarget: {
			addEventListener(_type, listener) { listeners.add(listener); },
			removeEventListener(_type, listener) { listeners.delete(listener); },
		},
		delegate,
	});
	host.start();
	t.after(async () => {
		opened.end();
		await host.stop();
		for (const entry of posted)
			for (const port of entry.transfer ?? []) port.close?.();
	});
	/** Delivers a message as the frame would, without waiting for an answer. */
	const dispatch = (data, origin = SESSION_ORIGIN, source = 'the-frame') => {
		for (const listener of [...listeners]) listener({ data, origin, source });
	};
	/** Delivers a request and resolves once the manager has answered it. */
	const send = (data, origin, source) => {
		const answered = postedReach(posted.length + 1);
		dispatch(data, origin, source);
		return answered;
	};
	return { host, posted, postedReach, dispatch, send, opened };
}

test('the framed schema lists sanitized profiles and nothing else', async (t) => {
	const { posted, send } = harness(t);
	await send({ v: 1, type: 'connections.list', requestId: 'r1' });
	assert.deepEqual(posted[0].message, {
		v: 1,
		type: 'connections.result',
		requestId: 'r1',
		result: { kind: 'profiles', profiles: [{ id: 'profile-a', label: 'Build box', status: 'connected', serverId: 'server-a' }] },
	});
	assert.equal(posted[0].targetOrigin, SESSION_ORIGIN);
	assert.equal(JSON.stringify(posted[0].message).includes('http'), false);
});

test('attach transfers a byte port and never a credential', async (t) => {
	const { posted, send, opened } = harness(t);
	await send({ v: 1, type: 'connections.attach', requestId: 'r2', profileId: 'profile-a' });
	const [reply] = posted;
	assert.deepEqual(reply.message, {
		v: 1,
		type: 'connections.result',
		requestId: 'r2',
		result: { kind: 'attached', profileId: 'profile-a', serverId: 'server-a' },
	});
	assert.equal(reply.transfer.length, 1);
	assert.equal(JSON.stringify(reply.message).includes('credential'), false);

	const port = reply.transfer[0];
	port.start();
	const fromServer = new Promise((resolve) => { port.onmessage = (event) => resolve(event.data); });
	port.postMessage(new Uint8Array([1, 2, 3]));
	await opened.sentReach(1);
	assert.deepEqual(opened.sent, [[1, 2, 3]]);
	opened.deliver(new Uint8Array([9, 8]));
	assert.deepEqual([...(await fromServer)], [9, 8]);
});

test('attach refuses an unknown profile and a duplicate attachment', async (t) => {
	const { posted, send } = harness(t);
	await send({ v: 1, type: 'connections.attach', requestId: 'r3', profileId: 'profile-z' });
	assert.equal(posted[0].message.type, 'connections.error');
	assert.equal(posted[0].message.code, 'attach-failed');
	await send({ v: 1, type: 'connections.attach', requestId: 'r4', profileId: 'profile-a' });
	await send({ v: 1, type: 'connections.attach', requestId: 'r5', profileId: 'profile-a' });
	assert.equal(posted[2].message.code, 'attach-failed');
});

test('detach closes the manager transport and answers the frame', async (t) => {
	const closed = [];
	const { posted, send } = harness(t, { closeConnection: async (profileId) => { closed.push(profileId); } });
	await send({ v: 1, type: 'connections.attach', requestId: 'r6', profileId: 'profile-a' });
	await send({ v: 1, type: 'connections.detach', requestId: 'r7', profileId: 'profile-a' });
	assert.deepEqual(closed, ['profile-a']);
	assert.deepEqual(posted[1].message.result, { kind: 'detached', profileId: 'profile-a' });
});

test('the manager ignores foreign origins, foreign frames, and unknown message types', async (t) => {
	const { posted, dispatch, send } = harness(t);
	dispatch({ v: 1, type: 'connections.list', requestId: 'r8' }, 'https://evil.example.test');
	dispatch({ v: 1, type: 'connections.list', requestId: 'r9' }, SESSION_ORIGIN, 'another-frame');
	dispatch({ v: 1, type: 'vault.read', requestId: 'r10' });
	// A known type with an unsupported schema version or an unknown field is a
	// typed refusal, never a partially honoured request. Those two are the
	// first answers to arrive, so nothing sent before them was answered.
	await send({ v: 2, type: 'connections.list', requestId: 'r11' });
	await send({ v: 1, type: 'connections.attach', requestId: 'r12', profileId: 'profile-a', extra: 1 });
	assert.deepEqual(posted.map((entry) => [entry.message.requestId, entry.message.code]), [
		['r11', 'invalid-request'],
		['r12', 'invalid-request'],
	]);
});

test('status notifications reach the framed primary as a closed message', async (t) => {
	const { host, posted } = harness(t);
	host.notifyConnectionsChanged([{ id: 'profile-a', label: 'Build box', status: 'offline' }]);
	assert.deepEqual(posted[0].message, {
		v: 1,
		type: 'connections.changed',
		profiles: [{ id: 'profile-a', label: 'Build box', status: 'offline' }],
	});
	assert.throws(() => host.notifyConnectionsChanged([{ id: 'profile-a', label: 'x', status: 'connected', origin: 'https://leak.test' }]), /unknown field/u);
});

test('composition is manager-stored per primary session origin and sanitized', async () => {
	const seed = new Map();
	const store = new PwaWorkspaceCompositionStore({ storage: memoryStorage(seed) });
	const composition = {
		version: 1,
		primaryProfileId: 'profile-primary',
		attached: [{ profileId: 'profile-a', viewId: 'view-1' }],
		tabOrder: [{ serverId: 'server-a', projectId: 'project-1' }],
	};
	store.write(SESSION_ORIGIN, composition);
	assert.deepEqual(store.read(SESSION_ORIGIN), composition);
	assert.equal(store.read('https://session-two.terminay.com'), undefined);
	const saved = JSON.parse(seed.get(WEB_COMPOSITION_STORAGE_KEY));
	assert.deepEqual(Object.keys(saved.compositions), [SESSION_ORIGIN]);
	assert.throws(() => store.write(SESSION_ORIGIN, { ...composition, secret: 'x' }), /unknown field/u);
	assert.throws(() => parseWorkspaceComposition({ ...composition, tabOrder: [{ serverId: 'server-a', projectId: 'p', root: '/home' }] }), /unknown field/u);
	assert.equal(store.forget(SESSION_ORIGIN), true);
	assert.equal(store.read(SESSION_ORIGIN), undefined);
});

test('composition read and write travel over the framed schema', async (t) => {
	let stored;
	const { posted, send } = harness(t, {
		readComposition: async () => stored,
		writeComposition: async (composition) => { stored = composition; },
	});
	const composition = { version: 1, primaryProfileId: 'profile-primary', attached: [], tabOrder: [] };
	await send({ v: 1, type: 'connections.composition.write', requestId: 'r13', composition });
	assert.deepEqual(posted[0].message.result, { kind: 'ok' });
	await send({ v: 1, type: 'connections.composition.read', requestId: 'r14' });
	assert.deepEqual(posted[1].message.result, { kind: 'composition', composition });
});

test('both halves of the schema validate the same closed message names', () => {
	for (const type of ['connections.list', 'connections.composition.read'])
		assert.equal(parseFramedConnectionRequest({ v: 1, type, requestId: 'r' }).type, type);
	assert.throws(() => parseFramedConnectionRequest({ v: 1, type: 'connections.open', requestId: 'r' }), /unknown/u);
	assert.equal(
		parseFramedConnectionResponse({ v: 1, type: 'connections.result', requestId: 'r', result: { kind: 'ok' } }).result.kind,
		'ok',
	);
	assert.throws(() => parseFramedConnectionResponse({ v: 1, type: 'connections.result', requestId: 'r', result: { kind: 'credential' } }), /unknown/u);
});

test('two attaches for one profile open exactly one connection', async (t) => {
	// The loser of the race used to be answered with a port of its own, and the
	// transport it had opened was left running with nothing holding it.
	const opens = [];
	let finishOpening;
	const opening = new Promise((resolve) => { finishOpening = resolve; });
	const { posted, postedReach, dispatch } = harness(t, {
		openConnection: async (profileId) => {
			const opened = fakeTransport();
			opens.push(opened);
			// Both attaches arrive while the first is still opening.
			await opening;
			return { serverId: 'server-a', transport: opened.transport };
		},
	});
	dispatch({ v: 1, type: 'connections.attach', requestId: 'a1', profileId: 'profile-a' });
	dispatch({ v: 1, type: 'connections.attach', requestId: 'a2', profileId: 'profile-a' });
	finishOpening();
	// Every attach is answered exactly once.
	await postedReach(2);
	assert.equal(opens.length, 1);
	const codes = posted.map((entry) => entry.message.code ?? entry.message.result.kind);
	assert.deepEqual(codes.sort(), ['attach-failed', 'attached']);
	for (const opened of opens) opened.end();
});

test('a failed attached transport is closed and the manager is told', async (t) => {
	const closedProfiles = [];
	let transportClosed = false;
	let markTransportClosed;
	const transportClosing = new Promise((resolve) => { markTransportClosed = resolve; });
	let markManagerTold;
	const managerTold = new Promise((resolve) => { markManagerTold = resolve; });
	// A transport whose incoming stream is already finished: the server side
	// went away between opening and the first frame.
	const dead = {
		state: 'open',
		queuedBytes: 0,
		bufferedBytes: 0,
		async open() {},
		async close() {
			transportClosed = true;
			markTransportClosed();
		},
		onStateChange() {
			return () => {};
		},
		async send() {},
		get incoming() {
			return {
				// biome-ignore lint/correctness/useYield: an already-closed stream
				async *[Symbol.asyncIterator]() {},
			};
		},
	};
	const { send } = harness(t, {
		openConnection: async () => ({ serverId: 'server-a', transport: dead }),
		closeConnection: async (profileId) => {
			closedProfiles.push(profileId);
			markManagerTold();
		},
	});
	await send({ v: 1, type: 'connections.attach', requestId: 'b1', profileId: 'profile-a' });
	await Promise.all([transportClosing, managerTold]);
	// Neither the transport nor the manager's record of the connection may be
	// left behind by a lane that has stopped working.
	assert.equal(transportClosed, true);
	assert.deepEqual(closedProfiles, ['profile-a']);
});
