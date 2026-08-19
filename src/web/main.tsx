import { ConnectionProfileStore, TerminayClient } from '@terminay/client-core';
import type { ByteTransport, TerminayHostContext } from '@terminay/protocol';
import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TerminalPanelClientContextValue } from '../components/TerminalPanel';
import { createConnectedServerClientContext } from '../shared/rendererServerClient';
import type { SharedConnectionsRouteBodyProps } from '../shared/SharedConnectionsRouteBody';
import { pairDesktopConnection } from '../host/nativeActions';
import type { AppCommand } from '../types/terminay';
import { createWebClientId } from './webClientIdentity';
import { ConnectedWebRendererWorkspace } from './ConnectedWebRendererWorkspace';
import {
	acquireDesktopServerBootstrap,
	type DesktopHostBridge,
} from './desktopByteTransport';
import {
	getSessionTransportHost,
} from './sessionTransportHost';
import './index.css';

type ConnectedSession = Readonly<{
	context: Omit<TerminalPanelClientContextValue, 'projectId'>;
	label: string;
	origin?: string;
	serverId: string;
}>;

/**
 * The server-bundled browser entry runs only at a selected session origin (or
 * inside a Desktop-bound document). Connection bookmarks belong to the public
 * PWA and never enter this workspace shell.
 */
export default function SessionWorkspaceApp(): React.JSX.Element {
	const clientRef = useRef<TerminayClient | undefined>(undefined);
	const connectRef = useRef<
		(options?: Readonly<{ replaceDesktopEndpoint?: boolean }>) => Promise<void>
	>(async () => undefined);
	const recoveryInFlight = useRef(false);
	const [connection, setConnection] = useState<ConnectedSession>();
	const [desktopContext, setDesktopContext] = useState<TerminayHostContext>();
	const [error, setError] = useState<string>();
	const [phase, setPhase] = useState<'connecting' | 'ready'>('connecting');

	const recoverConnection = useCallback(() => {
		if (recoveryInFlight.current) return;
		recoveryInFlight.current = true;
		setConnection(undefined);
		setError(undefined);
		setPhase('connecting');
		void connectRef
			.current({ replaceDesktopEndpoint: true })
			.catch((cause) => {
				setError(
					cause instanceof Error ? cause.message : 'Unable to reconnect.',
				);
				setPhase('ready');
			})
			.finally(() => {
				recoveryInFlight.current = false;
			});
	}, []);

	const connect = useCallback(async (
		options: Readonly<{ replaceDesktopEndpoint?: boolean }> = {},
	) => {
		setError(undefined);
		setPhase('connecting');
		await clientRef.current?.close().catch(() => undefined);

		const sessionHost = getSessionTransportHost();
		let transport: ByteTransport;
		let origin: string | undefined;
		let label: string;
		let hostContext: TerminayHostContext | undefined;
		if (sessionHost !== undefined) {
			origin = sessionHost.origin;
			label = sessionHost.hostName?.trim() || 'Remote';
			transport = await sessionHost.connect({
				origin,
				onStateChange: (state) => {
					if (state === 'closed') recoverConnection();
				},
			});
		} else {
			const desktop = await acquireDesktopServerBootstrap(
				window.terminayHost as DesktopHostBridge | undefined,
				window.terminayBytes,
				{ replaceEndpoint: options.replaceDesktopEndpoint },
			);
			if (desktop === undefined)
				throw new Error(
					'This workspace must be opened from a Terminay session origin.',
				);
			transport = desktop.transport;
			hostContext = desktop.context;
			origin = undefined;
			label = desktop.context.profile?.label ?? 'Local';
			setDesktopContext(hostContext);
		}

		const client = new TerminayClient({
			transport,
			clientId: createWebClientId('session'),
			clientVersion: '0.0.0',
			capabilities: [
				'server.health',
				'terminal',
				'workspace',
				'files',
				'agents',
			],
		});
		clientRef.current = client;
		try {
			const hello = await client.connect();
			const context = await createConnectedServerClientContext(client, hello, {
				onTransportClosed: recoverConnection,
			});
			setConnection(
				Object.freeze({
					context: Object.freeze({
						...context,
						connectionLabel: label,
						retryConnection: () => recoverConnection(),
						canRetryConnection: () => true,
					}),
					label,
					...(origin === undefined ? {} : { origin }),
					serverId: hello.serverId,
				}),
			);
			setPhase('ready');
		} catch (cause) {
			await client.close().catch(() => undefined);
			if (clientRef.current === client) clientRef.current = undefined;
			throw cause;
		}
	}, [recoverConnection]);
	connectRef.current = connect;

	useEffect(() => {
		void connect().catch((cause) => {
			setError(cause instanceof Error ? cause.message : 'Unable to connect.');
			setPhase('ready');
		});
		return () => {
			void clientRef.current?.close().catch(() => undefined);
		};
	}, [connect]);

	const profiles = useMemo(() => {
		if (connection?.origin === undefined) return undefined;
		const store = new ConnectionProfileStore({ local: false });
		store.import({
			id: 'session-origin',
			label: connection.label,
			origin: connection.origin,
			serverId: connection.serverId,
			status: 'connected',
		});
		store.select('session-origin');
		return store;
	}, [connection]);

	if (connection !== undefined) {
		const connectionRoute: Omit<SharedConnectionsRouteBodyProps, 'state'> = {
			...(desktopContext === undefined
				? {}
				: {
						canPair: true,
						onPairingHandoff: async ({ pairingPin, pairingUrl }) => {
							if (!(await pairDesktopConnection(pairingUrl, pairingPin)))
								throw new Error(
									'Desktop pairing is unavailable in this session.',
								);
						},
					}),
			profileStore: profiles,
		};
		return (
			<ConnectedWebRendererWorkspace
				connectionRoute={connectionRoute}
				hostContext={desktopContext}
				onBack={() => {
					void clientRef.current?.close().catch(() => undefined);
				}}
				subscribeAppCommands={
					desktopContext === undefined || window.terminayHost === undefined
						? undefined
						: (listener: (command: AppCommand) => Promise<void> | void) =>
								(
									window.terminayHost as unknown as DesktopHostBridge
								).subscribeEvent((event) => {
									if (event.event.type === 'menu.command') {
										return listener(event.event.command);
									}
								})
				}
				terminalClientContext={connection.context}
			/>
		);
	}

	return (
		<main className="browser-host-shell">
			<section className="browser-host-shell__panel" aria-live="polite">
				<h1>
					{phase === 'connecting'
						? 'Connecting to Terminay…'
						: 'Connection unavailable'}
				</h1>
				{error !== undefined && <p role="alert">{error}</p>}
				{phase === 'ready' && (
					<button
						type="button"
						onClick={recoverConnection}
					>
						Retry connection
					</button>
				)}
			</section>
		</main>
	);
}

export function mountSessionWorkspace(root: HTMLElement): void {
	createRoot(root).render(<SessionWorkspaceApp />);
}
