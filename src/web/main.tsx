import { ConnectionProfileStore, TerminayClient } from '@terminay/client-core';
import type { ByteTransport, TerminayHostContext } from '@terminay/protocol';
import {
	Component,
	type ErrorInfo,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import type { TerminalPanelClientContextValue } from '../components/TerminalPanel';
import { pairDesktopConnection } from '../host/nativeActions';
import { createConnectedServerClientContext } from '../shared/rendererServerClient';
import type { SharedConnectionsRouteBodyProps } from '../shared/SharedConnectionsRouteBody';
import type { AppCommand } from '../types/terminay';
import { ConnectedWebRendererWorkspace } from './ConnectedWebRendererWorkspace';
import {
	acquireDesktopServerBootstrap,
	type DesktopHostBridge,
} from './desktopByteTransport';
import {
	type SessionConnectAttempt,
	SessionConnectGate,
} from './sessionConnectAttempt';
import {
	getSessionTransportHost,
	leaveManagerSession,
} from './sessionTransportHost';
import { createWebClientId } from './webClientIdentity';
import './index.css';

type ConnectedSession = Readonly<{
	context: Omit<TerminalPanelClientContextValue, 'projectId'>;
	label: string;
	origin?: string;
	serverId: string;
}>;

function TerminayMark({ className }: Readonly<{ className: string }>): React.JSX.Element {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			focusable="false"
			stroke="#ffffff"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
		>
			<rect x="1" y="1" width="22" height="22" rx="5" fill="#000000" stroke="none" />
			<polygon points="12 4 4.5 7.75 12 11.5 19.5 7.75 12 4" />
			<polyline points="4.5 15.25 12 19 19.5 15.25" />
			<polyline points="4.5 11.5 12 15.25 19.5 11.5" />
		</svg>
	);
}

class WorkspaceErrorBoundary extends Component<
	Readonly<{ children: ReactNode }>,
	Readonly<{ failed: boolean }>
> {
	state = { failed: false };

	static getDerivedStateFromError(): Readonly<{ failed: boolean }> {
		return { failed: true };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		console.error('Workspace renderer failed', error, info.componentStack);
	}

	render(): ReactNode {
		if (!this.state.failed) return this.props.children;
		return (
			<main className="browser-host-shell">
				<section className="browser-host-shell__panel" role="alert">
					<h1>Workspace view unavailable</h1>
					<p>
						The server connection and terminal sessions are still running. Retry
						the workspace view to reconnect its panels.
					</p>
					<button
						type="button"
						onClick={() => this.setState({ failed: false })}
					>
						Retry workspace view
					</button>
				</section>
			</main>
		);
	}
}

/**
 * The server-bundled browser entry runs only at a selected session origin (or
 * inside a Desktop-bound document). Connection bookmarks belong to the public
 * PWA and never enter this workspace shell.
 */
export default function SessionWorkspaceApp(): React.JSX.Element {
	const clientRef = useRef<TerminayClient | undefined>(undefined);
	const gateRef = useRef(new SessionConnectGate());
	const connectRef = useRef<
		(
			attempt: SessionConnectAttempt,
			options?: Readonly<{ replaceDesktopEndpoint?: boolean }>,
		) => Promise<void>
	>(async () => undefined);
	const startAttemptRef = useRef<
		(options?: Readonly<{ replaceDesktopEndpoint?: boolean }>) => void
	>(() => undefined);
	const [connection, setConnection] = useState<ConnectedSession>();
	const [desktopContext, setDesktopContext] = useState<TerminayHostContext>();
	const [error, setError] = useState<string>();
	const [phase, setPhase] = useState<'connecting' | 'ready'>('connecting');

	const recoverConnection = useCallback(() => {
		startAttemptRef.current({ replaceDesktopEndpoint: true });
	}, []);

	const connect = useCallback(
		async (
			attempt: SessionConnectAttempt,
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
						if (
							state === 'closed' &&
							gateRef.current.shouldRecoverFromClose(attempt)
						) {
							recoverConnection();
						}
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

			if (!gateRef.current.isCurrent(attempt)) return;
			if (transport.state === 'closed' || transport.state === 'failed') {
				throw new Error('Session transport closed during connect.');
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
				if (!gateRef.current.isCurrent(attempt)) {
					await client.close().catch(() => undefined);
					if (clientRef.current === client) clientRef.current = undefined;
					return;
				}
				const context = await createConnectedServerClientContext(
					client,
					hello,
					{
						onTransportClosed: () => {
							if (gateRef.current.shouldRecoverFromClose(attempt)) {
								recoverConnection();
							}
						},
					},
				);
				if (!gateRef.current.isCurrent(attempt)) {
					await client.close().catch(() => undefined);
					if (clientRef.current === client) clientRef.current = undefined;
					return;
				}
				gateRef.current.finish(attempt);
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
		},
		[recoverConnection],
	);
	connectRef.current = connect;
	startAttemptRef.current = (options) => {
		const attempt = gateRef.current.begin();
		if (attempt === undefined) return;
		setConnection(undefined);
		setError(undefined);
		setPhase('connecting');
		void gateRef.current
			.withDeadline(attempt, connectRef.current(attempt, options))
			.catch((cause) => {
				if (!gateRef.current.isCurrent(attempt)) return;
				setConnection(undefined);
				setError(
					cause instanceof Error ? cause.message : 'Unable to reconnect.',
				);
				setPhase('ready');
			})
			.finally(() => {
				gateRef.current.finish(attempt);
			});
	};

	useEffect(() => {
		startAttemptRef.current();
		return () => {
			void clientRef.current?.close().catch(() => undefined);
		};
	}, []);

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
			<WorkspaceErrorBoundary>
				<ConnectedWebRendererWorkspace
					connectionRoute={connectionRoute}
					hostContext={desktopContext}
					onBack={() => {
						if (leaveManagerSession()) return;
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
			</WorkspaceErrorBoundary>
		);
	}

	const showConnectingMessage =
		getSessionTransportHost() !== undefined ||
		desktopContext?.profile?.isLocal === false;

	return (
		<main className="browser-host-shell">
			<section
				className="browser-host-shell__panel browser-host-shell__connection-state"
				aria-live="polite"
				aria-busy={phase === 'connecting'}
			>
				{phase === 'connecting' && (
					<div className="browser-host-shell__connection-brand">
						<TerminayMark
							className="browser-host-shell__connection-logo"
						/>
						<div
							className="browser-host-shell__loading-dots"
							aria-hidden="true"
						>
							{Array.from({ length: 5 }, (_, index) => (
								<span key={index} />
							))}
						</div>
					</div>
				)}
				{(phase !== 'connecting' || showConnectingMessage) && (
					<h1>
						{phase === 'connecting'
							? 'Connecting to Terminay…'
							: 'Connection unavailable'}
					</h1>
				)}
				{error !== undefined && <p role="alert">{error}</p>}
				{phase === 'ready' && (
					<button type="button" onClick={recoverConnection}>
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
