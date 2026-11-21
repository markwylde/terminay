import {
	type ByteTransport,
	createTerminayHostBytePacket,
	parseTerminayHostBytePacket,
} from '@terminay/protocol';
import {
	ipcMain,
	MessageChannelMain,
	type MessagePortMain,
	type WebContents,
} from 'electron';
import {
	closeDesktopDocumentTransport,
	DesktopDocumentLifecycle,
	handoffDocumentResource,
} from '../apps/terminay-desktop/src/main/documentLifecycle';
import type { DesktopBundleLaunch } from '../apps/terminay-desktop/src/main/serverBundleHost';

import {
	DESKTOP_REMOTE_SETUP_TIMEOUT_MS,
	RECOVER_REMOTE_ENDPOINT,
	REMOTE_ENDPOINT_RECEIVED,
	REMOTE_RESUME,
	type DesktopRemoteRecoveryFailure,
	type DesktopRemoteRecoveryResult,
} from './desktopRemoteRecoveryContract';

type Diagnostic = (resource: string, message: string) => void;

type RemoteEndpoint = {
	close(): void;
	recover(
		event: Electron.IpcMainInvokeEvent,
		generation: unknown,
		manual: unknown,
	): Promise<DesktopRemoteRecoveryResult>;
	acknowledge(event: Electron.IpcMainEvent, generation: unknown): void;
	resume(): void;
	setTestStall(active: boolean, onResume: boolean): void;
};

const activeRemoteEndpoints = new Map<number, RemoteEndpoint>();

ipcMain.handle(
	RECOVER_REMOTE_ENDPOINT,
	(event, generation, manual) =>
		activeRemoteEndpoints
			.get(event.sender.id)
			?.recover(event, generation, manual) ?? { outcome: 'retired' },
);

ipcMain.on(REMOTE_ENDPOINT_RECEIVED, (event, generation) =>
	activeRemoteEndpoints.get(event.sender.id)?.acknowledge(event, generation),
);

/** Force an open-but-silent lane and hold its replacement for isolated E2E. */
export function setRemoteEndpointTestStall(
	senderId: number,
	active: boolean,
	onResume = false,
): void {
	if (process.env.TERMINAY_TEST !== '1') return;
	activeRemoteEndpoints.get(senderId)?.setTestStall(active, onResume);
}

export function resumeRemoteServerUiDocumentEndpoints(): void {
	for (const endpoint of activeRemoteEndpoints.values()) endpoint.resume();
}
const REPLACE_BYTE_ENDPOINT = 'server-ui-host:replace-byte-endpoint';
const DOCUMENT_READY = 'server-ui-host:document-ready';

function reportDiagnostic(
	diagnostic: Diagnostic | undefined,
	resource: string,
	message: string,
): void {
	try {
		diagnostic?.(resource, message);
	} catch {
		// Diagnostics are optional observability. They must never escape a native
		// navigation, destruction, or transport callback.
	}
}

/** Attach a fresh Local document port after every successful load. Navigation
 * releases only the old document port; the embedded server and its PTYs remain
 * owned by the application-scoped authority. */
export function bindLocalServerUiDocumentEndpoint(options: {
	readonly sender: WebContents;
	readonly handle: string;
	readonly acceptPort: (port: MessagePortMain) => void;
	readonly diagnostic?: Diagnostic;
}): () => void {
	const sender = options.sender;
	const lifecycle = navigationLifecycle(sender, options.diagnostic);
	let attachedForDocument = false;
	const attach = (replace = false) => {
		if (lifecycle.destroyed()) return;
		if (attachedForDocument && !replace) return;
		attachedForDocument = true;
		const document = lifecycle.replace();
		const channel = new MessageChannelMain();
		document.add('message-port', () => channel.port1.close());
		handoffDocumentResource({
			acceptAuthority: () => options.acceptPort(channel.port1),
			sendRenderer: () =>
				sender.postMessage(
					'server-ui-host:byte-endpoint',
					{ handle: options.handle },
					[channel.port2],
				),
			release: () => {
				document.release('failed-launch');
				channel.port2.close();
			},
			onFailure: (message) => options.diagnostic?.('message-port', message),
		});
	};
	const onReplace = (event: Electron.IpcMainEvent) => {
		if (event.sender === sender) attach(true);
	};
	const onDocumentReady = (event: Electron.IpcMainEvent) => {
		if (event.sender === sender) attach();
	};
	const onDocumentNavigation = (
		_event: unknown,
		_url: string,
		_inPlace: boolean,
		isMainFrame: boolean,
	) => {
		if (isMainFrame) attachedForDocument = false;
	};
	ipcMain.on(REPLACE_BYTE_ENDPOINT, onReplace);
	ipcMain.on(DOCUMENT_READY, onDocumentReady);
	sender.on('did-start-navigation', onDocumentNavigation);
	// document-ready is the fast preload-owned handoff. did-finish-load is an
	// idempotent fallback for a newly-created child whose early preload signal
	// arrives before main has installed its endpoint binding.
	const unbind = lifecycle.bind(attach);
	return () => {
		ipcMain.off(REPLACE_BYTE_ENDPOINT, onReplace);
		ipcMain.off(DOCUMENT_READY, onDocumentReady);
		if (!lifecycle.destroyed())
			sender.off('did-start-navigation', onDocumentNavigation);
		unbind();
	};
}

/** Why a remote window's lane was replaced: its document reloaded, its byte
 * stream ended or failed, or an earlier replacement is being tried again. */
export type RemoteLaneReplacement =
	| 'document-reload'
	| 'transport-ended'
	| 'transport-failed'
	| 'reconnect-retry'
	| 'workspace-recovery'
	| 'manual-retry';

export type RemoteRecoveryDiagnostic = Readonly<{
	attempt: number;
	stage: 'request' | 'start' | 'join' | 'outcome' | 'handoff';
	reason: RemoteLaneReplacement;
	outcome?: DesktopRemoteRecoveryResult['outcome'];
	durationMs?: number;
}>;

/** A remote protocol lane belongs to one renderer document. A reload creates a
 * fresh application client, so reusing the old lane would make its new
 * `client_hello` race an already-open server connection. The protected
 * reconnect credential remains in the main process; only the opaque document
 * MessagePort changes hands. */
export function bindRemoteServerUiDocumentEndpoint(options: {
	readonly sender: WebContents;
	readonly launch: DesktopBundleLaunch;
	readonly transport: ByteTransport;
	/** Recreate the authenticated server lane after its byte stream ends.  A
	 * replacement document port alone cannot recover a dead WebSocket/WebRTC
	 * transport. */
	readonly reconnect?: (signal: AbortSignal) => Promise<ByteTransport>;
	readonly diagnostic?: Diagnostic;
	/** Told each time the window's lane is replaced, and why. */
	readonly onLaneReplaced?: (reason: RemoteLaneReplacement) => void;
	readonly onRecovery?: (event: RemoteRecoveryDiagnostic) => void;
	readonly validateSender?: (
		event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent,
	) => void;
}): () => void {
	const sender = options.sender;
	const senderId = sender.id;
	try {
		activeRemoteEndpoints.get(senderId)?.close();
	} catch {
		// A superseded endpoint must not make a freshly selected server unable to
		// mount. Its own cleanup diagnostic has already been recorded where it
		// originated.
	}
	const lifecycle = navigationLifecycle(sender, options.diagnostic);
	let documentPort: MessagePortMain | undefined;
	let connectionClosed = false;
	let transport: ByteTransport | undefined = options.transport;
	let transportReady = false;
	let documentReady = false;
	let attachedForDocument = false;
	let generation = 0;
	let documentFirstGeneration = 1;
	let documentEpoch = 0;
	let attemptCount = 0;
	let reconnecting:
		| {
				id: number;
				controller: AbortController;
				result: Promise<DesktopRemoteRecoveryResult>;
		  }
		| undefined;
	let lastFailure: DesktopRemoteRecoveryFailure | undefined;
	let testStallOnResume = false;
	let testStall: { signal: AbortController } | undefined;
	let awaitingReceipt:
		| { generation: number; attempt: number; reason: RemoteLaneReplacement }
		| undefined;
	let failedReconnects = 0;
	let reconnectRetry: ReturnType<typeof setTimeout> | undefined;
	let pendingHandoff:
		| { attempt: number; reason: RemoteLaneReplacement }
		| undefined;

	const record = (event: RemoteRecoveryDiagnostic) => {
		try {
			options.onRecovery?.(event);
		} catch {
			// Diagnostics cannot change connection state.
		}
	};

	const closeConnection = () => {
		if (connectionClosed) return;
		connectionClosed = true;
		clearTimeout(reconnectRetry);
		awaitingReceipt = undefined;
		testStall?.signal.abort();
		reconnecting?.controller.abort();
		if (activeRemoteEndpoints.get(senderId) === endpoint)
			activeRemoteEndpoints.delete(senderId);
		ipcMain.off(REPLACE_BYTE_ENDPOINT, onReplace);
		ipcMain.off(DOCUMENT_READY, onDocumentReady);
		if (!lifecycle.destroyed())
			sender.off('did-start-loading', onDocumentLoadStart);
		lifecycle.close();
		if (transport !== undefined) {
			const retired = transport;
			transport = undefined;
			void closeDesktopDocumentTransport(retired, (message) =>
				reportDiagnostic(options.diagnostic, 'remote-transport', message),
			);
		}
	};

	const attach = () => {
		const activeTransport = transport;
		if (
			connectionClosed ||
			!documentReady ||
			attachedForDocument ||
			!transportReady ||
			activeTransport === undefined
		)
			return;
		const document = lifecycle.replace();
		const channel = new MessageChannelMain();
		const nextGeneration = ++generation;
		documentPort = channel.port1;
		document.add('message-port', () => {
			if (documentPort === channel.port1) documentPort = undefined;
			channel.port1.close();
		});
		channel.port1.on('message', ({ data }) => {
			if (
				!document.active ||
				activeTransport !== transport ||
				testStall !== undefined
			)
				return;
			try {
				const packet = parseTerminayHostBytePacket(
					data,
					options.launch.context.serverId,
				);
				void activeTransport.send(packet.frame).catch(() => {
					if (activeTransport === transport)
						void recoverConnection('transport-failed');
				});
			} catch {
				closeConnection();
			}
		});
		channel.port1.start();
		attachedForDocument = handoffDocumentResource({
			acceptAuthority: () => undefined,
			sendRenderer: () =>
				sender.postMessage(
					'server-ui-host:byte-endpoint',
					{
						handle: options.launch.byteEndpointHandle,
						generation: nextGeneration,
					},
					[channel.port2],
				),
			release: () => {
				document.release('failed-launch');
				channel.port2.close();
			},
			onFailure: (message) =>
				reportDiagnostic(options.diagnostic, 'message-port', message),
		});
		if (pendingHandoff !== undefined) {
			if (attachedForDocument)
				awaitingReceipt = { ...pendingHandoff, generation: nextGeneration };
			else
				record({
					...pendingHandoff,
					stage: 'handoff',
					outcome: 'endpoint-unavailable',
				});
			pendingHandoff = undefined;
		}
	};

	const isBoundDocument = (
		event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
	) => {
		if (
			event.sender !== sender ||
			connectionClosed ||
			!documentReady ||
			event.senderFrame !== sender.mainFrame
		)
			return false;
		try {
			options.validateSender?.(event);
			return true;
		} catch {
			return false;
		}
	};
	const onReceived = (event: Electron.IpcMainEvent, received: unknown) => {
		const receipt = awaitingReceipt;
		if (
			!isBoundDocument(event) ||
			receipt === undefined ||
			received !== receipt.generation
		)
			return;
		awaitingReceipt = undefined;
		record({
			attempt: receipt.attempt,
			reason: receipt.reason,
			stage: 'handoff',
			outcome: 'ready',
		});
	};

	const onReplace = (event: Electron.IpcMainEvent) => {
		if (event.sender !== sender || connectionClosed || !documentReady) return;
		// An older preload can ask to replace its endpoint but cannot identify
		// the generation it used. A replacement still needs a fresh peer.
		if (reconnectRetry === undefined && transportReady)
			void recoverConnection('workspace-recovery');
	};
	const onDocumentReady = (event: Electron.IpcMainEvent) => {
		if (event.sender !== sender || connectionClosed) return;
		if (event.senderFrame && event.senderFrame !== sender.mainFrame) return;
		documentReady = true;
		attach();
	};
	const onDocumentLoadStart = () => {
		if (connectionClosed || !sender.isLoadingMainFrame()) return;
		documentReady = false;
		attachedForDocument = false;
		documentEpoch += 1;
		awaitingReceipt = undefined;
		documentFirstGeneration = generation + 1;
		lifecycle.releaseDocument();
		if (generation > 0) void recoverConnection('document-reload');
	};
	const endpoint: RemoteEndpoint = {
		close: closeConnection,
		acknowledge: onReceived,
		async recover(event, requested, manual) {
			if (
				!isBoundDocument(event) ||
				typeof manual !== 'boolean' ||
				typeof requested !== 'number' ||
				!Number.isSafeInteger(requested) ||
				requested < documentFirstGeneration ||
				requested > generation
			)
				return { outcome: 'retired' };
			const reason = manual ? 'manual-retry' : 'workspace-recovery';
			const existing = reconnecting;
			const fresh = () =>
				transportReady && attachedForDocument && generation > requested;
			const heldFailure =
				lastFailure !== undefined && (reconnectRetry === undefined || !manual)
					? lastFailure
					: undefined;
			const attempt =
				existing?.id ??
				(fresh() || heldFailure !== undefined
					? attemptCount
					: attemptCount + 1);
			record({ attempt, stage: 'request', reason });
			const document = documentEpoch;
			if (existing !== undefined) {
				record({ attempt, stage: 'join', reason });
				await existing.result;
			} else if (!fresh()) {
				if (heldFailure !== undefined) return { outcome: heldFailure };
				await recoverConnection(reason);
			}
			if (connectionClosed || document !== documentEpoch)
				return { outcome: 'retired' };
			if (fresh()) return { outcome: 'ready', generation };
			return { outcome: lastFailure ?? 'endpoint-unavailable' };
		},
		setTestStall(active, onResume) {
			if (onResume) {
				testStallOnResume = active;
				return;
			}
			if (active) testStall ??= { signal: new AbortController() };
			else {
				const stalled = testStall;
				testStall = undefined;
				stalled?.signal.abort();
			}
		},
		resume() {
			if (!documentReady || connectionClosed) return;
			if (testStallOnResume) {
				testStallOnResume = false;
				endpoint.setTestStall(true, false);
			}
			try {
				sender.send(REMOTE_RESUME);
			} catch {
				// The window can be destroyed during native resume.
			}
		},
	};
	activeRemoteEndpoints.set(senderId, endpoint);
	ipcMain.on(REPLACE_BYTE_ENDPOINT, onReplace);
	ipcMain.on(DOCUMENT_READY, onDocumentReady);
	sender.on('did-start-loading', onDocumentLoadStart);
	lifecycle.bind(
		() => {
			documentReady = true;
			attach();
		},
		closeConnection,
		true,
		false,
	);

	const readTransport = async (activeTransport: ByteTransport) => {
		try {
			for await (const frame of activeTransport.incoming) {
				if (transport !== activeTransport) return;
				if (testStall !== undefined) continue;
				documentPort?.postMessage(
					createTerminayHostBytePacket(options.launch.context.serverId, frame),
				);
			}
			if (transport === activeTransport)
				void recoverConnection('transport-ended');
		} catch (error) {
			if (transport !== activeTransport) return;
			reportDiagnostic(
				options.diagnostic,
				'remote-transport',
				boundedMessage(error),
			);
			void recoverConnection('transport-failed');
		}
	};

	function recoverConnection(
		reason: RemoteLaneReplacement,
	): Promise<DesktopRemoteRecoveryResult> {
		if (connectionClosed || options.reconnect === undefined) {
			closeConnection();
			return Promise.resolve({ outcome: 'retired' });
		}
		if (reconnecting !== undefined) return reconnecting.result;
		if (lastFailure !== undefined && reconnectRetry === undefined)
			return Promise.resolve({ outcome: lastFailure });

		clearTimeout(reconnectRetry);
		reconnectRetry = undefined;
		lastFailure = undefined;
		const id = ++attemptCount;
		const controller = new AbortController();
		const started = Date.now();
		const retired = transport;
		transport = undefined;
		transportReady = false;
		attachedForDocument = false;
		awaitingReceipt = undefined;
		if (documentPort !== undefined) {
			documentPort.postMessage(null);
			lifecycle.releaseDocument();
		}
		// The peer is already retired locally. A stalled close cannot hold up
		// rejoin; the server admits the replacement under the same window id.
		if (retired !== undefined) void closeDesktopDocumentTransport(retired);
		const reconnect = options.reconnect;
		const result = Promise.resolve().then(
			async (): Promise<DesktopRemoteRecoveryResult> => {
				let outcome: DesktopRemoteRecoveryResult;
				try {
					const replacement = await openRemoteReplacement(async (signal) => {
						const stall = testStall?.signal.signal;
						if (stall !== undefined) await waitForTestStall(stall, signal);
						return reconnect(signal);
					}, controller);
					if (connectionClosed) {
						void closeDesktopDocumentTransport(replacement);
						return { outcome: 'retired' };
					}
					transport = replacement;
					transportReady = true;
					failedReconnects = 0;
					pendingHandoff = { attempt: id, reason };
					attach();
					if (documentReady && !attachedForDocument) {
						transport = undefined;
						transportReady = false;
						void closeDesktopDocumentTransport(replacement);
						throw new RemoteEndpointHandoffError();
					}
					outcome = { outcome: 'ready', generation };
					queueMicrotask(() => {
						if (transport === replacement) void readTransport(replacement);
					});
				} catch (error) {
					if (connectionClosed) return { outcome: 'retired' };
					lastFailure = classifyRecoveryFailure(error, controller.signal);
					outcome = { outcome: lastFailure };
					reportDiagnostic(
						options.diagnostic,
						'remote-reconnect',
						boundedMessage(error),
					);
					if (
						lastFailure === 'unavailable' ||
						lastFailure === 'timeout' ||
						lastFailure === 'endpoint-unavailable'
					) {
						const delay =
							RECONNECT_RETRY_DELAYS_MS[
								Math.min(
									failedReconnects++,
									RECONNECT_RETRY_DELAYS_MS.length - 1,
								)
							];
						reconnectRetry = setTimeout(() => {
							void recoverConnection('reconnect-retry');
						}, delay);
						reconnectRetry.unref?.();
					}
				} finally {
					reconnecting = undefined;
				}
				record({
					attempt: id,
					reason,
					stage: 'outcome',
					outcome: outcome.outcome,
					durationMs: Math.max(0, Date.now() - started),
				});
				return outcome;
			},
		);
		reconnecting = { id, controller, result };
		record({ attempt: id, stage: 'start', reason });
		try {
			options.onLaneReplaced?.(reason);
		} catch {
			// Diagnostics cannot change connection state.
		}
		return result;
	}

	const initial = options.transport;
	void Promise.resolve()
		.then(() => initial.open())
		.then(() => {
			if (transport !== initial) return;
			transportReady = true;
			attach();
			void readTransport(initial);
		})
		.catch((error) => {
			if (transport !== initial) return;
			reportDiagnostic(
				options.diagnostic,
				'remote-transport',
				boundedMessage(error),
			);
			void recoverConnection('transport-failed');
		});
	return closeConnection;
}

function navigationLifecycle(sender: WebContents, diagnostic?: Diagnostic) {
	let current = new DesktopDocumentLifecycle((event) =>
		diagnostic?.(event.resource, event.message),
	);
	let closed = false;
	let attachListener: (() => void) | undefined;
	let destroyedListener: (() => void) | undefined;
	let senderDestroyed = false;
	let attachesOnDidFinishLoad = true;
	let releasesOnDidStartNavigation = true;
	const onNavigation = (
		_event: unknown,
		_url: string,
		_inPlace: boolean,
		isMainFrame: boolean,
	) => {
		if (isMainFrame) current.release('reload');
	};
	const onGone = () => current.release('reload');
	const owner = {
		releaseDocument() {
			current.release('reload');
		},
		replace() {
			current.release('superseded');
			current = new DesktopDocumentLifecycle((event) =>
				diagnostic?.(event.resource, event.message),
			);
			return current;
		},
		bind(
			attach: () => void,
			onDestroyed?: () => void,
			attachOnDidFinishLoad = true,
			releaseOnDidStartNavigation = true,
		) {
			attachListener = attach;
			attachesOnDidFinishLoad = attachOnDidFinishLoad;
			releasesOnDidStartNavigation = releaseOnDidStartNavigation;
			if (releasesOnDidStartNavigation)
				sender.on('did-start-navigation', onNavigation);
			sender.on('render-process-gone', onGone);
			if (attachOnDidFinishLoad) sender.on('did-finish-load', attach);
			// Capture the callback before subscribing. Once Electron emits
			// `destroyed`, the WebContents object is no longer safe to query or
			// mutate, so teardown relies only on this retained listener state.
			destroyedListener = () => {
				senderDestroyed = true;
				(onDestroyed ?? (() => owner.close()))();
			};
			sender.once('destroyed', destroyedListener);
			return () => owner.close();
		},
		destroyed() {
			return senderDestroyed;
		},
		close() {
			if (closed) return;
			closed = true;
			current.release('window-close');
			if (!senderDestroyed) {
				if (releasesOnDidStartNavigation)
					sender.off('did-start-navigation', onNavigation);
				sender.off('render-process-gone', onGone);
				if (attachesOnDidFinishLoad && attachListener !== undefined)
					sender.off('did-finish-load', attachListener);
				if (destroyedListener !== undefined)
					sender.off('destroyed', destroyedListener);
			}
			attachListener = undefined;
			destroyedListener = undefined;
		},
	};
	return owner;
}

/** Pauses between reconnect attempts after one fails; the last one repeats. */
const RECONNECT_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 30_000];

class RemoteEndpointHandoffError extends Error {}

function classifyRecoveryFailure(
	error: unknown,
	signal: AbortSignal,
): DesktopRemoteRecoveryFailure {
	if (signal.aborted) return 'timeout';
	if (error instanceof RemoteEndpointHandoffError)
		return 'endpoint-unavailable';
	if (typeof error === 'object' && error !== null && 'code' in error) {
		if (error.code === 'window-limit') return 'window-limit';
		if (error.code === 'pairing-required') return 'pairing-required';
	}
	const message = error instanceof Error ? error.message : '';
	if (/timed out|did not answer in time/i.test(message)) return 'timeout';
	return 'unavailable';
}

async function openRemoteReplacement(
	reconnect: (signal: AbortSignal) => Promise<ByteTransport>,
	controller: AbortController,
): Promise<ByteTransport> {
	const { signal } = controller;
	const timer = setTimeout(
		() => controller.abort(),
		DESKTOP_REMOTE_SETUP_TIMEOUT_MS,
	);
	timer.unref?.();
	let rejectAbort: () => void = () => undefined;
	const aborted = new Promise<never>((_, reject) => {
		rejectAbort = () => reject(signal.reason);
		signal.addEventListener('abort', rejectAbort, { once: true });
	});
	const opening = Promise.resolve().then(async () => {
		signal.throwIfAborted();
		const opened = await reconnect(signal);
		let closed = false;
		const close = () => {
			if (closed) return;
			closed = true;
			void closeDesktopDocumentTransport(opened);
		};
		signal.addEventListener('abort', close, { once: true });
		try {
			signal.throwIfAborted();
			await opened.open(signal);
			signal.throwIfAborted();
			return opened;
		} catch (error) {
			close();
			throw error;
		} finally {
			signal.removeEventListener('abort', close);
		}
	});
	try {
		return await Promise.race([opening, aborted]);
	} finally {
		clearTimeout(timer);
		signal.removeEventListener('abort', rejectAbort);
	}
}

async function waitForTestStall(
	stall: AbortSignal,
	attempt: AbortSignal,
): Promise<void> {
	const signal = AbortSignal.any([stall, attempt]);
	if (!signal.aborted)
		await new Promise<void>((resolve) =>
			signal.addEventListener('abort', () => resolve(), { once: true }),
		);
	attempt.throwIfAborted();
}

function boundedMessage(error: unknown): string {
	const category = error instanceof Error ? error.name : typeof error;
	return `Server UI endpoint failed (${category || 'unknown'}).`.slice(0, 320);
}
