import {
	type ByteTransport,
	createTerminayHostBytePacket,
	parseTerminayHostBytePacket,
} from '@terminay/protocol';
import {
	MessageChannelMain,
	type MessagePortMain,
	type WebContents,
} from 'electron';
import {
	DesktopDocumentLifecycle,
	handoffDocumentResource,
} from '../apps/terminay-desktop/src/main/documentLifecycle';
import type { DesktopBundleLaunch } from '../apps/terminay-desktop/src/main/serverBundleHost';

type Diagnostic = (resource: string, message: string) => void;

const activeRemoteEndpoints = new Map<number, () => void>();

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
	const attach = () => {
		if (sender.isDestroyed()) return;
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
	return lifecycle.bind(attach);
}

/** One connection transport may outlive many renderer documents. Reload swaps
 * only MessagePorts. Window destruction, profile replacement, or quit closes
 * the underlying transport exactly once. */
export function bindRemoteServerUiDocumentEndpoint(options: {
	readonly sender: WebContents;
	readonly launch: DesktopBundleLaunch;
	readonly transport: ByteTransport;
	readonly diagnostic?: Diagnostic;
}): () => void {
	const sender = options.sender;
	const senderId = sender.id;
	activeRemoteEndpoints.get(senderId)?.();
	const lifecycle = navigationLifecycle(sender, options.diagnostic);
	let documentPort: MessagePortMain | undefined;
	let connectionClosed = false;

	const closeConnection = () => {
		if (connectionClosed) return;
		connectionClosed = true;
		lifecycle.close();
		if (activeRemoteEndpoints.get(senderId) === closeConnection)
			activeRemoteEndpoints.delete(senderId);
		void options.transport
			.close({ code: 'normal' })
			.catch((error) =>
				options.diagnostic?.('remote-transport', boundedMessage(error)),
			);
	};
	activeRemoteEndpoints.set(senderId, closeConnection);

	const attach = () => {
		if (connectionClosed || sender.isDestroyed()) return;
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
				void options.transport.send(packet.frame).catch(closeConnection);
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
	const unbind = lifecycle.bind(attach, closeConnection);

	void options.transport
		.open()
		.then(async () => {
			if (connectionClosed || sender.isDestroyed()) return;
			try {
				for await (const frame of options.transport.incoming) {
					if (connectionClosed) return;
					documentPort?.postMessage(
						createTerminayHostBytePacket(
							options.launch.context.serverId,
							frame,
						),
					);
				}
			} finally {
				closeConnection();
			}
		})
		.catch((error) => {
			options.diagnostic?.('remote-transport', boundedMessage(error));
			closeConnection();
		});
	return () => {
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
		replace() {
			current.release('superseded');
			current = new DesktopDocumentLifecycle((event) =>
				diagnostic?.(event.resource, event.message),
			);
			return current;
		},
		bind(attach: () => void, onDestroyed?: () => void) {
			attachListener = attach;
			sender.on('did-start-navigation', onNavigation);
			sender.on('render-process-gone', onGone);
			sender.on('did-finish-load', attach);
			sender.once('destroyed', onDestroyed ?? (() => owner.close()));
			return () => owner.close();
		},
		close() {
			if (closed) return;
			closed = true;
			current.release('window-close');
			if (!sender.isDestroyed()) {
				sender.off('did-start-navigation', onNavigation);
				sender.off('render-process-gone', onGone);
				if (attachListener !== undefined)
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
