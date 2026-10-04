/**
 * The smallest host for the view mirror: one recorded view and one replica,
 * each in its own sandbox proxy, wired straight to each other. It exercises the
 * recorder and the replica inside the real sandbox without a server or the
 * window layer.
 */
import { MIRROR_RECORDER_SCRIPT } from '../../src/workspace/appWindows/mirror/bundles.generated';
import { buildMirrorDocument } from '../../src/workspace/appWindows/mirror/mirrorDocument';
import { MIRROR_MESSAGE_KEY } from '../../src/workspace/appWindows/mirror/mirrorProtocol';
import { buildViewDocument } from '../../src/workspace/appWindows/viewDocument';

const READY = 'ui/notifications/sandbox-proxy-ready';
const RESOURCE = 'ui/notifications/sandbox-resource-ready';

type Batch = { type: string; epoch: number; seq: number; kind: string; data: string; reason?: string; parts?: number };

const state = {
	batches: [] as { epoch: number; seq: number; kind: string; bytes: number; parts?: number; reason?: string }[],
	reports: [] as unknown[],
	/** While true, batches are neither forwarded nor acknowledged. */
	hold: false,
};

function proxy(id: string, width: number): HTMLIFrameElement {
	const frame = document.createElement('iframe');
	frame.id = id;
	frame.setAttribute('sandbox', 'allow-scripts allow-forms');
	frame.style.cssText = `width:${width}px;height:320px;border:1px solid #444;display:block;margin:8px`;
	frame.src = new URL('app-view.html', document.baseURI).href;
	document.body.append(frame);
	return frame;
}

function start(viewHtml: string): void {
	const view = proxy('view', 440);
	const replica = proxy('replica', 440);
	const send = (frame: HTMLIFrameElement, message: unknown) => frame.contentWindow?.postMessage(message, '*');
	const mirror = (frame: HTMLIFrameElement, message: unknown) => send(frame, { [MIRROR_MESSAGE_KEY]: message });
	let replicaReady = false;
	let waiting: Batch[] = [];
	// As a watching client does: a snapshot sent in parts is put back together
	// before the replica is given it.
	let assembling: string[] = [];
	const forward = (batch: Batch) => {
		if (batch.kind === 'snapshot') {
			if (batch.seq === 0) assembling = [];
			assembling.push(batch.data);
			if (assembling.length === (batch.parts ?? 1))
				mirror(replica, { type: 'apply', kind: 'snapshot', data: assembling.join('') });
		} else if (batch.kind === 'events') mirror(replica, { type: 'apply', kind: 'events', data: batch.data });
		mirror(view, { type: 'ack' });
	};

	addEventListener('message', (event) => {
		const from = event.source === view.contentWindow ? view : event.source === replica.contentWindow ? replica : null;
		if (from === null) return;
		const data = event.data as Record<string, unknown> | null;
		if (data?.method === READY) {
			if (from === view) {
				const built = buildViewDocument({ html: viewHtml, source: { kind: 'agent' } });
				send(view, { jsonrpc: '2.0', method: RESOURCE, params: built });
			} else {
				send(replica, {
					jsonrpc: '2.0',
					method: RESOURCE,
					params: { html: buildMirrorDocument({ kind: 'agent' }, undefined), allow: '' },
				});
			}
			return;
		}
		// The agent bootstrap's handshake: answer enough for it to settle.
		if (from === view && data?.jsonrpc === '2.0' && data.id !== undefined && typeof data.method === 'string') {
			send(view, { jsonrpc: '2.0', id: data.id, result: {} });
			return;
		}
		const message = data?.[MIRROR_MESSAGE_KEY] as Batch | { type: string } | undefined;
		if (message === undefined) return;
		if (from === replica) {
			state.reports.push(message);
			if (message.type === 'ready') {
				replicaReady = true;
				mirror(view, { type: 'load', code: MIRROR_RECORDER_SCRIPT });
				mirror(view, { type: 'start' });
				for (const batch of waiting) forward(batch);
				waiting = [];
			}
			return;
		}
		if (message.type !== 'batch') return;
		const batch = message as Batch;
		state.batches.push({
			epoch: batch.epoch,
			seq: batch.seq,
			kind: batch.kind,
			bytes: new Blob([batch.data]).size,
			...(batch.parts === undefined ? {} : { parts: batch.parts }),
			...(batch.reason === undefined ? {} : { reason: batch.reason }),
		});
		if (state.hold || !replicaReady) waiting.push(batch);
		else forward(batch);
	});

	Object.assign(window, {
		mirrorSpike: {
			state,
			resnapshot: () => mirror(view, { type: 'start' }),
			stop: () => mirror(view, { type: 'stop' }),
			/** Give the replica a recording the view never made, as a hostile view could. */
			forge: (data: string) => mirror(replica, { type: 'apply', kind: 'snapshot', data }),
			release: () => {
				state.hold = false;
				for (const batch of waiting) forward(batch);
				waiting = [];
			},
		},
	});
}

Object.assign(window, { startMirrorSpike: start });
