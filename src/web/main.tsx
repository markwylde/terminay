import { ConnectionProfileStore } from '@terminay/client-core';
import type {
	ByteTransport,
	TerminayHostContext,
	TerminayWorkspaceComposition,
} from '@terminay/protocol';
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
import {
	type CompositionPersistence,
	ConnectionRegistry,
	ConnectionsProvider,
	createBrowserConnectionHost,
	createDesktopConnectionHost,
	createHostCompositionPersistence,
	createLocalCompositionPersistence,
	NO_ATTACHED_CONNECTIONS,
	NO_COMPOSITION_PERSISTENCE,
	useConnectionsSnapshot,
	type ConnectionOpenResult,
	type WorkspaceConnection,
	type WorkspaceConnectionHost,
} from '../shared/connections';
import type { SharedConnectionsRouteBodyProps } from '../shared/SharedConnectionsRouteBody';
import type { AppCommand } from '../types/terminay';
import { ConnectedWebRendererWorkspace } from './ConnectedWebRendererWorkspace';
import {
	acquireDesktopServerBootstrap,
	type DesktopByteBridge,
	type DesktopHostBridge,
} from './desktopByteTransport';
import { getSessionTransportHost, leaveManagerSession } from './sessionTransportHost';
import { createWebClientId } from './webClientIdentity';
import './index.css';

/** The window's own connection. Desktop's primary is always Local; a browser
 * session's is the server the manager opened. */
const PRIMARY_PROFILE_ID = 'primary';

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
 * The server-bundled browser entry runs one workspace bundle over as many
 * server connections as the host will open. Connection bookmarks belong to the
 * public PWA and never enter this workspace shell.
 */
export default function SessionWorkspaceApp(): React.JSX.Element {
	const [desktopContext, setDesktopContext] = useState<TerminayHostContext>();
	// The host that hands out attached connections, known only once the primary
	// bootstrap says which host this is.
	const connectionHostRef = useRef<WorkspaceConnectionHost>(
		NO_ATTACHED_CONNECTIONS,
	);
	const [connectionHost, setConnectionHost] = useState<WorkspaceConnectionHost>(
		NO_ATTACHED_CONNECTIONS,
	);
	const [compositionStore, setCompositionStore] =
		useState<CompositionPersistence>(NO_COMPOSITION_PERSISTENCE);
	const registry = useMemo(
		() =>
			new ConnectionRegistry({
				createClientId: (role) =>
					createWebClientId(role === 'primary' ? 'session' : 'attached'),
				isDocumentHidden: () =>
					typeof document !== 'undefined' &&
					document.visibilityState === 'hidden',
				open: async ({ profileId, role, replaceEndpoint, onTransportClosed }) => {
					if (role === 'attached') {
						const attached = await connectionHostRef.current.attach(profileId);
						return Object.freeze({
							transport: attached.transport,
							label: attached.label,
						}) satisfies ConnectionOpenResult;
					}
					return openPrimaryConnection(
						{ replaceEndpoint, onTransportClosed },
						(context, host) => {
							setDesktopContext(context);
							connectionHostRef.current = host;
							setConnectionHost(host);
						},
					);
				},
			}),
		[],
	);
	const snapshot = useConnectionsSnapshot(registry);
	const primary = snapshot.primary;
	const [desktopPairingApproval, setDesktopPairingApproval] = useState<
		Readonly<{ deviceName: string; matchCode: string; expiresAt: string }> | null
	>(null);
	useEffect(() => subscribePairingApproval(setDesktopPairingApproval), []);

	useEffect(() => {
		registry.startPrimary(PRIMARY_PROFILE_ID);
		return () => {
			void registry.dispose();
		};
	}, [registry]);

	// The primary decides where the composition is kept: through the Desktop
	// host, through the manager, or in this origin's storage keyed by server.
	const primaryServerId = primary?.serverId;
	useEffect(() => {
		if (primaryServerId === undefined) return;
		const host = connectionHostRef.current;
		setCompositionStore(
			host.supportsAttach
				? createHostCompositionPersistence(
						() => host.readComposition(),
						(value) => host.writeComposition(value),
					)
				: createLocalCompositionPersistence(primaryServerId),
		);
	}, [primaryServerId]);

	// Restore the attached set the window had last time. Servers that cannot be
	// reached come back attached and unreachable, with their tabs greyed, rather
	// than silently disappearing from the strip.
	const restoredRef = useRef(false);
	useEffect(() => {
		if (restoredRef.current || primary?.phase !== 'ready') return;
		if (compositionStore === NO_COMPOSITION_PERSISTENCE) return;
		restoredRef.current = true;
		void (async () => {
			const composition: TerminayWorkspaceComposition | undefined =
				await compositionStore.read();
			for (const attachment of composition?.attached ?? [])
				registry.attach(attachment.profileId);
		})();
	}, [compositionStore, primary?.phase, registry]);

	const recoverConnection = useCallback(() => {
		primary?.retry();
	}, [primary]);

	// Returning to the foreground is the moment to find out. A frozen document
	// runs nothing, so its transport can have died with no probe outstanding and
	// no attempt pending; waiting out the next heartbeat interval is most of why
	// coming back to the app feels broken.
	useEffect(() => {
		if (typeof document === 'undefined') return;
		const shown = () => {
			if (document.visibilityState !== 'visible') return;
			registry.resume();
		};
		document.addEventListener('visibilitychange', shown);
		window.addEventListener('pageshow', shown);
		return () => {
			document.removeEventListener('visibilitychange', shown);
			window.removeEventListener('pageshow', shown);
		};
	}, [registry]);

	const phase = presentationPhase(primary);
	const error = primary?.error;
	const label = primary?.label ?? 'Local';
	const terminalClientContext = useMemo<
		Omit<TerminalPanelClientContextValue, 'projectId'> | undefined
	>(() => {
		if (primary?.context === undefined) return undefined;
		return Object.freeze({
			...primary.context,
			connectionLabel: label,
			retryConnection: () => primary.retry(),
			canRetryConnection: () => true,
		});
	}, [label, primary]);

	const profiles = useMemo(() => {
		if (primary?.origin === undefined || primary.serverId === undefined)
			return undefined;
		const store = new ConnectionProfileStore({ local: false });
		store.import({
			id: 'session-origin',
			label: primary.label,
			origin: primary.origin,
			serverId: primary.serverId,
			status: phase === 'reconnecting' ? 'connecting' : 'connected',
		});
		store.select('session-origin');
		return store;
	}, [phase, primary]);

	if (terminalClientContext !== undefined) {
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
				<ConnectionsProvider
					composition={compositionStore}
					host={connectionHost}
					registry={registry}
				>
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
								<p>{error ?? 'Terminal stream stalled. Reconnecting…'}</p>
							</div>
						)}
						<ConnectedWebRendererWorkspace
							connectionRoute={connectionRoute}
							hostContext={desktopContext}
							onBack={() => {
								if (leaveManagerSession()) return;
								void registry.dispose();
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
							terminalClientContext={terminalClientContext}
						/>
					</div>
				</ConnectionsProvider>
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
								: primary?.phase === 'incompatible'
									? 'This server needs updating'
									: 'Connection unavailable'}
					</h1>
				)}
				{error !== undefined && <p role="alert">{error}</p>}
				{/* Recovery keeps trying on its own; this only asks for it now. */}
				{(phase === 'ready' || error !== undefined) &&
					primary?.phase !== 'incompatible' && (
						<button type="button" onClick={recoverConnection}>
							Retry connection
						</button>
					)}
			</section>
		</main>
	);
}

/** What the shell shows. An unreachable primary is presented as idle, as it
 * was before: recovery keeps trying and the person may also ask. */
function presentationPhase(
	primary: WorkspaceConnection | undefined,
): 'connecting' | 'reconnecting' | 'ready' {
	switch (primary?.phase) {
		case 'reconnecting':
			return 'reconnecting';
		case 'ready':
			return 'ready';
		case 'unreachable':
		case 'incompatible':
			return 'ready';
		default:
			return 'connecting';
	}
}

/**
 * The one connection whose bundle this window runs.
 *
 * A browser session takes it from the framed session host; Desktop takes it
 * from its preload's byte endpoint. Both hand back an opaque transport, and
 * the same call tells the shell which host it is talking to so attached
 * connections can be opened later through that host's `connections`
 * capability.
 */
async function openPrimaryConnection(
	options: Readonly<{
		replaceEndpoint: boolean;
		onTransportClosed: () => void;
	}>,
	adopt: (
		context: TerminayHostContext | undefined,
		host: WorkspaceConnectionHost,
	) => void,
): Promise<ConnectionOpenResult> {
	const sessionHost = getSessionTransportHost();
	if (sessionHost !== undefined) {
		const origin = sessionHost.origin;
		const transport: ByteTransport = await sessionHost.connect({
			origin,
			onStateChange: (state) => {
				if (state === 'closed') options.onTransportClosed();
			},
		});
		adopt(undefined, createBrowserConnectionHost(sessionHost));
		return Object.freeze({
			transport,
			label: sessionHost.hostName?.trim() || 'Remote',
			origin,
		});
	}
	const desktop = await acquireDesktopServerBootstrap(
		window.terminayHost as DesktopHostBridge | undefined,
		window.terminayBytes as DesktopByteBridge | undefined,
		{ replaceEndpoint: options.replaceEndpoint },
	);
	if (desktop === undefined)
		throw new Error(
			'This workspace must be opened from a Terminay session origin.',
		);
	const host = window.terminayHost;
	adopt(
		desktop.context,
		host === undefined
			? NO_ATTACHED_CONNECTIONS
			: createDesktopConnectionHost(
					desktop.context,
					host,
					window.terminayBytes as DesktopByteBridge | undefined,
				),
	);
	return Object.freeze({
		transport: desktop.transport,
		label: desktop.context.profile?.label ?? 'Local',
		hostContext: desktop.context,
	});
}

export function mountSessionWorkspace(root: HTMLElement): void {
	createRoot(root).render(<SessionWorkspaceApp />);
}
