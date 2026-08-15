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
import { getSessionTransportHost } from './sessionTransportHost';
import './index.css';

type ConnectedSession = Readonly<{
	context: Omit<TerminalPanelClientContextValue, 'projectId'>;
	label: string;
	origin?: string;
	serverId: string;
}>;

function pairingUrlFromLocation(): string | undefined {
	if (window.location.hash.length <= 1) return undefined;
	const pairingUrl = window.location.href;
	const visibleUrl = new URL(pairingUrl);
	visibleUrl.hash = '';
	window.history.replaceState(null, '', visibleUrl);
	return pairingUrl;
}

/**
 * The server-bundled browser entry runs only at a selected session origin (or
 * inside a Desktop-bound document). Connection bookmarks belong to the public
 * PWA and never enter this workspace shell.
 */
export default function SessionWorkspaceApp(): React.JSX.Element {
	const initialPairingUrl = useRef(pairingUrlFromLocation());
	const clientRef = useRef<TerminayClient | undefined>(undefined);
	const [connection, setConnection] = useState<ConnectedSession>();
	const [desktopContext, setDesktopContext] = useState<TerminayHostContext>();
	const [deviceName, setDeviceName] = useState('Terminay Browser');
	const [pairingPin, setPairingPin] = useState('');
	const [error, setError] = useState<string>();
	const [phase, setPhase] = useState<'connecting' | 'pairing' | 'ready'>(
		initialPairingUrl.current === undefined ? 'connecting' : 'pairing',
	);

	const connect = useCallback(async () => {
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
			label = new URL(origin).host;
			transport = await sessionHost.connect({
				origin,
				onStateChange: (state) => {
					if (state === 'closed') {
						setConnection(undefined);
						setError('Connection lost. Retry to reconnect.');
						setPhase('ready');
					}
				},
			});
		} else {
			const desktop = await acquireDesktopServerBootstrap(
				window.terminayHost as DesktopHostBridge | undefined,
				window.terminayBytes,
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
				onTransportClosed: () => {
					setConnection(undefined);
					setError('Connection lost. Retry to reconnect.');
					setPhase('ready');
				},
			});
			setConnection(
				Object.freeze({
					context: Object.freeze({
						...context,
						connectionLabel: label,
						retryConnection: () => void connect(),
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
	}, []);

	useEffect(() => {
		if (initialPairingUrl.current !== undefined) return;
		void connect().catch((cause) => {
			setError(cause instanceof Error ? cause.message : 'Unable to connect.');
			setPhase('ready');
		});
		return () => {
			void clientRef.current?.close().catch(() => undefined);
		};
	}, [connect]);

	const enroll = useCallback(
		async (event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			const pairingUrl = initialPairingUrl.current;
			const sessionHost = getSessionTransportHost();
			if (pairingUrl === undefined || sessionHost === undefined) return;
			if (!/^\d{6}$/u.test(pairingPin)) {
				setError('Enter the six-digit pairing PIN.');
				return;
			}
			try {
				setError(undefined);
				setPhase('connecting');
				await sessionHost.enroll({
					deviceName: deviceName.trim(),
					isCurrent: () => true,
					origin: sessionHost.origin,
					pairingPin,
					pairingUrl,
				});
				initialPairingUrl.current = undefined;
				setPairingPin('');
				await connect();
			} catch (cause) {
				setError(
					cause instanceof Error
						? cause.message
						: 'Unable to pair this device.',
				);
				setPhase('pairing');
			}
		},
		[connect, deviceName, pairingPin],
	);

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

	if (phase === 'pairing') {
		return (
			<main className="browser-host-shell">
				<section
					className="browser-host-shell__panel"
					aria-labelledby="pair-title"
				>
					<h1 id="pair-title">Pair this browser</h1>
					<p>Approve this browser with the pairing PIN for this server.</p>
					<form onSubmit={enroll}>
						<label>
							Device name
							<input
								value={deviceName}
								onChange={(event) => setDeviceName(event.target.value)}
							/>
						</label>
						<label>
							Pairing PIN
							<input
								inputMode="numeric"
								maxLength={6}
								value={pairingPin}
								onChange={(event) => setPairingPin(event.target.value)}
							/>
						</label>
						<button type="submit">Continue pairing</button>
					</form>
					{error !== undefined && <p role="alert">{error}</p>}
				</section>
			</main>
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
						onClick={() =>
							void connect().catch((cause) =>
								setError(
									cause instanceof Error ? cause.message : 'Unable to connect.',
								),
							)
						}
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

const root = document.getElementById('web-root');
if (root !== null) mountSessionWorkspace(root);
