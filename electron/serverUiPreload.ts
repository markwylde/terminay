import {
	createTerminayHostBytePacket,
	parseTerminayHostActionRequest,
	parseTerminayHostBytePacket,
	parseTerminayHostContext,
	parseTerminayHostEvent,
	type TerminayHostActionRequest,
	type TerminayHostContext,
} from '@terminay/protocol';
import { contextBridge, ipcRenderer } from 'electron';
import type { ServerUiHostBridge } from './serverUiHostContract';

const GET_CONTEXT = 'server-ui-host:get-context';
const REQUEST_ACTION = 'server-ui-host:request-action';
let contextPromise: Promise<TerminayHostContext> | undefined;
const context = () =>
	(contextPromise ??= ipcRenderer
		.invoke(GET_CONTEXT)
		.then(parseTerminayHostContext));

const bridge: ServerUiHostBridge = Object.freeze({
	getContext: context,
	requestAction: async (request: TerminayHostActionRequest) => {
		const bound = await context();
		await ipcRenderer.invoke(
			REQUEST_ACTION,
			parseTerminayHostActionRequest(request, bound),
		);
	},
	subscribeEvent: (listener) => {
		if (typeof listener !== 'function')
			throw new TypeError('app command listener is invalid');
		const wrapper = (
			_event: Electron.IpcRendererEvent,
			event: unknown,
		) => {
			void context().then((bound) =>
				listener(
					parseTerminayHostEvent(
						{
							bridgeVersion: 1,
							event,
							profileId: bound.profileId,
							schemaVersion: 1,
							serverId: bound.serverId,
							sourceId: bound.sourceId,
							windowId: bound.windowId,
						},
						bound,
					),
				),
			);
		};
		ipcRenderer.on('server-ui-host:event', wrapper);
		ipcRenderer.send('server-ui-host:subscribe-events');
		return () => ipcRenderer.off('server-ui-host:event', wrapper);
	},
});
if (
	(process as NodeJS.Process & { isMainFrame?: boolean }).isMainFrame !== false
)
	contextBridge.exposeInMainWorld('terminayHost', bridge);

let bytePort: MessagePort | undefined;
let resolveBytePort: ((port: MessagePort) => void) | undefined;
const bytePortReady = new Promise<MessagePort>((resolve) => {
	resolveBytePort = resolve;
});
const byteListeners = new Set<(frame: Uint8Array | null) => void>();
ipcRenderer.on('server-ui-host:byte-endpoint', (event) => {
	const port = event.ports[0];
	if (!port || bytePort !== undefined) {
		port?.close();
		return;
	}
	bytePort = port;
	resolveBytePort?.(port);
	resolveBytePort = undefined;
	port.onmessage = (message) =>
		void context().then((bound) => {
			try {
				const packet = parseTerminayHostBytePacket(
					message.data,
					bound.serverId,
				);
				for (const listener of byteListeners) listener(packet.frame);
			} catch {
				for (const listener of byteListeners) listener(null);
			}
		});
	port.onmessageerror = () => {
		for (const listener of byteListeners) listener(null);
	};
	port.start();
});

const bytes = Object.freeze({
	version: 1,
	send: async (frame: Uint8Array) => {
		const bound = await context();
		if (
			!(frame instanceof Uint8Array) ||
			frame.byteLength === 0 ||
			frame.byteLength > 16_777_216
		)
			throw new TypeError('server frame must be bounded bytes');
		const port = bytePort ?? (await bytePortReady);
		port.postMessage(createTerminayHostBytePacket(bound.serverId, frame));
	},
	subscribe: (listener: (frame: Uint8Array | null) => void) => {
		if (typeof listener !== 'function')
			throw new TypeError('byte listener is invalid');
		byteListeners.add(listener);
		return () => byteListeners.delete(listener);
	},
});
if (
	(process as NodeJS.Process & { isMainFrame?: boolean }).isMainFrame !== false
)
	contextBridge.exposeInMainWorld('terminayBytes', bytes);

// Agent journal records are privileged server lifecycle input, so production
// renderer code has no operation that can manufacture them. The E2E harness
// gets one deliberately narrow, production-inert seam to exercise the real
// server-owned journal reducer and its canonical client projection.
if (
	process.env.TERMINAY_TEST === '1' &&
	(process as NodeJS.Process & { isMainFrame?: boolean }).isMainFrame !== false
) {
	contextBridge.exposeInMainWorld(
		'terminayLocalConnectionFaultTest',
		Object.freeze({
			failActiveConnection: async () => {
				if (byteListeners.size !== 1) {
					throw new Error(
						`Expected one active Local connection generation, found ${byteListeners.size}`,
					);
				}
				const bound = await context();
				for (const listener of [...byteListeners]) listener(null);
				return { connectionId: `local:${bound.windowId}` };
			},
		}),
	);
	contextBridge.exposeInMainWorld(
		'terminayAiMetadataTest',
		Object.freeze({
			setMock: (mock: {
				error?: string | null;
				models?: readonly Readonly<{ id: string; label: string }>[];
				noteResult?: string;
				titleResult?: string;
			}) => ipcRenderer.invoke('test:set-ai-tab-metadata-mock', mock) as Promise<void>,
		}),
	);
	contextBridge.exposeInMainWorld(
		'terminayAgentStatusTest',
		Object.freeze({
			emitJournalRecord: (payload: {
				provider: 'codex' | 'claude';
				terminalSessionId: string;
				record: Record<string, unknown>;
			}) =>
				ipcRenderer.invoke(
					'test:emit-agent-journal-record',
					payload,
				) as Promise<boolean>,
		}),
	);
}
