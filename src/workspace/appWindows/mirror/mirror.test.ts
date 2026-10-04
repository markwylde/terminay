import assert from 'node:assert/strict';
import test from 'node:test';
import { buildViewDocument } from '../viewDocument.ts';
import { MIRROR_RECORDER_SCRIPT, MIRROR_REPLICA_SCRIPT } from './bundles.generated.ts';
import { buildMirrorDocument, mirrorContentSecurityPolicy } from './mirrorDocument.ts';
import { AppWindowMirrorHub, type MirrorHubClient } from './mirrorHub.ts';
import {
	MIRROR_LOADER_SCRIPT,
	MIRROR_MAX_BATCH_BYTES,
	MIRROR_MAX_PART_BYTES,
} from './mirrorProtocol.ts';
import { parseMirrorBatch, ViewRecorderLink } from './recorderLink.ts';

const NONCE = 'abcdefghijklmnopqrstuvwx';
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

// --- documents ---

test('every view carries the loader and not the recorder', () => {
	for (const kind of ['agent', 'mcp-app'] as const) {
		const { html } = buildViewDocument({ html: '<p>hi</p>', source: { kind } });
		assert.ok(html.includes(MIRROR_LOADER_SCRIPT));
		assert.equal(html.includes(MIRROR_RECORDER_SCRIPT), false);
		// The policy still comes before anything that runs.
		assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script>'));
	}
});

test('the injected scripts cannot close the script element they are placed in', () => {
	for (const script of [MIRROR_RECORDER_SCRIPT, MIRROR_REPLICA_SCRIPT, MIRROR_LOADER_SCRIPT]) {
		assert.equal(/<\/script/iu.test(script), false);
		assert.equal(script.includes('<!--'), false);
	}
});

test('a mirror allows one script by nonce and loads what its view may load', () => {
	const agent = mirrorContentSecurityPolicy({ kind: 'agent' }, undefined, NONCE);
	assert.ok(agent.includes(`script-src 'nonce-${NONCE}'`));
	assert.equal(agent.includes("script-src 'unsafe-inline'"), false);
	assert.ok(agent.includes("style-src 'unsafe-inline' https:"));
	assert.ok(agent.includes('img-src data: blob: https:'));
	for (const closed of ["connect-src 'none'", "frame-src 'none'", "media-src 'none'", "form-action 'none'", "base-uri 'none'", "default-src 'none'"])
		assert.ok(agent.includes(closed), closed);

	const app = mirrorContentSecurityPolicy(
		{ kind: 'mcp-app' },
		{ resourceDomains: ['https://cdn.example'], connectDomains: ['https://api.example'], frameDomains: ['https://frames.example'] },
		NONCE,
	);
	assert.ok(app.includes("style-src 'unsafe-inline' https://cdn.example"));
	assert.ok(app.includes('img-src data: blob: https://cdn.example'));
	// A mirror reaches no server and frames nothing, whatever the view declared.
	assert.equal(app.includes('https://api.example'), false);
	assert.equal(app.includes('https://frames.example'), false);
	// A declared origin never becomes a script source of the mirror.
	assert.equal(/script-src[^;]*cdn\.example/u.test(app), false);
});

test('a mirror document is the policy, then the replica, and nothing else', () => {
	const html = buildMirrorDocument({ kind: 'agent' }, undefined, NONCE);
	assert.ok(html.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"'));
	assert.equal(html.split('<script').length, 2);
	assert.ok(html.includes(`<script nonce="${NONCE}">`));
	assert.throws(() => buildMirrorDocument({ kind: 'agent' }, undefined, 'x" onload="alert(1)'), TypeError);
	// Each document gets its own nonce.
	assert.notEqual(buildMirrorDocument({ kind: 'agent' }, undefined), buildMirrorDocument({ kind: 'agent' }, undefined));
});

// --- the recorder link ---

const wrap = (value: unknown) => ({ terminayMirror: value });
const batch = (overrides: Record<string, unknown> = {}) =>
	wrap({ type: 'batch', epoch: 1, seq: 0, kind: 'snapshot', data: '[]', ...overrides });

test('a batch is accepted only when well formed and within the limits', () => {
	assert.deepEqual(parseMirrorBatch(batch()), { epoch: 1, seq: 0, kind: 'snapshot', data: '[]' });
	assert.deepEqual(parseMirrorBatch(batch({ kind: 'unavailable', reason: 'too-large' })), {
		epoch: 1, seq: 0, kind: 'unavailable', data: '[]', reason: 'too-large',
	});
	for (const bad of [
		null,
		'text',
		{},
		wrap(null),
		wrap({ type: 'ack' }),
		batch({ kind: 'video' }),
		batch({ epoch: -1 }),
		batch({ seq: 1.5 }),
		batch({ data: 7 }),
		batch({ reason: 'because' }),
		batch({ data: 'x'.repeat(MIRROR_MAX_PART_BYTES + 1) }),
		batch({ kind: 'events', data: 'x'.repeat(MIRROR_MAX_BATCH_BYTES + 1) }),
		// Measured in bytes, not characters.
		batch({ kind: 'events', data: 'é'.repeat(MIRROR_MAX_BATCH_BYTES / 2 + 1) }),
	])
		assert.equal(parseMirrorBatch(bad), undefined);
	assert.ok(parseMirrorBatch(batch({ data: 'x'.repeat(MIRROR_MAX_PART_BYTES) })));
});

function link(publish: (batch: unknown) => Promise<void> = async () => {}) {
	const posted: unknown[] = [];
	const published: unknown[] = [];
	const recorder = new ViewRecorderLink({
		post: (message) => posted.push((message as { terminayMirror: unknown }).terminayMirror),
		recorderScript: 'RECORDER',
		publish: (value) => {
			published.push(value);
			return publish(value);
		},
	});
	return { recorder, posted, published };
}

test('the recorder is sent once, only when wanted, and only to a view that is running', () => {
	const { recorder, posted } = link();
	recorder.viewAlive();
	assert.deepEqual(posted, []);
	recorder.start();
	assert.deepEqual(posted, [{ type: 'load', code: 'RECORDER' }, { type: 'start' }]);
	// Wanted again means a fresh snapshot, not a second copy of the recorder.
	recorder.start();
	assert.deepEqual(posted.slice(2), [{ type: 'start' }]);
	recorder.stop();
	recorder.stop();
	assert.deepEqual(posted.slice(3), [{ type: 'stop' }]);

	const early = link();
	early.recorder.start();
	assert.deepEqual(early.posted, []);
	early.recorder.viewAlive();
	assert.deepEqual(early.posted, [{ type: 'load', code: 'RECORDER' }, { type: 'start' }]);
});

test('a batch is acknowledged once the server has taken it', async () => {
	let finish: () => void = () => {};
	const { recorder, posted, published } = link(() => new Promise<void>((resolve) => { finish = resolve; }));
	recorder.viewAlive();
	recorder.start();
	assert.equal(recorder.handle(batch()), true);
	await turn();
	assert.deepEqual(published, [{ epoch: 1, seq: 0, kind: 'snapshot', data: '[]' }]);
	assert.equal(posted.some((message) => (message as { type: string }).type === 'ack'), false);
	finish();
	await turn();
	assert.deepEqual(posted.at(-1), { type: 'ack' });
});

test('rubbish from a view is swallowed, never published, and never acknowledged', async () => {
	const { recorder, posted, published } = link();
	recorder.viewAlive();
	recorder.start();
	const before = posted.length;
	assert.equal(recorder.handle(batch({ kind: 'video' })), true);
	assert.equal(recorder.handle(wrap('nonsense')), true);
	assert.equal(recorder.handle(batch({ data: 'x'.repeat(MIRROR_MAX_PART_BYTES + 1) })), true);
	// Something that is not a mirror message is left for the view bridge.
	assert.equal(recorder.handle({ jsonrpc: '2.0', method: 'ui/initialize' }), false);
	await turn();
	assert.deepEqual(published, []);
	assert.equal(posted.length, before);
});

test('a batch nobody asked for is not published', async () => {
	const { recorder, published } = link();
	recorder.viewAlive();
	recorder.handle(batch());
	await turn();
	assert.deepEqual(published, []);
});

test('losing control ends the recording; any other failure only loses that batch', async () => {
	const forbidden = link(() => Promise.reject(Object.assign(new Error('no'), { code: 'forbidden' })));
	forbidden.recorder.viewAlive();
	forbidden.recorder.start();
	forbidden.recorder.handle(batch());
	await turn();
	assert.deepEqual(forbidden.posted.at(-1), { type: 'stop' });

	const flaky = link(() => Promise.reject(new Error('network')));
	flaky.recorder.viewAlive();
	flaky.recorder.start();
	flaky.recorder.handle(batch());
	await turn();
	assert.deepEqual(flaky.posted.at(-1), { type: 'ack' });
});

// --- the hub ---

function hub(wantedNow = false) {
	const calls: unknown[][] = [];
	let onData: (data: never) => void = () => {};
	let onGap: () => void = () => {};
	let onWanted: (sessionId: string, wanted: boolean) => void = () => {};
	const client: MirrorHubClient = {
		mirrorWanted: async (sessionId) => { calls.push(['status', sessionId]); return wantedNow; },
		watchMirror: async (sessionId) => { calls.push(['watch', sessionId]); },
		unwatchMirror: async (sessionId) => { calls.push(['unwatch', sessionId]); },
		resyncMirror: async (sessionId) => { calls.push(['resync', sessionId]); },
		publishMirror: async (windowId, value) => { calls.push(['publish', windowId, value]); },
		onMirrorData: (listener, gap) => { onData = listener as never; onGap = gap ?? (() => {}); return () => calls.push(['off-data']); },
		onMirrorWanted: (listener) => { onWanted = listener; return () => calls.push(['off-wanted']); },
	};
	const instance = new AppWindowMirrorHub(client);
	const named = (name: string) => calls.filter((call) => call[0] === name);
	const data = (overrides: Record<string, unknown> = {}) =>
		onData({ windowId: 'w1', terminalSessionId: 's1', contentRevision: 1, epoch: 1, seq: 0, kind: 'snapshot', data: 'S', ...overrides } as never);
	return { hub: instance, calls, named, data, gap: () => onGap(), wanted: (sessionId: string, value: boolean) => onWanted(sessionId, value) };
}

function sink() {
	const seen: string[] = [];
	return {
		seen,
		sink: {
			apply: (kind: string, data: string) => seen.push(`${kind}:${data}`),
			loading: () => seen.push('loading'),
			unavailable: () => seen.push('unavailable'),
		},
	};
}

function recorder() {
	const seen: string[] = [];
	return { seen, recorder: { start: () => seen.push('start'), stop: () => seen.push('stop') } };
}

test('a view records only while the server says someone is watching', async () => {
	const idle = hub(false);
	const first = recorder();
	idle.hub.registerRecorder('s1', 'w1', first.recorder);
	await turn();
	assert.deepEqual(first.seen, []);
	idle.wanted('s1', true);
	idle.wanted('other-session', true);
	assert.deepEqual(first.seen, ['start']);
	// Wanted again is a request for a fresh snapshot.
	idle.wanted('s1', true);
	idle.wanted('s1', false);
	assert.deepEqual(first.seen, ['start', 'start', 'stop']);

	// A client that takes control while others are already watching asks, and records.
	const watched = hub(true);
	const late = recorder();
	const unregister = watched.hub.registerRecorder('s1', 'w1', late.recorder);
	await turn();
	assert.deepEqual(late.seen, ['start']);
	assert.deepEqual(watched.named('status'), [['status', 's1']]);
	unregister();
	watched.wanted('s1', true);
	assert.deepEqual(late.seen, ['start']);
});

test('a mirror applies batches in order and nothing else', async () => {
	const { hub: instance, data, named } = hub();
	const { sink: target, seen } = sink();
	instance.watch('s1', 'w1', target);
	await turn();
	assert.deepEqual(named('watch'), [['watch', 's1']]);
	assert.deepEqual(seen, ['loading']);

	// Changes to a snapshot this mirror never had are not applied.
	data({ kind: 'events', seq: 3, data: 'E3' });
	assert.deepEqual(seen, ['loading', 'loading']);
	// Watching already asked for a snapshot, so the gap does not ask again.
	assert.deepEqual(named('resync'), []);

	data();
	data({ kind: 'events', seq: 1, data: 'E1' });
	data({ kind: 'events', seq: 1, data: 'E1-again' });
	data({ kind: 'events', seq: 2, data: 'E2' });
	data({ windowId: 'another-window' });
	data({ terminalSessionId: 'another-session' });
	assert.deepEqual(seen.slice(2), ['snapshot:S', 'events:E1', 'events:E2']);

	// A gap: the mirror stops showing changes and asks once for a snapshot.
	data({ kind: 'events', seq: 4, data: 'E4' });
	data({ kind: 'events', seq: 5, data: 'E5' });
	await turn();
	assert.deepEqual(seen.slice(5), ['loading', 'loading']);
	assert.deepEqual(named('resync'), [['resync', 's1']]);

	// The next snapshot starts a new epoch, and changes follow it again.
	data({ epoch: 2, data: 'S2' });
	data({ epoch: 2, kind: 'events', seq: 1, data: 'E2.1' });
	assert.deepEqual(seen.slice(7), ['snapshot:S2', 'events:E2.1']);

	// A replaced document, or a new controlling client, counts its epochs from
	// one again. Its snapshot is the new truth all the same.
	data({ epoch: 1, data: 'S-new-document' });
	data({ epoch: 1, kind: 'events', seq: 1, data: 'E-new.1' });
	assert.deepEqual(seen.slice(9), ['snapshot:S-new-document', 'events:E-new.1']);
	// Changes numbered for another snapshot are never applied to this one.
	data({ epoch: 2, kind: 'events', seq: 2, data: 'stray' });
	assert.equal(seen.at(-1), 'loading');
});

test('a view that cannot be mirrored, a failed replica, and lost events each leave the mirror waiting', async () => {
	const { hub: instance, data, named, gap } = hub();
	const { sink: target, seen } = sink();
	instance.watch('s1', 'w1', target);
	data();
	data({ kind: 'unavailable', seq: 1, reason: 'too-large', data: '[]' });
	assert.deepEqual(seen, ['loading', 'snapshot:S', 'unavailable']);
	// It comes back by itself with the next snapshot.
	data({ epoch: 2, data: 'S2' });
	assert.equal(seen.at(-1), 'snapshot:S2');

	instance.failed('s1', 'w1');
	await turn();
	assert.equal(seen.at(-1), 'loading');
	assert.equal(named('resync').length, 1);
	data({ epoch: 3, data: 'S3' });

	gap();
	await turn();
	assert.equal(seen.at(-1), 'loading');
	assert.equal(named('resync').length, 2);
	// Until that snapshot arrives nothing is applied.
	data({ epoch: 3, kind: 'events', seq: 1, data: 'E' });
	assert.equal(seen.at(-1), 'loading');
});

test('a terminal is watched once however many of its windows are open, and unwatched with the last', async () => {
	const { hub: instance, named } = hub();
	const stopFirst = instance.watch('s1', 'w1', sink().sink);
	const stopSecond = instance.watch('s1', 'w2', sink().sink);
	const stopOther = instance.watch('s2', 'w9', sink().sink);
	await turn();
	assert.deepEqual(named('watch'), [['watch', 's1'], ['watch', 's2']]);
	stopFirst();
	stopFirst();
	assert.deepEqual(named('unwatch'), []);
	stopSecond();
	assert.deepEqual(named('unwatch'), [['unwatch', 's1']]);
	stopOther();
	assert.deepEqual(named('unwatch'), [['unwatch', 's1'], ['unwatch', 's2']]);
});

test('disposing the hub stops watching and listening', async () => {
	const { hub: instance, calls, named } = hub();
	instance.watch('s1', 'w1', sink().sink);
	instance.dispose();
	instance.dispose();
	await turn();
	assert.deepEqual(named('unwatch'), [['unwatch', 's1']]);
	assert.equal(calls.filter((call) => call[0] === 'off-data' || call[0] === 'off-wanted').length, 2);
});

// --- snapshots streamed in parts ---

test('a snapshot may say it comes in parts; nothing else may', () => {
	assert.deepEqual(parseMirrorBatch(batch({ parts: 3 })), { epoch: 1, seq: 0, kind: 'snapshot', data: '[]', parts: 3 });
	assert.deepEqual(parseMirrorBatch(batch({ seq: 2, parts: 3 })), { epoch: 1, seq: 2, kind: 'snapshot', data: '[]', parts: 3 });
	for (const bad of [
		batch({ parts: 1 }),
		batch({ parts: 0 }),
		batch({ parts: 2.5 }),
		batch({ parts: '3' }),
		batch({ parts: 257 }),
		batch({ kind: 'events', seq: 1, parts: 3 }),
		batch({ kind: 'unavailable', parts: 3 }),
	])
		assert.equal(parseMirrorBatch(bad), undefined);
});

test('a snapshot in parts is applied once, whole, and changes wait for it', async () => {
	const { hub: instance, data, named } = hub();
	const { sink: target, seen } = sink();
	instance.watch('s1', 'w1', target);
	data({ parts: 3, data: 'A' });
	data({ seq: 1, data: 'B' });
	// Not drawn until the last part is here.
	assert.deepEqual(seen, ['loading']);
	data({ seq: 2, data: 'C' });
	assert.deepEqual(seen, ['loading', 'snapshot:ABC']);
	// Changes are numbered after the parts.
	data({ kind: 'events', seq: 3, data: 'E3' });
	assert.deepEqual(seen.slice(2), ['events:E3']);

	// A new snapshot arriving in parts: the mirror keeps what it shows meanwhile.
	data({ epoch: 2, parts: 2, data: 'X' });
	assert.equal(seen.length, 3);
	// A change that arrives before the snapshot is whole is a gap.
	data({ epoch: 2, kind: 'events', seq: 1, data: 'too early' });
	await turn();
	assert.equal(seen.at(-1), 'loading');
	assert.equal(named('resync').length, 1);
	// What is left of the abandoned snapshot does not ask again.
	data({ epoch: 2, seq: 1, data: 'Y' });
	await turn();
	assert.equal(named('resync').length, 1);

	// A part lost on the way is a gap too.
	data({ epoch: 3, parts: 3, data: 'P' });
	data({ epoch: 3, seq: 2, data: 'R' });
	await turn();
	assert.equal(seen.at(-1), 'loading');
	assert.equal(named('resync').length, 2);
	data({ epoch: 4, parts: 2, data: 'P' });
	data({ epoch: 4, seq: 1, data: 'Q' });
	assert.equal(seen.at(-1), 'snapshot:PQ');
});

test('a mirror that never gets a whole snapshot stops asking and says it cannot be mirrored', async () => {
	const { hub: instance, data, named } = hub();
	const { sink: target, seen } = sink();
	instance.watch('s1', 'w1', target);
	// Each snapshot loses its second part.
	for (let epoch = 1; epoch <= 6; epoch += 1) {
		data({ epoch, parts: 3, data: 'P' });
		data({ epoch, seq: 2, data: 'R' });
		await turn();
	}
	assert.equal(named('resync').length, 4);
	assert.equal(seen.at(-1), 'unavailable');
	// A snapshot that does arrive whole brings it back, and it may ask again later.
	data({ epoch: 7 });
	assert.equal(seen.at(-1), 'snapshot:S');
	data({ epoch: 7, kind: 'events', seq: 5, data: 'gap' });
	await turn();
	assert.equal(named('resync').length, 5);
});
