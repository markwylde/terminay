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
import type {
	ServerUiByteBridge,
	ServerUiHostBridge,
} from './serverUiHostContract';

import {
	DESKTOP_ENDPOINT_HANDOFF_TIMEOUT_MS,
	DESKTOP_PAIRING_REQUIRED,
	DESKTOP_REMOTE_SETUP_TIMEOUT_MS,
	RECOVER_REMOTE_ENDPOINT,
	REMOTE_ENDPOINT_RECEIVED,
	REMOTE_RESUME,
	type DesktopRemoteRecoveryFailure,
	type DesktopRemoteRecoveryResult,
} from './desktopRemoteRecoveryContract';

const GET_CONTEXT = 'server-ui-host:get-context';
const REQUEST_ACTION = 'server-ui-host:request-action';
const READ_TERMINAL_CLIPBOARD = 'server-ui-host:read-terminal-clipboard';
const READ_TERMINAL_CLIPBOARD_FOR_UPLOAD =
	'server-ui-host:read-terminal-clipboard-for-upload';
const READ_TERMINAL_CLIPBOARD_FILE_PART =
	'server-ui-host:read-terminal-clipboard-file-part';
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
	event.event.type === 'window.fullscreen-state' ||
	event.event.type === 'device.settings.changed' ||
	event.event.type === 'diagnostics.performance-logging.changed' ||
	event.event.type === 'connection.pairing-progress';
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

const CLIPBOARD_SYNC = 'server-ui-host:clipboard-sync';

const bridge: ServerUiHostBridge = Object.freeze({
	startClipboardSync: (token) =>
		ipcRenderer.invoke(`${CLIPBOARD_SYNC}:start`, token),
	stopClipboardSync: (token) =>
		ipcRenderer.invoke(`${CLIPBOARD_SYNC}:stop`, token),
	writeClipboardSync: (token, revision, text) =>
		ipcRenderer.invoke(`${CLIPBOARD_SYNC}:write`, token, revision, text),
	subscribeClipboardSync: (listener) => {
		const receive = (
			_event: Electron.IpcRendererEvent,
			snapshot: Parameters<typeof listener>[0],
		) => listener(snapshot);
		ipcRenderer.on(CLIPBOARD_SYNC, receive);
		return () => {
			ipcRenderer.off(CLIPBOARD_SYNC, receive);
		};
	},
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
	// A paste into a terminal on another server: copied files are named, never
	// pathed, and only the files named by the latest read can be read back.
	readTerminalClipboardForUpload: () =>
		ipcRenderer.invoke(READ_TERMINAL_CLIPBOARD_FOR_UPLOAD),
	readTerminalClipboardFilePart: (token, file, offset, length) =>
		ipcRenderer.invoke(
			READ_TERMINAL_CLIPBOARD_FILE_PART,
			token,
			file,
			offset,
			length,
		),
});
if (
	(process as NodeJS.Process & { isMainFrame?: boolean }).isMainFrame !== false
)
	contextBridge.exposeInMainWorld('terminayHost', bridge);

let bytePort: MessagePort | undefined;
let bytePortGeneration = 0;
let remoteGeneration: number | undefined;
let closedRemotePort: MessagePort | undefined;
let remoteClaim: number | undefined;
let remoteRecovery: number | undefined;
const remotePortWaiters = new Set<() => void>();

function waitForRemotePort(
	generation: number,
	timeoutMs: number,
): Promise<MessagePort> {
	return new Promise((resolve, reject) => {
		const done = () => {
			clearTimeout(timer);
			remotePortWaiters.delete(check);
		};
		const check = () => {
			if (
				bytePort === undefined ||
				remoteGeneration === undefined ||
				remoteGeneration < generation
			)
				return;
			done();
			resolve(bytePort);
		};
		const timer = setTimeout(() => {
			done();
			reject(remoteRecoveryError('endpoint-unavailable'));
		}, timeoutMs);
		remotePortWaiters.add(check);
		check();
	});
}

function remoteRecoveryError(outcome: DesktopRemoteRecoveryFailure): Error {
	const messages: Record<DesktopRemoteRecoveryFailure, string> = {
		timeout: 'The remote server did not answer in time. Retry connection.',
		unavailable:
			'The remote server could not be reached. Check the connection and retry.',
		'endpoint-unavailable':
			'Desktop did not receive the replacement connection. Retry connection.',
		'pairing-required': DESKTOP_PAIRING_REQUIRED,
		'window-limit':
			'Too many windows connected to this server. Close another window and retry.',
		retired: 'This remote connection was replaced.',
	};
	return new Error(messages[outcome]);
}

async function askForRemoteRecovery(
	generation: number,
	manual: boolean,
): Promise<DesktopRemoteRecoveryResult> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			ipcRenderer.invoke(RECOVER_REMOTE_ENDPOINT, generation, manual),
			new Promise<DesktopRemoteRecoveryResult>((resolve) => {
				timer = setTimeout(
					() => resolve({ outcome: 'timeout' }),
					DESKTOP_REMOTE_SETUP_TIMEOUT_MS + DESKTOP_ENDPOINT_HANDOFF_TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

const remoteResumeListeners = new Set<() => void>();
ipcRenderer.on(REMOTE_RESUME, () => {
	for (const listener of [...remoteResumeListeners]) listener();
});
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
ipcRenderer.on(
	'server-ui-host:byte-endpoint',
	(event, payload: { generation?: number }) => {
		const port = event.ports[0];
		if (!port) return;
		bytePort?.close();
		bytePort = port;
		closedRemotePort = undefined;
		remoteGeneration = payload?.generation;
		for (const wake of [...remotePortWaiters]) wake();
		bytePortGeneration += 1;
		for (const waiter of [...bytePortWaiters]) {
			if (bytePortGeneration <= waiter.afterGeneration) continue;
			bytePortWaiters.delete(waiter);
			waiter.resolve(port);
		}
		port.onmessage = (message) =>
			void context().then((bound) => {
				if (bytePort !== port) return;
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
			if (bytePort !== port) return;
			for (const listener of byteListeners) listener(null);
		};
		// Main closing its end is the server ending this connection. The page
		// must hear that now: it has no other way to learn the endpoint is dead
		// short of a heartbeat going unanswered.
		port.addEventListener('close', () => {
			if (bytePort !== port) return;
			if (remoteGeneration !== undefined) closedRemotePort = port;
			for (const listener of [...byteListeners]) listener(null);
		});
		port.start();
		if (remoteGeneration !== undefined)
			ipcRenderer.send(REMOTE_ENDPOINT_RECEIVED, remoteGeneration);
	},
);

const MAX_FRAME_BYTES = 16_777_216;

// One attached connection, one dedicated MessagePort. Main creates the channel
// while it handles `connections.attach` and posts its renderer half here with
// the sanitized server identity that binds every packet on it. The primary
// connection keeps the existing endpoint untouched, so an attached server can
// never deliver frames on the window's bound server identity.
type ConnectionEndpoint = {
	readonly connectionId: string;
	readonly serverId: string;
	readonly port: MessagePort;
	readonly listeners: Set<(frame: Uint8Array | null) => void>;
};
const connectionEndpoints = new Map<string, ConnectionEndpoint>();
const connectionWaiters = new Map<
	string,
	Set<(endpoint: ConnectionEndpoint) => void>
>();
const CONNECTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

const closeConnectionEndpoint = (endpoint: ConnectionEndpoint) => {
	if (connectionEndpoints.get(endpoint.connectionId) === endpoint)
		connectionEndpoints.delete(endpoint.connectionId);
	for (const listener of [...endpoint.listeners]) listener(null);
	endpoint.listeners.clear();
	try {
		endpoint.port.close();
	} catch {
		// A port already retired by main needs no renderer-side teardown.
	}
};

ipcRenderer.on(
	'server-ui-host:connection-endpoint',
	(event, payload: unknown) => {
		const port = event.ports[0];
		if (!port) return;
		const record = payload as { connectionId?: unknown; serverId?: unknown };
		if (
			typeof record?.connectionId !== 'string' ||
			!CONNECTION_ID.test(record.connectionId) ||
			typeof record.serverId !== 'string' ||
			!CONNECTION_ID.test(record.serverId)
		) {
			port.close();
			return;
		}
		const connectionId = record.connectionId;
		const serverId = record.serverId;
		const existing = connectionEndpoints.get(connectionId);
		if (existing !== undefined) closeConnectionEndpoint(existing);
		const endpoint: ConnectionEndpoint = {
			connectionId,
			serverId,
			port,
			listeners: new Set(),
		};
		connectionEndpoints.set(connectionId, endpoint);
		port.onmessage = (message) => {
			try {
				const packet = parseTerminayHostBytePacket(message.data, serverId);
				for (const listener of [...endpoint.listeners]) listener(packet.frame);
			} catch {
				for (const listener of [...endpoint.listeners]) listener(null);
			}
		};
		port.onmessageerror = () => {
			for (const listener of [...endpoint.listeners]) listener(null);
		};
		port.addEventListener('close', () => closeConnectionEndpoint(endpoint));
		port.start();
		const waiters = connectionWaiters.get(connectionId);
		if (waiters === undefined) return;
		connectionWaiters.delete(connectionId);
		for (const resolve of waiters) resolve(endpoint);
	},
);

const waitForConnectionEndpoint = (
	connectionId: string,
): Promise<ConnectionEndpoint> => {
	const existing = connectionEndpoints.get(connectionId);
	if (existing !== undefined) return Promise.resolve(existing);
	return new Promise((resolve) => {
		const waiters = connectionWaiters.get(connectionId) ?? new Set();
		waiters.add(resolve);
		connectionWaiters.set(connectionId, waiters);
	});
};

const bytes: ServerUiByteBridge = Object.freeze({
	version: 2,
	openRemoteEndpoint: async (replace: boolean, manual: boolean) => {
		const claimed = remoteClaim;
		if (replace && claimed !== undefined) {
			remoteRecovery = claimed;
			try {
				const result = await askForRemoteRecovery(claimed, manual);
				if (result.outcome !== 'ready')
					throw remoteRecoveryError(result.outcome);
				await waitForRemotePort(
					result.generation,
					DESKTOP_ENDPOINT_HANDOFF_TIMEOUT_MS,
				);
			} finally {
				remoteRecovery = undefined;
			}
		} else {
			await waitForRemotePort(1, DESKTOP_REMOTE_SETUP_TIMEOUT_MS);
		}
		const port = bytePort!;
		remoteClaim = remoteGeneration;
		if (closedRemotePort === port)
			throw remoteRecoveryError('endpoint-unavailable');
		return Object.freeze({
			send: async (frame: Uint8Array) => {
				const bound = await context();
				if (port !== bytePort || closedRemotePort === port)
					throw remoteRecoveryError('retired');
				if (
					!(frame instanceof Uint8Array) ||
					frame.byteLength === 0 ||
					frame.byteLength > MAX_FRAME_BYTES
				)
					throw new TypeError('server frame must be bounded bytes');
				port.postMessage(createTerminayHostBytePacket(bound.serverId, frame));
			},
			subscribe: (listener: (frame: Uint8Array | null) => void) => {
				const receive = (frame: Uint8Array | null) => {
					if (port === bytePort) listener(frame);
				};
				byteListeners.add(receive);
				if (closedRemotePort === port)
					queueMicrotask(() => {
						if (byteListeners.has(receive)) receive(null);
					});
				return () => {
					byteListeners.delete(receive);
				};
			},
		});
	},
	expediteRemoteRecovery: () => {
		const pending = remoteRecovery;
		if (pending !== undefined)
			void askForRemoteRecovery(pending, true).catch(() => undefined);
	},
	subscribeRemoteResume: (listener: () => void) => {
		if (typeof listener !== 'function')
			throw new TypeError('resume listener must be a function');
		remoteResumeListeners.add(listener);
		return () => {
			remoteResumeListeners.delete(listener);
		};
	},
	/** Bytes for one attached connection, on its own channel. */
	openConnection: async (connectionId: string) => {
		if (typeof connectionId !== 'string' || !CONNECTION_ID.test(connectionId))
			throw new TypeError('connection id is invalid');
		const endpoint = await waitForConnectionEndpoint(connectionId);
		return Object.freeze({
			send: async (frame: Uint8Array) => {
				if (
					!(frame instanceof Uint8Array) ||
					frame.byteLength === 0 ||
					frame.byteLength > MAX_FRAME_BYTES
				)
					throw new TypeError('server frame must be bounded bytes');
				if (connectionEndpoints.get(connectionId) !== endpoint)
					throw new Error('This attached connection is closed.');
				endpoint.port.postMessage(
					createTerminayHostBytePacket(endpoint.serverId, frame),
				);
			},
			subscribe: (listener: (frame: Uint8Array | null) => void) => {
				if (typeof listener !== 'function')
					throw new TypeError('byte listener is invalid');
				endpoint.listeners.add(listener);
				return () => endpoint.listeners.delete(listener);
			},
			close: () => closeConnectionEndpoint(endpoint),
		});
	},
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
			frame.byteLength > MAX_FRAME_BYTES
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
		'terminayRemoteRecoveryFaultTest',
		Object.freeze({
			setStall: (active: boolean, onResume = false) =>
				ipcRenderer.invoke('test:set-remote-recovery-stall', active, onResume),
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
			// Unlike the fault above, nothing here touches the window's side:
			// the server closes its end and the window has to notice.
			refuseProjectCreations: (count: number) =>
				ipcRenderer.invoke(
					'test:refuse-project-creations',
					count,
				) as Promise<void>,
			// The server refuses new terminal subscriptions for this session until
			// called again with null, so the panel shows its retryable banner.
			refuseTerminalAttaches: (sessionId: string | null) =>
				ipcRenderer.invoke(
					'test:refuse-terminal-attaches',
					sessionId,
				) as Promise<void>,
			closeServerConnection: () =>
				ipcRenderer.invoke(
					'test:close-renderer-connections',
				) as Promise<number>,
		}),
	);
	contextBridge.exposeInMainWorld(
		'terminayAiMetadataTest',
		Object.freeze({
			setMock: (mock: {
				error?: string | null;
				models?: readonly Readonly<{ id: string; label: string }>[];
				hold?: boolean;
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
			/** Publish a session-source batch through the server's bridge. */
			publishSessions: (payload: {
				sourceId?: string;
				harnesses?: ReadonlyArray<{ id: string; displayName: string }>;
				publication: {
					reset?: ReadonlyArray<Record<string, unknown>>;
					upserts?: ReadonlyArray<Record<string, unknown>>;
					removals?: readonly string[];
				};
			}) =>
				ipcRenderer.invoke(
					'test:publish-agent-sessions',
					payload,
				) as Promise<boolean>,
			/** PTY shell pid of a server terminal, for ancestry-bound fixtures. */
			terminalShellPid: (terminalSessionId: string) =>
				ipcRenderer.invoke(
					'test:agent-terminal-shell-pid',
					terminalSessionId,
				) as Promise<number | null>,
		}),
	);
}
