import {
	type ByteTransport,
	createTerminayHostBytePacket,
	parseTerminayHostBytePacket,
} from '@terminay/protocol';
import {
	MessageChannelMain,
	type MessagePortMain,
	ipcMain,
	type WebContents,
} from 'electron';
import {
	DesktopDocumentLifecycle,
	handoffDocumentResource,
} from '../apps/terminay-desktop/src/main/documentLifecycle';
import type { DesktopBundleLaunch } from '../apps/terminay-desktop/src/main/serverBundleHost';

type Diagnostic = (resource: string, message: string) => void;

const activeRemoteEndpoints = new Map<number, () => void>();
const REPLACE_BYTE_ENDPOINT = 'server-ui-host:replace-byte-endpoint';
const DOCUMENT_READY = 'server-ui-host:document-ready';

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
		if (sender.isDestroyed()) return;
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
		if (!sender.isDestroyed())
			sender.off('did-start-navigation', onDocumentNavigation);
		unbind();
	};
}

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
	readonly reconnect?: () => Promise<ByteTransport>;
	readonly diagnostic?: Diagnostic;
}): () => void {
	const sender = options.sender;
	const senderId = sender.id;
	activeRemoteEndpoints.get(senderId)?.();
	const lifecycle = navigationLifecycle(sender, options.diagnostic);
	let documentPort: MessagePortMain | undefined;
	let connectionClosed = false;
	let reconnecting: Promise<void> | undefined;
	let transport = options.transport;
	let attachedForDocument = false;
	let documentReady = false;
	let transportReady = false;
	let hasAttachedDocument = false;

	const closeConnection = () => {
		if (connectionClosed) return;
		connectionClosed = true;
		lifecycle.close();
		if (activeRemoteEndpoints.get(senderId) === closeConnection)
			activeRemoteEndpoints.delete(senderId);
		void transport
			.close({ code: 'normal' })
			.catch((error) =>
				options.diagnostic?.('remote-transport', boundedMessage(error)),
			);
	};
	activeRemoteEndpoints.set(senderId, closeConnection);

	const attach = (replace = false) => {
		if (
			connectionClosed ||
			sender.isDestroyed() ||
			!documentReady ||
			!transportReady
		)
			return;
		if (attachedForDocument && !replace) return;
		attachedForDocument = true;
		hasAttachedDocument = true;
		const document = lifecycle.replace();
		const channel = new MessageChannelMain();
		documentPort = channel.port1;
		document.add('message-port', () => {
			if (documentPort === channel.port1) documentPort = undefined;
			channel.port1.close();
		});
		channel.port1.on('message', ({ data }) => {
			if (!document.active || connectionClosed) return;
			try {
				const packet = parseTerminayHostBytePacket(
					data,
					options.launch.context.serverId,
				);
				void transport.send(packet.frame).catch(recoverConnection);
			} catch {
				closeConnection();
			}
		});
		channel.port1.start();
		handoffDocumentResource({
			acceptAuthority: () => undefined,
			sendRenderer: () =>
				sender.postMessage(
					'server-ui-host:byte-endpoint',
					{ handle: options.launch.byteEndpointHandle },
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
		if (event.sender !== sender || connectionClosed) return;
		// The renderer asks for a new endpoint after it receives the deliberate
		// transport-failure edge below.  Do not hand it a port backed by the
		// retired remote lane while its authenticated replacement is still being
		// established. Recovery itself sends exactly one replacement port once the
		// new lane is live; sending a second one would invalidate that fresh port.
		if (reconnecting !== undefined || !documentReady) return;
		attach(true);
	};
	const onDocumentReady = (event: Electron.IpcMainEvent) => {
		if (event.sender !== sender || connectionClosed) return;
		documentReady = true;
		if (reconnecting === undefined) attach();
	};
	const onDocumentLoadStart = () => {
		if (connectionClosed) return;
		// did-start-loading is the document boundary that precedes the next
		// preload. Releasing on did-start-navigation can arrive too late for a
		// file URL query navigation and close the fresh document's port instead.
		documentReady = false;
		attachedForDocument = false;
		lifecycle.releaseDocument();
		if (hasAttachedDocument) recoverConnection(false);
	};
	ipcMain.on(REPLACE_BYTE_ENDPOINT, onReplace);
	ipcMain.on(DOCUMENT_READY, onDocumentReady);
	sender.on('did-start-loading', onDocumentLoadStart);
	const onDocumentLoaded = () => {
		if (connectionClosed) return;
		documentReady = true;
		if (reconnecting === undefined) attach();
	};
	const unbind = lifecycle.bind(onDocumentLoaded, closeConnection, true, false);

	const startTransport = () => {
		const activeTransport = transport;
		transportReady = false;
		void activeTransport
			.open()
			.then(async () => {
				if (connectionClosed || sender.isDestroyed()) return;
				if (transport !== activeTransport) return;
				transportReady = true;
				attach();
				for await (const frame of activeTransport.incoming) {
					if (connectionClosed || transport !== activeTransport) return;
					documentPort?.postMessage(
						createTerminayHostBytePacket(
							options.launch.context.serverId,
							frame,
						),
					);
				}
				if (transport === activeTransport) recoverConnection();
			})
			.catch((error) => {
				options.diagnostic?.('remote-transport', boundedMessage(error));
				if (transport === activeTransport) recoverConnection();
			});
	};
	function recoverConnection(notifyDocument = true): void {
		if (connectionClosed || options.reconnect === undefined) {
			closeConnection();
			return;
		}
		if (reconnecting !== undefined) return;
		reconnecting = (async () => {
			try {
				// A new remote server connection is a new protocol connection. Make
				// the current renderer retire its client before we hand it the new
				// lane; document navigation already discarded that client and port.
				if (notifyDocument) documentPort?.postMessage(null);
				transportReady = false;
				await transport.close({ code: 'normal' }).catch(() => undefined);
				if (connectionClosed) return;
				transport = await options.reconnect!();
				if (connectionClosed) {
					await transport.close({ code: 'normal' }).catch(() => undefined);
					return;
				}
				startTransport();
			} catch (error) {
				options.diagnostic?.('remote-reconnect', boundedMessage(error));
				closeConnection();
			} finally {
				reconnecting = undefined;
			}
		})();
	}
	startTransport();
	return () => {
		ipcMain.off(REPLACE_BYTE_ENDPOINT, onReplace);
		ipcMain.off(DOCUMENT_READY, onDocumentReady);
		if (!sender.isDestroyed())
			sender.off('did-start-loading', onDocumentLoadStart);
		unbind();
		closeConnection();
	};
}

function navigationLifecycle(sender: WebContents, diagnostic?: Diagnostic) {
	let current = new DesktopDocumentLifecycle((event) =>
		diagnostic?.(event.resource, event.message),
	);
	let closed = false;
	let attachListener: (() => void) | undefined;
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
			sender.once('destroyed', onDestroyed ?? (() => owner.close()));
			return () => owner.close();
		},
		close() {
			if (closed) return;
			closed = true;
			current.release('window-close');
			if (!sender.isDestroyed()) {
				if (releasesOnDidStartNavigation)
					sender.off('did-start-navigation', onNavigation);
				sender.off('render-process-gone', onGone);
				if (attachesOnDidFinishLoad && attachListener !== undefined)
					sender.off('did-finish-load', attachListener);
			}
			attachListener = undefined;
		},
	};
	return owner;
}

function boundedMessage(error: unknown): string {
	const category = error instanceof Error ? error.name : typeof error;
	return `Server UI endpoint failed (${category || 'unknown'}).`.slice(0, 320);
}
