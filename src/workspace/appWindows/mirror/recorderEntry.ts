/**
 * The view recorder (ADR-0039). This file is bundled with `rrweb` into one
 * script and inlined into every view document. It runs inside the untrusted
 * view, idle until the workspace says someone is watching.
 *
 * It sends one batch at a time and waits for the workspace to acknowledge it,
 * so a slow connection slows the recording down instead of queueing without
 * bound.
 */
import { record } from 'rrweb';
import {
	MIRROR_MAX_BATCH_BYTES,
	MIRROR_MAX_BYTES_PER_SECOND,
	MIRROR_MAX_SNAPSHOT_BYTES,
	MIRROR_MESSAGE_KEY,
	type MirrorBatch,
	type MirrorRecorderControl,
} from './mirrorProtocol.ts';

/** rrweb event types this file needs to tell apart. */
const META_EVENT = 4;
/** Changes are gathered for this long before they are sent together. */
const BATCH_DELAY_MS = 40;

(() => {
	let stop: (() => void) | undefined;
	let recording = false;
	let epoch = 0;
	let seq = 0;
	/** Events of the current epoch not yet sent. The first batch of an epoch is its snapshot. */
	let queue: unknown[] = [];
	let snapshotPending = false;
	let inFlight = false;
	let scheduled = false;
	/** The current epoch was abandoned; nothing more is sent until a new one starts. */
	let halted = false;
	let windowStartedAt = 0;
	let windowBytes = 0;

	const post = (batch: Omit<MirrorBatch, 'type'>): void => {
		inFlight = true;
		parent.postMessage({ [MIRROR_MESSAGE_KEY]: { type: 'batch', ...batch } }, '*');
	};

	const unavailable = (reason: 'too-large' | 'too-busy'): void => {
		halted = true;
		recording = false;
		queue = [];
		snapshotPending = false;
		stop?.();
		stop = undefined;
		post({ epoch, seq: seq++, kind: 'unavailable', data: '[]', reason });
	};

	const flush = (): void => {
		scheduled = false;
		if (inFlight || halted || queue.length === 0) return;
		const data = JSON.stringify(queue);
		// UTF-16 length is a floor for the byte size; a cheap, safe-side check
		// follows with the real size only when it could matter.
		const bytes = data.length * 3 > MIRROR_MAX_BATCH_BYTES ? new Blob([data]).size : data.length;
		if (snapshotPending) {
			if (bytes > MIRROR_MAX_SNAPSHOT_BYTES) {
				unavailable('too-large');
				return;
			}
		} else if (bytes > MIRROR_MAX_BATCH_BYTES) {
			// Too much changed to send as changes: start again from a snapshot.
			queue = [];
			record.takeFullSnapshot(true);
			return;
		}
		const now = Date.now();
		if (now - windowStartedAt > 1000) {
			windowStartedAt = now;
			windowBytes = 0;
		}
		windowBytes += bytes;
		if (!snapshotPending && windowBytes > MIRROR_MAX_BYTES_PER_SECOND) {
			unavailable('too-busy');
			return;
		}
		queue = [];
		const kind = snapshotPending ? 'snapshot' : 'events';
		snapshotPending = false;
		post({ epoch, seq: seq++, kind, data });
	};

	const schedule = (): void => {
		if (scheduled || inFlight) return;
		scheduled = true;
		setTimeout(flush, BATCH_DELAY_MS);
	};

	const emit = (event: { type: number }): void => {
		// rrweb can deliver a last event after it has been stopped. Nothing is
		// waiting for it, and sending it would wait for an answer that never comes.
		if (halted || !recording) return;
		if (event.type === META_EVENT) {
			// A snapshot is on its way: whatever was waiting belongs to a view
			// state the snapshot replaces.
			epoch += 1;
			seq = 0;
			queue = [];
			snapshotPending = true;
		}
		queue.push(event);
		schedule();
	};

	const start = (): void => {
		halted = false;
		if (stop !== undefined) {
			record.takeFullSnapshot(true);
			return;
		}
		// A fresh recording owes nothing to whatever the last one left unsent.
		queue = [];
		inFlight = false;
		// rrweb emits the first snapshot before `record` returns.
		recording = true;
		stop = record({
			emit,
			maskInputOptions: { password: true },
			recordCanvas: false,
			recordCrossOriginIframes: false,
			collectFonts: false,
			inlineStylesheet: true,
			inlineImages: false,
			sampling: { mousemove: 50, scroll: 100 },
		}) as (() => void) | undefined;
	};

	addEventListener('message', (event) => {
		if (event.source !== parent) return;
		const control = (event.data as Record<string, MirrorRecorderControl> | null)?.[MIRROR_MESSAGE_KEY];
		if (typeof control !== 'object' || control === null) return;
		if (control.type === 'start') start();
		else if (control.type === 'stop') {
			recording = false;
			stop?.();
			stop = undefined;
			queue = [];
			inFlight = false;
			halted = false;
			snapshotPending = false;
		} else if (control.type === 'ack') {
			inFlight = false;
			if (queue.length > 0) schedule();
		}
	});
})();
