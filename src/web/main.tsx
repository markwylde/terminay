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
import { subscribePairingApproval } from '../host/nativeEvents';
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
	createSessionHeartbeat,
	logSessionLane,
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

function TerminayMark({
	className,
}: Readonly<{ className: string }>): React.JSX.Element {
	return (
		<img alt="" aria-hidden="true" className={className} src="./terminay.svg" />
	);
}

function LoadingDots(): React.JSX.Element {
	return (
		<div className="browser-host-shell__loading-dots" aria-hidden="true">
			{Array.from({ length: 5 }, (_, index) => (
				<span key={index} />
			))}
		</div>
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
	const connectionRef = useRef<ConnectedSession | undefined>(undefined);
	const heartbeatRef = useRef<{ stop(): void } | undefined>(undefined);
	const [connection, setConnection] = useState<ConnectedSession>();
	const [desktopContext, setDesktopContext] = useState<TerminayHostContext>();
	const [desktopPairingApproval, setDesktopPairingApproval] = useState<
		Readonly<{ deviceName: string; matchCode: string; expiresAt: string }> | null
	>(null);
	useEffect(() => subscribePairingApproval(setDesktopPairingApproval), []);
	const [error, setError] = useState<string>();
	const [phase, setPhase] = useState<'connecting' | 'reconnecting' | 'ready'>(
		'connecting',
	);

	const recoverConnection = useCallback(() => {
		startAttemptRef.current({ replaceDesktopEndpoint: true });
	}, []);

	const connect = useCallback(
		async (
			attempt: SessionConnectAttempt,
			options: Readonly<{ replaceDesktopEndpoint?: boolean }> = {},
		) => {
			setError(undefined);
			if (connectionRef.current === undefined) setPhase('connecting');
			await clientRef.current?.close().catch(() => undefined);
			heartbeatRef.current?.stop();

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
					// This client promises to prove liveness on an interval, which
					// also arms the server's inbound-silence reaper for it.
					'connection.heartbeat',
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
				// Liveness is proven by asking, not by watching traffic: a WebRTC
				// generation can stop delivering while every lane still reports open.
				const heartbeat = createSessionHeartbeat({
					ping: (signal) =>
						client.query('connection.ping', { sentAt: Date.now() }, { signal }),
					onLost: (snapshot) => {
						logSessionLane('connection-heartbeat-lost', snapshot);
						setError('Connection lost. Reconnecting…');
						if (gateRef.current.shouldRecoverFromClose(attempt)) recoverConnection();
					},
				});
				heartbeatRef.current?.stop();
				heartbeatRef.current = heartbeat;
				heartbeat.start();
				const next = Object.freeze({
					context: Object.freeze({
						...context,
						connectionLabel: label,
						retryConnection: () => recoverConnection(),
						canRetryConnection: () => true,
					}),
					label,
					...(origin === undefined ? {} : { origin }),
					serverId: hello.serverId,
				});
				connectionRef.current = next;
				setConnection(next);
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
		const recovering = connectionRef.current !== undefined;
		setError(undefined);
		if (recovering) {
			setPhase('reconnecting');
		} else {
			connectionRef.current = undefined;
			setConnection(undefined);
			setPhase('connecting');
		}
		void gateRef.current
			.withDeadline(attempt, connectRef.current(attempt, options))
			.catch((cause) => {
				if (!gateRef.current.isCurrent(attempt)) return;
				connectionRef.current = undefined;
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
			heartbeatRef.current?.stop();
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
			status: phase === 'reconnecting' ? 'connecting' : 'connected',
		});
		store.select('session-origin');
		return store;
	}, [connection, phase]);

	if (connection !== undefined) {
		const connectionRoute: Omit<SharedConnectionsRouteBodyProps, 'state'> = {
			...(desktopContext === undefined
				? {}
				: {
						canPair: true,
						pairingApproval: desktopPairingApproval,
						onPairingHandoff: async ({ pairingUrl }) => {
							setDesktopPairingApproval(null);
							try {
								if (!(await pairDesktopConnection(pairingUrl)))
									throw new Error(
										'Desktop pairing is unavailable in this session.',
									);
							} finally {
								setDesktopPairingApproval(null);
							}
						},
					}),
			profileStore: profiles,
		};
		return (
			<WorkspaceErrorBoundary>
				<div
					className={
						phase === 'reconnecting'
							? 'session-workspace session-workspace--reconnecting'
							: 'session-workspace'
					}
				>
					{phase === 'reconnecting' && (
						<div
							className="session-workspace__reconnecting"
							role="status"
							aria-live="polite"
							aria-busy="true"
						>
							<LoadingDots />
							<p>
								{error ?? 'Terminal stream stalled. Reconnecting…'}
							</p>
						</div>
					)}
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
				</div>
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
				aria-busy={phase === 'connecting' || phase === 'reconnecting'}
			>
				{(phase === 'connecting' || phase === 'reconnecting') && (
					<div className="browser-host-shell__connection-brand">
						<TerminayMark className="browser-host-shell__connection-logo" />
						<LoadingDots />
					</div>
				)}
				{(phase !== 'connecting' || showConnectingMessage) && (
					<h1>
						{phase === 'connecting'
							? 'Connecting to Terminay…'
							: phase === 'reconnecting'
								? 'Reconnecting…'
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
