/**
 * The view recorder (ADR-0039). This file is bundled with `rrweb` into one
 * script that the workspace sends to a view the first time someone watches it.
 * It runs inside the untrusted view.
 *
 * It sends one batch at a time and waits for the workspace to acknowledge it,
 * so a slow connection slows the recording down instead of queueing without
 * bound. A snapshot is streamed as a run of parts, so its size is not limited
 * by what one message may carry.
 */
import { record } from 'rrweb';
import {
	MIRROR_MAX_BATCH_BYTES,
	MIRROR_MAX_SNAPSHOT_PARTS,
	MIRROR_MESSAGE_KEY,
	MIRROR_SNAPSHOT_PART_CHARS,
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
	/** The parts of the snapshot being sent that have not gone yet. */
	let parts: string[] = [];
	let partCount = 0;
	let inFlight = false;
	let scheduled = false;
	/** The current epoch was abandoned; nothing more is sent until a new one starts. */
	let halted = false;

	const post = (batch: Omit<MirrorBatch, 'type'>): void => {
		inFlight = true;
		parent.postMessage({ [MIRROR_MESSAGE_KEY]: { type: 'batch', ...batch } }, '*');
	};

	const unavailable = (reason: 'too-large' | 'too-busy'): void => {
		halted = true;
		recording = false;
		queue = [];
		parts = [];
		snapshotPending = false;
		stop?.();
		stop = undefined;
		post({ epoch, seq: seq++, kind: 'unavailable', data: '[]', reason });
	};

	/** Cut a snapshot into parts small enough to send, never through a surrogate pair. */
	const split = (data: string): string[] => {
		const pieces: string[] = [];
		let at = 0;
		while (at < data.length) {
			let end = Math.min(at + MIRROR_SNAPSHOT_PART_CHARS, data.length);
			if (end < data.length) {
				const unit = data.charCodeAt(end - 1);
				if (unit >= 0xd800 && unit <= 0xdbff) end -= 1;
			}
			pieces.push(data.slice(at, end));
			at = end;
		}
		return pieces;
	};

	const sendPart = (): void => {
		const data = parts.shift();
		if (data === undefined) return;
		post({ epoch, seq: seq++, kind: 'snapshot', data, ...(partCount > 1 ? { parts: partCount } : {}) });
	};

	const flush = (): void => {
		scheduled = false;
		if (inFlight || halted) return;
		// A snapshot goes out whole, part after part, before any change to it.
		if (parts.length > 0) {
			sendPart();
			return;
		}
		if (queue.length === 0) return;
		const data = JSON.stringify(queue);
		if (snapshotPending) {
			const pieces = split(data);
			if (pieces.length > MIRROR_MAX_SNAPSHOT_PARTS) {
				unavailable('too-large');
				return;
			}
			queue = [];
			snapshotPending = false;
			parts = pieces;
			partCount = pieces.length;
			sendPart();
			return;
		}
		// UTF-16 length is a floor for the byte size; the real size is measured
		// only when it could matter.
		const bytes = data.length * 3 > MIRROR_MAX_BATCH_BYTES ? new Blob([data]).size : data.length;
		if (bytes > MIRROR_MAX_BATCH_BYTES) {
			// Too much changed to send as changes: start again from a snapshot.
			queue = [];
			record.takeFullSnapshot(true);
			return;
		}
		queue = [];
		post({ epoch, seq: seq++, kind: 'events', data });
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
			// A snapshot is on its way: whatever was waiting, and whatever is left
			// of a snapshot still being sent, belongs to a view state it replaces.
			epoch += 1;
			seq = 0;
			queue = [];
			parts = [];
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
		parts = [];
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
			parts = [];
			inFlight = false;
			halted = false;
			snapshotPending = false;
		} else if (control.type === 'ack') {
			inFlight = false;
			// The rest of a snapshot follows at once; changes are gathered first.
			if (parts.length > 0) flush();
			else if (queue.length > 0) schedule();
		}
	});
})();
