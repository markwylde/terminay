import { ConnectionProfileStore } from '@terminay/client-core';
import type { ByteTransport, TerminayHostContext } from '@terminay/protocol';
import {
	Component,
	type ErrorInfo,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from 'react';
import { createRoot } from 'react-dom/client';
import {
	DESKTOP_ENDPOINT_HANDOFF_TIMEOUT_MS,
	DESKTOP_PAIRING_REQUIRED,
} from '../../electron/desktopRemoteRecoveryContract';
import type { TerminalPanelClientContextValue } from '../components/TerminalPanel';
import {
	cancelDesktopPairing,
	pairDesktopConnection,
} from '../host/nativeActions';
import {
	subscribePairingApproval,
	subscribePairingProgress,
} from '../host/nativeEvents';
import {
	type CompositionPersistence,
	type ConnectionOpenResult,
	ConnectionRegistry,
	ConnectionsProvider,
	createBrowserConnectionHost,
	createDesktopConnectionHost,
	createHostCompositionPersistence,
	createLocalCompositionPersistence,
	NO_ATTACHED_CONNECTIONS,
	NO_COMPOSITION_PERSISTENCE,
	useConnectionsSnapshot,
	type WorkspaceConnection,
	type WorkspaceConnectionHost,
} from '../shared/connections';
import {
	IDLE_PAIRING_ATTEMPT,
	pairingAttemptReducer,
} from '../shared/pairingAttemptState';
import {
	SharedConnectionsRouteBody,
	type SharedConnectionsRouteBodyProps,
} from '../shared/SharedConnectionsRouteBody';
import type { AppCommand } from '../types/terminay';
import {
	ServerUpgradeBoardHost,
	ServerUpgradeModal,
	showsUpgradeModal,
	useServerUpgradeProgress,
} from '../workspace/ServerUpgradeBoardHost.tsx';
import { ConnectedWebRendererWorkspace } from './ConnectedWebRendererWorkspace';
import { ConnectionStateServers } from './ConnectionStateServers';
import {
	acquireDesktopServerBootstrap,
	type DesktopByteBridge,
	type DesktopHostBridge,
} from './desktopByteTransport';
import {
	getSessionTransportHost,
	leaveManagerSession,
} from './sessionTransportHost';
import { createWebClientId } from './webClientIdentity';
import './index.css';

/** The window's own connection. Desktop's primary is always Local; a browser
 * session's is the server the manager opened. */
const PRIMARY_PROFILE_ID = 'primary';

/** Drawn inline, not fetched. This mark is the first thing a connecting or
 * reconnecting window shows, and the framed PWA host rewrites relative URLs
 * only for the entry document's own references — a relative `src` from the
 * bundle's JavaScript resolves against the session bootstrap path and renders
 * as a broken image for as long as the shell is up. */
function TerminayMark({
	className,
}: Readonly<{ className: string }>): React.JSX.Element {
	return (
		<svg
			aria-hidden="true"
			className={className}
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			stroke="#ffffff"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<polygon points="12 4 4.5 7.75 12 11.5 19.5 7.75 12 4" />
			<polyline points="4.5 15.25 12 19 19.5 15.25" />
			<polyline points="4.5 11.5 12 15.25 19.5 11.5" />
		</svg>
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
	const [showRecoveryPairing, setShowRecoveryPairing] = useState(false);
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
				metricsHost:
					getSessionTransportHost() === undefined ? 'desktop' : 'browser',
				...(typeof window !== 'undefined' &&
				(window.terminayBytes as DesktopByteBridge | undefined)
					?.openRemoteEndpoint !== undefined
					? {
							onRemoteRetryJoin: () =>
								(
									window.terminayBytes as DesktopByteBridge | undefined
								)?.expediteRemoteRecovery?.(),
						}
					: {}),
				open: async ({
					profileId,
					role,
					replaceEndpoint,
					manual,
					onTransportClosed,
				}) => {
					if (role === 'attached') {
						const attached = await connectionHostRef.current.attach(profileId);
						return Object.freeze({
							transport: attached.transport,
							label: attached.label,
						}) satisfies ConnectionOpenResult;
					}
					return openPrimaryConnection(
						{ replaceEndpoint, manual, onTransportClosed },
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
	const [desktopPairing, dispatchDesktopPairing] = useReducer(
		pairingAttemptReducer,
		IDLE_PAIRING_ATTEMPT,
	);
	useEffect(
		() =>
			subscribePairingApproval(({ attemptId, ...approval }) =>
				dispatchDesktopPairing({ type: 'approval', attemptId, approval }),
			),
		[],
	);
	useEffect(
		() =>
			subscribePairingProgress((progress) =>
				dispatchDesktopPairing({ type: 'progress', ...progress }),
			),
		[],
	);

	useEffect(() => {
		let mounted = true;
		let started = false;
		let deadline: ReturnType<typeof setTimeout> | undefined;
		const start = (context?: TerminayHostContext) => {
			if (!mounted || started) return;
			started = true;
			clearTimeout(deadline);
			setDesktopContext(context);
			registry.startPrimary(PRIMARY_PROFILE_ID, context);
		};
		const host = window.terminayHost as DesktopHostBridge | undefined;
		const bytes = window.terminayBytes as DesktopByteBridge | undefined;
		if (host !== undefined && bytes?.openRemoteEndpoint !== undefined) {
			deadline = setTimeout(start, DESKTOP_ENDPOINT_HANDOFF_TIMEOUT_MS);
			void host.getContext().then(start, () => start());
		} else start();
		return () => {
			mounted = false;
			clearTimeout(deadline);
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

	// Restoring the attached set is the ConnectionsProvider's job: it owns the
	// same composition record it writes back, so the restore cannot race the
	// write that would flatten it.

	useEffect(() => {
		const bytes = window.terminayBytes as DesktopByteBridge | undefined;
		return bytes?.subscribeRemoteResume?.(() => registry.resumeRemotePrimary());
	}, [registry]);

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
			if (document.visibilityState !== 'visible') {
				registry.suspend();
				return;
			}
			registry.resume();
		};
		const hidden = () => registry.suspend();
		document.addEventListener('visibilitychange', shown);
		window.addEventListener('pageshow', shown);
		window.addEventListener('pagehide', hidden);
		return () => {
			document.removeEventListener('visibilitychange', shown);
			window.removeEventListener('pageshow', shown);
			window.removeEventListener('pagehide', hidden);
		};
	}, [registry]);

	const phase = presentationPhase(primary);
	const error = primary?.error;
	const recoveryProgress = primary?.recoveryProgress;
	const pairingRequired = error === DESKTOP_PAIRING_REQUIRED;
	const remoteRecoveryUi =
		desktopContext?.profile?.isLocal === false &&
		(window.terminayBytes as DesktopByteBridge | undefined)
			?.openRemoteEndpoint !== undefined;
	const retryStatus =
		recoveryProgress === 'retrying'
			? 'Retrying connection…'
			: recoveryProgress === 'checking'
				? 'Trying to reach the server…'
				: undefined;
	const retryButton = (
		<button
			className="session-retry-button"
			type="button"
			onClick={recoverConnection}
		>
			Retry connection
		</button>
	);
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

	const pairingRoute =
		desktopContext === undefined
			? {}
			: {
					canPair: true,
					...(typeof __TERMINAY_VERSION__ === 'string'
						? { appVersion: __TERMINAY_VERSION__ }
						: {}),
					pairingApproval: desktopPairing.approval,
					pairingProgress: desktopPairing.progress,
					onPairingHandoff: async ({
						pairingUrl,
						attemptId,
					}: {
						pairingUrl: string;
						attemptId: string;
					}) => {
						dispatchDesktopPairing({ type: 'started', attemptId });
						try {
							if (!(await pairDesktopConnection(pairingUrl, attemptId)))
								throw new Error(
									'Desktop pairing is unavailable in this session.',
								);
						} finally {
							dispatchDesktopPairing({ type: 'settled', attemptId });
						}
					},
					onPairingCancel: (attemptId: string) => {
						dispatchDesktopPairing({ type: 'dismissed' });
						void cancelDesktopPairing(attemptId).catch(() => undefined);
					},
					onPairingProgressDismiss: () =>
						dispatchDesktopPairing({ type: 'dismissed' }),
				};

	let content: ReactNode;
	if (terminalClientContext !== undefined) {
		const connectionRoute: Omit<SharedConnectionsRouteBodyProps, 'state'> = {
			...pairingRoute,
			profileStore: profiles,
		};

		content = (
			<div
				className={
					phase === 'reconnecting'
						? 'session-workspace session-workspace--reconnecting'
						: 'session-workspace'
				}
			>
				{phase === 'reconnecting' && (
					<SessionReconnecting
						profileId={primary?.profileId}
						error={error}
						retryStatus={retryStatus}
						action={remoteRecoveryUi ? retryButton : undefined}
					/>
				)}
				<div
					className="session-workspace__content"
					inert={remoteRecoveryUi && phase === 'reconnecting'}
				>
					<ConnectedWebRendererWorkspace
						key={primary?.workspaceGeneration}
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
			</div>
		);
	} else {
		const showConnectingMessage =
			getSessionTransportHost() !== undefined ||
			desktopContext?.profile?.isLocal === false;

		content = (
			<main className="browser-host-shell">
				<section
					className="browser-host-shell__panel browser-host-shell__connection-state"
					aria-live="polite"
					aria-busy={phase === 'connecting'}
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
					{retryStatus !== undefined && (
						<p className="browser-host-shell__recovery-progress" role="status">
							{retryStatus}
						</p>
					)}
					{pairingRequired && !showRecoveryPairing && (
						<button type="button" onClick={() => setShowRecoveryPairing(true)}>
							Pair again
						</button>
					)}
					{pairingRequired && showRecoveryPairing && (
						<SharedConnectionsRouteBody
							{...pairingRoute}
							state="ready"
							presentation="pairing"
							onPairingPanelClose={() => setShowRecoveryPairing(false)}
						/>
					)}
					{!pairingRequired &&
						(phase === 'ready' ||
							error !== undefined ||
							recoveryProgress !== undefined) &&
						primary?.phase !== 'incompatible' &&
						retryButton}
					{/* A server that cannot be shown must still be one the window can
					 * leave. A first attempt that is merely slow offers nothing yet. */}
					{(phase === 'ready' ||
						error !== undefined ||
						recoveryProgress !== undefined) && (
						<ConnectionStateServers host={connectionHost} />
					)}
				</section>
			</main>
		);
	}

	// Connection loss clears the workspace context. Keep the upgrade board
	// and its modal alive above both presentations through every retry.
	return (
		<WorkspaceErrorBoundary>
			<ConnectionsProvider
				composition={compositionStore}
				host={connectionHost}
				registry={registry}
			>
				<ServerUpgradeBoardHost>
					{content}
					<ServerUpgradeModal profileId={primary?.profileId} />
				</ServerUpgradeBoardHost>
			</ConnectionsProvider>
		</WorkspaceErrorBoundary>
	);
}

/**
 * The dim over a workspace whose connection is coming back. While the window's
 * server is being upgraded, the upgrade's modal card is already up and the drop
 * is one of its steps: nothing more is drawn, so the card never moves.
 */
function SessionReconnecting({
	error,
	profileId,
	action,
	retryStatus,
}: Readonly<{
	error: string | undefined;
	profileId: string | undefined;
	action?: ReactNode;
	retryStatus?: string;
}>) {
	const upgrade = useServerUpgradeProgress(profileId);
	if (showsUpgradeModal(upgrade)) return null;
	return (
		<div
			className="session-workspace__reconnecting"
			aria-busy={action === undefined ? true : undefined}
		>
			<LoadingDots />
			<p role="status">
				{error ?? retryStatus ?? 'Terminal stream stalled. Reconnecting…'}
			</p>
			{action}
		</div>
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
		manual?: boolean;
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
			...(sessionHost.connectTimings === undefined
				? {}
				: { connectTimings: sessionHost.connectTimings }),
		});
	}
	const desktop = await acquireDesktopServerBootstrap(
		window.terminayHost as DesktopHostBridge | undefined,
		window.terminayBytes as DesktopByteBridge | undefined,
		{ replaceEndpoint: options.replaceEndpoint, manual: options.manual },
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
