import { useEffect, useMemo, useRef, useState } from 'react';
import 'dockview/dist/styles/dockview.css';
import '@xterm/xterm/css/xterm.css';
import './index.css';
import type { HostCapabilitySet } from '@terminay/client-core';
import {
	MacroClient,
	RecordingsClient,
	SettingsClient,
	ShellProfilesClient,
	TerminayClientFacade,
	TerminayTerminalPanelClient,
} from '@terminay/client-core';
import { createDesktopWorkspaceRouteRenderModel } from '../apps/terminay-desktop/src/renderer/index.ts';
import type { AppProps } from './App.tsx';
import { EditTabWindow } from './components/EditTabWindow.tsx';
import { MacrosWindow } from './components/MacrosWindow.tsx';
import { RecordingsWindow } from './components/RecordingsWindow.tsx';
import { SettingsWindow } from './components/SettingsWindow.tsx';
import {
	createServerMacroSettingsClient,
	LegacyMacroSettingsProvider,
} from './hooks/useMacroSettings.ts';
import {
	createServerTerminalSettingsClient,
	TerminalSettingsClientProvider,
} from './hooks/useTerminalSettings.ts';
import {
	type DisconnectedFileCompatibility,
	DisconnectedFileCompatibilityProvider,
} from './services/fileViewer/DisconnectedFileCompatibilityProvider.tsx';
import { createDisconnectedFilePanelCompatibility } from './services/fileViewer/disconnectedFilePanelCompatibility.ts';
import { createDisconnectedFolderCompatibility } from './services/fileViewer/disconnectedFolderCompatibility.ts';
import { captureLegacyFileViewerCapability } from './services/fileViewer/terminayFileGateway.ts';
import { captureLegacyMacroSettingsCapability } from './services/macros/legacyMacroSettingsCapability.ts';
import { createLegacySettingsClient } from './services/settings/legacySettingsClient.ts';
import { ConnectedRendererWorkspace } from './shared/ConnectedRendererWorkspace.tsx';
import { SharedAgentRouteBody } from './shared/SharedAgentRouteBody.tsx';
import { SharedConnectionsRouteBody } from './shared/SharedConnectionsRouteBody.tsx';
import { SharedFolderRouteBody } from './shared/SharedFolderRouteBody.tsx';
import { SharedGitRouteBody } from './shared/SharedGitRouteBody.tsx';
import { SharedTerminalRouteBody } from './shared/SharedTerminalRouteBody.tsx';
import { captureLegacyServerConnectionLifecycleCapability } from './shared/legacyServerConnectionLifecycleCapability.ts';
import { captureLegacyServerFrameCapability } from './shared/legacyServerFrameCapability.ts';
import {
	ResponsiveWorkspaceEntry,
	sharedRouteForView,
} from './shared/ResponsiveWorkspaceEntry.tsx';
import {
	RendererConnectionController,
	type RendererConnectionAttempt,
	type RendererConnectionState,
} from './shared/rendererConnectionController.ts';
import {
	connectRendererApplicationClient,
	createRendererServerClientContext,
	type RendererApplicationClientContext,
	type RendererBootstrapPhase,
} from './shared/rendererServerClient.ts';
import { recordBoundedRendererRender } from './shared/renderLoopGuard.ts';

const searchParams = new URLSearchParams(window.location.search);
const view = searchParams.get('view');
const applicationOnlyViews = new Set(['settings', 'macros', 'recordings']);
const usesApplicationOnlyServerClient = applicationOnlyViews.has(view ?? '');
const usesServerClient = view !== 'edit-tab';

type AuxiliaryRendererClientContext = RendererApplicationClientContext & {
	readonly connectionLabel?: string;
};

function AuxiliaryPendingSurface() {
	return (
		<main
			aria-hidden="true"
			className="terminay-server-connecting terminay-server-connecting--silent"
		/>
	);
}

function describeServerClientError(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const cause =
		'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined;
	const causeMessage =
		cause instanceof Error
			? cause.message
			: cause === undefined
				? undefined
				: String(cause);
	return causeMessage === undefined
		? error.message
		: `${error.message}: ${causeMessage}`;
}

export function RendererEntry() {
	(
		globalThis as typeof globalThis & {
			__terminayClientDiagnostic?: (phase: string) => void;
		}
	).__terminayClientDiagnostic = (phase) =>
		window.terminayBootstrapDiagnostic?.record(phase);
	const [terminalClientContext, setTerminalClientContext] =
		useState<AppProps['terminalClientContext']>();
	const [auxiliaryClientContext, setAuxiliaryClientContext] =
		useState<AuxiliaryRendererClientContext>();
	const [serverConnectionError, setServerConnectionError] = useState<string>();
	const [serverRecoveryStatus, setServerRecoveryStatus] = useState<string>();
	const connectionRef = useRef<AppProps['terminalClientContext']>(undefined);
	const auxiliaryConnectionRef = useRef<
		AuxiliaryRendererClientContext | undefined
	>(undefined);
	const [hostCapabilities, setHostCapabilities] = useState<HostCapabilitySet>();
	const serverConnectionLifecycle = useMemo(
		() =>
			captureLegacyServerConnectionLifecycleCapability(
				window.terminayServerConnectionHost,
			),
		[],
	);
	const serverFrameCapability = useMemo(
		() =>
			captureLegacyServerFrameCapability(window.terminayServerConnectionHost),
		[],
	);
	const legacySettingsClient = useMemo(
		() =>
			createLegacySettingsClient(
				window.terminayTerminalSettingsCompatibilityHost,
			),
		[],
	);
	const legacyMacroSettingsCapability = useMemo(
		() =>
			captureLegacyMacroSettingsCapability(
				window.terminayMacroSettingsCompatibilityHost,
			),
		[],
	);
	const disconnectedFileCompatibility =
		useMemo<DisconnectedFileCompatibility>(() => {
			const fileCapability = captureLegacyFileViewerCapability(
				window.terminayFileViewerCompatibilityHost,
			);
			const explorerHost = window.terminayFileExplorerHost;
			if (explorerHost === undefined) {
				throw new Error(
					'Desktop file explorer compatibility host is unavailable',
				);
			}
			return Object.freeze({
				filePanel: createDisconnectedFilePanelCompatibility(fileCapability),
				folderPanel: createDisconnectedFolderCompatibility(
					fileCapability,
					explorerHost,
				),
			});
		}, []);
	recordBoundedRendererRender(
		'renderer-entry',
		`${terminalClientContext?.serverId ?? auxiliaryClientContext?.serverId ?? 'none'}:${terminalClientContext?.workspaceSnapshotStore?.snapshot?.revision ?? 'none'}`,
	);
	const hasRequiredServerClient =
		!usesServerClient ||
		(usesApplicationOnlyServerClient
			? auxiliaryClientContext !== undefined
			: terminalClientContext !== undefined);
	window.terminayBootstrapDiagnostic?.record(
		!hasRequiredServerClient
			? 'renderer.render.connecting'
			: 'renderer.render.connected',
	);

	useEffect(() => {
		window.terminayBootstrapDiagnostic?.record(
			!hasRequiredServerClient
				? 'renderer.commit.connecting'
				: 'renderer.commit.connected',
		);
	}, [hasRequiredServerClient]);

	useEffect(() => {
		if (!usesServerClient) return () => undefined;
		let disposed = false;
		type ServerAnnouncement = Readonly<{
			connectionId: string;
			serverId: string;
			label?: string;
			replacement?: boolean;
		}>;
		type DesktopCandidate = {
			applicationContext: RendererApplicationClientContext;
			context?:
				| NonNullable<AppProps['terminalClientContext']>
				| AuxiliaryRendererClientContext;
			label?: string;
			dispose(): Promise<void>;
		};
		let pendingReplacement:
			| Readonly<{
					cleanup(): void;
					serverId: string;
					resolve(message: ServerAnnouncement): void;
			  }>
			| undefined;

		const publishConnectionState = (state: RendererConnectionState) => {
			if (disposed) return;
			const error =
				state.phase === 'retry-wait' && state.error !== undefined
					? describeServerClientError(state.error)
					: undefined;
			const status =
				state.phase === 'connected' || state.phase === 'idle'
					? undefined
					: state.phase === 'retry-wait'
						? `Server connection unavailable; retrying in ${state.nextRetryMs ?? 0}ms: ${error ?? 'unknown error'}`
						: `Server connection ${state.phase} (attempt ${state.attempt})…`;
			(
				window as Window & { __terminayServerClientState?: string }
			).__terminayServerClientState =
				state.phase === 'connected' ? 'connected' : status;
			setServerRecoveryStatus(status);
			setServerConnectionError(error);
		};
		const updateBootstrapPhaseFor =
			(serverId: string) =>
			(
				phase: RendererBootstrapPhase,
				state: 'pending' | 'complete' | 'failed',
				error?: unknown,
			) => {
				const target = window as Window & {
					__terminayServerClientBootstrap?: {
						serverId: string;
						phases: Partial<
							Record<RendererBootstrapPhase, { state: string; error?: string }>
						>;
					};
				};
				const diagnostic =
					target.__terminayServerClientBootstrap?.serverId === serverId
						? target.__terminayServerClientBootstrap
						: { serverId, phases: {} };
				diagnostic.phases[phase] = {
					state,
					...(error === undefined
						? {}
						: { error: describeServerClientError(error) }),
				};
				target.__terminayServerClientBootstrap = diagnostic;
			};

		const acquireReplacement = async (
			attempt: RendererConnectionAttempt,
		): Promise<ServerAnnouncement> => {
			const announcement = new Promise<ServerAnnouncement>(
				(resolve, reject) => {
					const timeout = window.setTimeout(() => {
						if (pendingReplacement?.resolve === resolve)
							pendingReplacement = undefined;
						attempt.signal.removeEventListener('abort', abort);
						reject(
							new Error('replacement server connection announcement timed out'),
						);
					}, 5_000);
					const abort = () => {
						window.clearTimeout(timeout);
						if (pendingReplacement?.resolve === resolve)
							pendingReplacement = undefined;
						reject(
							attempt.signal.reason ?? new Error('connection recovery aborted'),
						);
					};
					attempt.signal.addEventListener('abort', abort, { once: true });
					pendingReplacement = {
						cleanup: () => {
							window.clearTimeout(timeout);
							attempt.signal.removeEventListener('abort', abort);
						},
						serverId: attempt.profileId,
						resolve: (message) => {
							window.clearTimeout(timeout);
							attempt.signal.removeEventListener('abort', abort);
							resolve(message);
						},
					};
				},
			);
			try {
				const [, replacement] = await Promise.all([
					serverConnectionLifecycle.requestServerConnection(attempt.profileId),
					announcement,
				]);
				return replacement;
			} catch (error) {
				pendingReplacement?.cleanup();
				pendingReplacement = undefined;
				throw error;
			}
		};

		let controller: RendererConnectionController<DesktopCandidate>;
		const requestRecovery = (serverId: string) => {
			if (!disposed) controller.recover(serverId);
		};
		const makeRecoverableAuxiliaryContext = (
			context: RendererApplicationClientContext,
			serverId: string,
			label?: string,
		): AuxiliaryRendererClientContext => {
			let intentionallyDisposed = false;
			const removeStateListener = context.applicationClient.onStateChange(
				(change) => {
					if (
						!intentionallyDisposed &&
						(change.current.state === 'stale' ||
							change.current.state === 'closed' ||
							change.current.state === 'failed')
					)
						requestRecovery(serverId);
				},
			);
			return {
				...context,
				...(label === undefined ? {} : { connectionLabel: label }),
				dispose: async () => {
					intentionallyDisposed = true;
					removeStateListener();
					await context.dispose();
				},
			};
		};

		controller = new RendererConnectionController<DesktopCandidate>({
			dispose: (candidate) => candidate.dispose(),
			onActivated: (candidate) => {
				if (disposed || candidate.context === undefined) return;
				if (usesApplicationOnlyServerClient) {
					const context = candidate.context as AuxiliaryRendererClientContext;
					auxiliaryConnectionRef.current = context;
					setAuxiliaryClientContext(context);
				} else {
					const context = candidate.context as NonNullable<
						AppProps['terminalClientContext']
					>;
					connectionRef.current = context;
					setTerminalClientContext(context);
				}
				setServerConnectionError(undefined);
				window.terminayBootstrapDiagnostic?.record(
					'renderer.context.recovered',
				);
			},
			onStateChange: publishConnectionState,
		});

		const createPipeline = (
			serverId: string,
			firstAnnouncement: ServerAnnouncement,
		) => {
			let initialAnnouncement: ServerAnnouncement | undefined =
				firstAnnouncement;
			return {
				acquire: async (
					attempt: RendererConnectionAttempt,
				): Promise<DesktopCandidate> => {
					const announcement =
						initialAnnouncement ?? (await acquireReplacement(attempt));
					initialAnnouncement = undefined;
					const applicationContext = await connectRendererApplicationClient(
						serverId,
						announcement.connectionId,
						undefined,
						{
							preloadFrameCapability: serverFrameCapability,
							onTransportClosed: () => requestRecovery(serverId),
							onPhaseChange: updateBootstrapPhaseFor(serverId),
							signal: attempt.signal,
						},
					);
					const candidate: DesktopCandidate = {
						applicationContext,
						label: announcement.label,
						dispose: async () => {
							if (candidate.context !== undefined)
								await candidate.context.dispose?.();
							else await applicationContext.dispose();
						},
					};
					if (usesApplicationOnlyServerClient) {
						candidate.context = makeRecoverableAuxiliaryContext(
							applicationContext,
							serverId,
							announcement.label,
						);
					}
					return candidate;
				},
				resubscribe: async (
					candidate: DesktopCandidate,
					attempt: RendererConnectionAttempt,
				) => {
					if (usesApplicationOnlyServerClient) return;
					const context = await createRendererServerClientContext(
						candidate.applicationContext,
						{
							preloadFrameCapability: serverFrameCapability,
							onTransportClosed: () => requestRecovery(serverId),
							onPhaseChange: updateBootstrapPhaseFor(serverId),
							signal: attempt.signal,
						},
					);
					candidate.context = {
						...context,
						...(candidate.label === undefined
							? {}
							: { connectionLabel: candidate.label }),
					};
				},
				hydrate: async (candidate: DesktopCandidate) => {
					if (candidate.context === undefined)
						throw new Error('replacement server client was not hydrated');
				},
				verify: async (candidate: DesktopCandidate) => {
					if (candidate.context === undefined)
						throw new Error('replacement server client was not verified');
				},
			};
		};

		const unsubscribe = serverConnectionLifecycle.onServerConnection(
			(message) => {
				const isReplacement =
					(message as { readonly replacement?: unknown }).replacement === true;
				if (
					isReplacement &&
					pendingReplacement?.serverId === message.serverId
				) {
					const pending = pendingReplacement;
					pendingReplacement = undefined;
					pending.resolve(message);
					return;
				}
				if (isReplacement) {
					serverFrameCapability.closeServerConnection(message.connectionId);
					return;
				}
				if (
					controller.state.profileId === message.serverId &&
					controller.state.phase !== 'stopped'
				) {
					serverFrameCapability.closeServerConnection(message.connectionId);
					return;
				}
				window.terminayBootstrapDiagnostic?.record('renderer.context.resolved');
				controller.connect(
					message.serverId,
					createPipeline(message.serverId, message),
				);
			},
		);
		return () => {
			disposed = true;
			pendingReplacement?.cleanup();
			pendingReplacement = undefined;
			unsubscribe();
			void controller.stop();
			connectionRef.current = undefined;
			auxiliaryConnectionRef.current = undefined;
		};
	}, [serverConnectionLifecycle, serverFrameCapability]);

	useEffect(() => {
		let disposed = false;
		void window.terminayHost
			?.getContext()
			.then((context) => {
				if (!disposed) {
					setHostCapabilities(context.capabilities);
				}
			})
			.catch(() => {
				if (!disposed) setHostCapabilities(undefined);
			});
		return () => {
			disposed = true;
		};
	}, []);

	const activeApplicationClient =
		terminalClientContext?.applicationClient ??
		auxiliaryClientContext?.applicationClient;
	const serverSettingsClient = useMemo(
		() =>
			activeApplicationClient === undefined
				? undefined
				: createServerTerminalSettingsClient(
						new SettingsClient(
							new TerminayClientFacade(activeApplicationClient),
						),
						legacySettingsClient,
					),
		[activeApplicationClient, legacySettingsClient],
	);
	const serverMacroSettingsClient = useMemo(
		() =>
			activeApplicationClient === undefined
				? undefined
				: createServerMacroSettingsClient(
						new MacroClient(new TerminayClientFacade(activeApplicationClient)),
						legacyMacroSettingsCapability,
					),
		[activeApplicationClient, legacyMacroSettingsCapability],
	);
	const serverRecordingsClient = useMemo(
		() =>
			activeApplicationClient === undefined
				? undefined
				: new RecordingsClient(
						new TerminayClientFacade(activeApplicationClient),
					),
		[activeApplicationClient],
	);
	const shellProfilesClient = useMemo(
		() =>
			activeApplicationClient === undefined
				? undefined
				: new ShellProfilesClient(
						new TerminayClientFacade(activeApplicationClient),
					),
		[activeApplicationClient],
	);

	const legacyContent = (() => {
		const workspaceSnapshot =
			terminalClientContext?.workspaceSnapshotStore?.snapshot;
		const sharedProjectId =
			workspaceSnapshot == null
				? undefined
				: Object.keys(workspaceSnapshot.projects)[0];
		switch (view) {
			case 'connections':
				return (
					<SharedConnectionsRouteBody
						state={terminalClientContext === undefined ? 'loading' : 'ready'}
						activeConnectionId={terminalClientContext?.serverId}
						connections={
							terminalClientContext === undefined
								? []
								: [
										{
											id: terminalClientContext.serverId,
											label:
												terminalClientContext.connectionLabel ??
												terminalClientContext.serverId,
											status: 'connected',
										},
									]
						}
					/>
				);
			case 'git':
				return (
					<SharedGitRouteBody
						capabilityAvailable={
							terminalClientContext?.serverCapabilities?.includes('git') ===
							true
						}
						gitClient={terminalClientContext?.gitClient}
						projectId={sharedProjectId}
					/>
				);
			case 'agents':
				return (
					<SharedAgentRouteBody
						client={terminalClientContext?.agentStatusClient}
						loading={terminalClientContext === undefined}
					/>
				);
			case 'folder':
				return (
					<SharedFolderRouteBody
						client={terminalClientContext?.fileViewerClient}
						loading={terminalClientContext === undefined}
						projectId={sharedProjectId}
					/>
				);
			case 'terminal':
				return (
					<SharedTerminalRouteBody
						clientId={terminalClientContext?.clientId}
						loading={terminalClientContext === undefined}
						panelClient={
							terminalClientContext?.applicationClient === undefined
								? undefined
								: new TerminayTerminalPanelClient(terminalClientContext.client)
						}
						projectId={sharedProjectId}
						serverId={terminalClientContext?.serverId}
						terminalClient={terminalClientContext?.client}
					/>
				);
			case 'settings':
				return serverSettingsClient === undefined ? (
					serverConnectionError === undefined ? (
						<AuxiliaryPendingSurface />
					) : (
						<main className="terminay-server-connecting" role="alert">
							Server connection unavailable: {serverConnectionError}
						</main>
					)
				) : (
					<SettingsWindow
						remoteAccessStatusClient={window.terminayRemoteAccessStatusHost}
						settingsClient={serverSettingsClient}
						shellProfilesClient={shellProfilesClient}
						serverIdentity={
							terminalClientContext?.connectionLabel ??
							terminalClientContext?.serverId ??
							auxiliaryClientContext?.serverId ??
							'Local'
						}
					/>
				);
			case 'macros':
				return serverMacroSettingsClient === undefined ? (
					serverConnectionError === undefined ? (
						<AuxiliaryPendingSurface />
					) : (
						<main className="terminay-server-connecting" role="alert">
							Server connection unavailable: {serverConnectionError}
						</main>
					)
				) : (
					<MacrosWindow macroSettingsClient={serverMacroSettingsClient} />
				);
			case 'recordings':
				return serverRecordingsClient === undefined ? (
					serverConnectionError === undefined ? (
						<AuxiliaryPendingSurface />
					) : (
						<main className="terminay-server-connecting" role="alert">
							Server connection unavailable: {serverConnectionError}
						</main>
					)
				) : (
					<RecordingsWindow client={serverRecordingsClient} />
				);
			case 'edit-tab':
				return <EditTabWindow client={window.terminayEditWindowHost} />;
			default:
				// Desktop owns a server authority from the first visible workspace frame.
				// Rendering App before its framed client arrives seeds a legacy terminal,
				// which is then incorrectly rebound to the server client on hydration.
				return terminalClientContext === undefined ? (
					serverConnectionError === undefined ? (
						<main aria-busy="true" className="terminay-server-connecting">
							Connecting to Terminay server…
						</main>
					) : (
						<main className="terminay-server-connecting" role="alert">
							Server connection unavailable: {serverConnectionError}
						</main>
					)
				) : (
					// A successful connection selection is an authority boundary, not merely
					// a transport replacement. Re-keying prevents Local-owned view state
					// from surviving into the selected remote server (and vice versa).
					<ConnectedRendererWorkspace
						host={{ quickPushClient: window.terminayQuickPushHost }}
						terminalClientContext={terminalClientContext}
					/>
				);
		}
	})();
	const sharedRoute = sharedRouteForView(view);
	const desktopRouteModel =
		sharedRoute === undefined
			? undefined
			: createDesktopWorkspaceRouteRenderModel(sharedRoute);
	return (
		<DisconnectedFileCompatibilityProvider
			value={disconnectedFileCompatibility}
		>
			{serverRecoveryStatus === undefined ? null : (
				<div
					aria-live="polite"
					className="error-banner"
					role="status"
					style={{
						left: 0,
						pointerEvents: 'none',
						position: 'fixed',
						right: 0,
						top: 0,
						zIndex: 10_000,
					}}
				>
					{serverRecoveryStatus}
				</div>
			)}
			<TerminalSettingsClientProvider client={legacySettingsClient}>
				<LegacyMacroSettingsProvider capability={legacyMacroSettingsCapability}>
					{sharedRoute === undefined ? (
						legacyContent
					) : (
						<ResponsiveWorkspaceEntry
							route={sharedRoute}
							capabilities={hostCapabilities}
							presentation={desktopRouteModel?.presentation}
							legacyFallback={legacyContent}
						/>
					)}
				</LegacyMacroSettingsProvider>
			</TerminalSettingsClientProvider>
		</DisconnectedFileCompatibilityProvider>
	);
}
