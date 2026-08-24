import {
	createTerminayHostBytePacket,
	parseTerminayHostActionRequest,
	parseTerminayHostBytePacket,
	parseTerminayHostContext,
	parseTerminayHostEvent,
	type TerminayHostActionRequest,
	type TerminayHostContext,
} from '@terminay/protocol';
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ServerUiHostBridge } from './serverUiHostContract';

const GET_CONTEXT = 'server-ui-host:get-context';
const REQUEST_ACTION = 'server-ui-host:request-action';
const READ_TERMINAL_CLIPBOARD = 'server-ui-host:read-terminal-clipboard';
let contextPromise: Promise<TerminayHostContext> | undefined;
const context = () =>
	(contextPromise ??= ipcRenderer
		.invoke(GET_CONTEXT)
		.then(parseTerminayHostContext));

// The workspace has several independent native-event consumers (menu commands,
// zoom, settings, drag state, and so on). Keep exactly one Electron listener
// for the document and fan its validated events out to those consumers. Adding
// one ipcRenderer listener per React hook triggers Electron's listener warning
// during ordinary use and makes remount behaviour needlessly noisy.
const eventListeners = new Set<
	(listener: ReturnType<typeof parseTerminayHostEvent>) => Promise<void> | void
>();
const latestEvents = new Map<
	ReturnType<typeof parseTerminayHostEvent>['event']['type'],
	ReturnType<typeof parseTerminayHostEvent>
>();

/**
 * Commands are edges, not state. Replaying a native menu command whenever a
 * React consumer re-subscribes repeats destructive actions (for example,
 * creating a new project). Only stateful host publications are eligible for
 * late-subscriber replay.
 */
const isReplayableHostEvent = (
	event: ReturnType<typeof parseTerminayHostEvent>,
): boolean =>
	event.event.type === 'terminal.zoom' ||
	event.event.type === 'workspace.drag-state' ||
	event.event.type === 'device.settings.changed';
let hostEventsSubscribed = false;
const deliverEvent = (
	listener: (
		event: ReturnType<typeof parseTerminayHostEvent>,
	) => Promise<void> | void,
	event: ReturnType<typeof parseTerminayHostEvent>,
) => {
	try {
		void Promise.resolve(listener(event)).catch(() => undefined);
	} catch {
		// A renderer subscriber must not destabilize the shared host bridge.
	}
};
const hostEventWrapper = (
	_event: Electron.IpcRendererEvent,
	event: unknown,
) => {
	void context()
		.then((bound) =>
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
		)
		.then((parsed) => {
			if (isReplayableHostEvent(parsed)) {
				latestEvents.set(parsed.event.type, parsed);
			}
			for (const listener of [...eventListeners])
				deliverEvent(listener, parsed);
		})
		.catch(() => undefined);
};

const bridge: ServerUiHostBridge = Object.freeze({
	getContext: context,
	requestAction: async (request: TerminayHostActionRequest) => {
		const bound = await context();
		return ipcRenderer.invoke(
			REQUEST_ACTION,
			parseTerminayHostActionRequest(request, bound),
		);
	},
	subscribeEvent: (listener) => {
		if (typeof listener !== 'function')
			throw new TypeError('app command listener is invalid');
		eventListeners.add(listener);
		for (const event of latestEvents.values()) deliverEvent(listener, event);
		if (!hostEventsSubscribed) {
			hostEventsSubscribed = true;
			ipcRenderer.on('server-ui-host:event', hostEventWrapper);
			ipcRenderer.send('server-ui-host:subscribe-events');
		}
		return () => {
			eventListeners.delete(listener);
			if (eventListeners.size !== 0 || !hostEventsSubscribed) return;
			hostEventsSubscribed = false;
			ipcRenderer.off('server-ui-host:event', hostEventWrapper);
		};
	},
	// Electron exposes a native pathname only to preload through webUtils. Keep
	// that value out of IPC and return it solely for a direct, user-initiated
	// Desktop terminal drop; browser File objects resolve to an empty path.
	resolveDroppedFilePath: (file) => {
		try {
			const path = webUtils.getPathForFile(file);
			return path.length > 0 && path.length <= 32_768 && !path.includes('\0')
				? path
				: undefined;
		} catch {
			return undefined;
		}
	},
	// Clipboard reads are intentionally narrower than a general Electron API.
	// The bound Desktop document may request terminal-ready text, including a
	// shell-escaped temporary image path, through the exact host IPC binding.
	readTerminalClipboard: () => {
		return ipcRenderer.invoke(READ_TERMINAL_CLIPBOARD) as Promise<string>;
	},
});
if (
	(process as NodeJS.Process & { isMainFrame?: boolean }).isMainFrame !== false
)
	contextBridge.exposeInMainWorld('terminayHost', bridge);

let bytePort: MessagePort | undefined;
let bytePortGeneration = 0;
const bytePortWaiters = new Set<{
	afterGeneration: number;
	resolve: (port: MessagePort) => void;
}>();
const waitForBytePort = (afterGeneration = -1): Promise<MessagePort> => {
	if (bytePort !== undefined && bytePortGeneration > afterGeneration)
		return Promise.resolve(bytePort);
	return new Promise((resolve) =>
		bytePortWaiters.add({ afterGeneration, resolve }),
	);
};
const byteListeners = new Set<(frame: Uint8Array | null) => void>();
ipcRenderer.on('server-ui-host:byte-endpoint', (event) => {
	const port = event.ports[0];
	if (!port) return;
	bytePort?.close();
	bytePort = port;
	bytePortGeneration += 1;
	for (const waiter of [...bytePortWaiters]) {
		if (bytePortGeneration <= waiter.afterGeneration) continue;
		bytePortWaiters.delete(waiter);
		waiter.resolve(port);
	}
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
	replaceEndpoint: async () => {
		const generation = bytePortGeneration;
		ipcRenderer.send('server-ui-host:replace-byte-endpoint');
		await waitForBytePort(generation);
	},
	send: async (frame: Uint8Array) => {
		const bound = await context();
		if (
			!(frame instanceof Uint8Array) ||
			frame.byteLength === 0 ||
			frame.byteLength > 16_777_216
		)
			throw new TypeError('server frame must be bounded bytes');
		const port = bytePort ?? (await waitForBytePort());
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

// The preload owns the byte-port listener. Tell main only after that listener
// exists, so a workspace child cannot race its initial endpoint handoff while
// React is still compiling/mounting the selected view.
if (
	(process as NodeJS.Process & { isMainFrame?: boolean }).isMainFrame !== false
)
	ipcRenderer.send('server-ui-host:document-ready');

// Agent journal records are privileged server lifecycle input, so production
// renderer code has no operation that can manufacture them. The E2E harness
// gets one deliberately narrow, production-inert seam to exercise the real
// server-owned journal reducer and its canonical client projection.
if (
	process.env.TERMINAY_TEST === '1' &&
	(process as NodeJS.Process & { isMainFrame?: boolean }).isMainFrame !== false
) {
	contextBridge.exposeInMainWorld(
		'terminayWorkspaceTest',
		Object.freeze({
			resetCommandRecords: () =>
				ipcRenderer.invoke(
					'test:reset-workspace-command-records',
				) as Promise<void>,
			getCommandRecords: () =>
				ipcRenderer.invoke('test:get-workspace-command-records') as Promise<
					readonly {
						operation: string;
						command?: {
							type: string;
							projectId?: string;
							sidebar?: Record<string, unknown>;
						};
					}[]
				>,
		}),
	);
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
			}) =>
				ipcRenderer.invoke(
					'test:set-ai-tab-metadata-mock',
					mock,
				) as Promise<void>,
		}),
	);
	contextBridge.exposeInMainWorld(
		'terminayAgentStatusTest',
		Object.freeze({
			publishLifecycle: (payload: {
				provider: string;
				terminalSessionId: string;
				providerSessionId: string;
				events: ReadonlyArray<Record<string, unknown>>;
			}) =>
				ipcRenderer.invoke(
					'test:publish-agent-lifecycle',
					payload,
				) as Promise<boolean>,
		}),
	);
}
