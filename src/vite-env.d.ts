/// <reference types="vite/client" />

import type { HostCapabilitySet } from '@terminay/client-core';
import type { AppUpdateStatus, TerminayTestApi } from './types/terminay';

declare global {
	interface Window {
		/** Observation-only reporting for failures at the shared React root. */
		terminayDiagnosticsHost?: {
			readonly version: 1;
			reportRootError(
				payload: import('./types/desktopDiagnostics').RendererRootDiagnosticPayload,
			): void;
			reportTerminalRecovery(
				payload: import('./types/desktopDiagnostics').TerminalRecoveryDiagnosticPayload,
			): void;
		};
		terminayBootstrapDiagnostic?: {
			record(phase: string, count?: number): void;
		};
		/** Narrow native capability for selecting a Terminay server.  This is
		 * intentionally separate from the legacy broad preload compatibility
		 * surface while the rest of the Desktop migration is in progress. */
		terminayConnectionHost: {
			readonly version: 1;
			list(): Promise<{
				profiles: Array<{
					id: string;
					isLocal?: boolean;
					label: string;
					origin: string;
					serverId: string;
					selected: boolean;
					status: string;
				}>;
			}>;
			open(url: string, pairingPin?: string): Promise<void>;
			select(profileId: string): Promise<void>;
			rename(profileId: string, label: string): Promise<void>;
			forget(profileId: string): Promise<void>;
			revoke(profileId: string): Promise<void>;
		};
		/** Bounded Desktop remote-access service control and status boundary. */
		terminayRemoteAccessStatusHost: {
			readonly version: 1;
			getStatus(): Promise<import('./types/terminay').RemoteAccessStatus>;
			toggleServer(): Promise<import('./types/terminay').RemoteAccessStatus>;
			toggleDirectListener(): Promise<
				import('./types/terminay').RemoteAccessStatus
			>;
			revokeDevice(
				deviceId: string,
			): Promise<import('./types/terminay').RemoteAccessStatus>;
			closeConnection(
				connectionId: string,
			): Promise<import('./types/terminay').RemoteAccessStatus>;
			setPairingAddress(
				address: string,
			): Promise<import('./types/terminay').RemoteAccessStatus>;
			subscribe(
				listener: (
					status: import('./types/terminay').RemoteAccessStatus,
				) => void,
			): () => void;
		};
		/** Bounded renderer transport for the preload-owned server MessagePort. */
		terminayServerConnectionHost: {
			readonly version: 1;
			closeServerConnection(connectionId: string): void;
			onServerConnection(
				listener: (message: {
					connectionId: string;
					serverId: string;
					label?: string;
					replacement?: boolean;
				}) => void,
			): () => void;
			requestServerConnection(serverId: string): Promise<void>;
			sendServerFrame(connectionId: string, frame: Uint8Array): void;
			onServerFrame(
				connectionId: string,
				listener: (frame: Uint8Array | null) => void,
			): () => void;
		};
		terminayFileViewerCompatibilityHost: import('./services/fileViewer/terminayFileGateway').LegacyFileGatewayApi;
		terminayTerminalSettingsCompatibilityHost: import('./services/settings/legacySettingsCapability').LegacySettingsApi & {
			readonly version: 1;
		};
		terminayMacroSettingsCompatibilityHost: import('./services/macros/legacyMacroSettingsCapability').LegacyMacroSettingsApi & {
			readonly version: 1;
		};
		terminayAiMetadataHost: import('./services/ai/legacyAiTabMetadataClient').LegacyAiTabMetadataApi & {
			readonly version: 1;
		};
		terminayEditWindowHost: import('./components/EditTabWindow').EditWindowClient & {
			readonly version: 1;
		};
		terminayQuickPushHost: import('./components/QuickPushModal').QuickPushClient & {
			readonly version: 1;
		};
		terminayRemotePairingPinHost: import('./remotePairingPin').RemotePairingPinClient & {
			readonly version: 1;
		};
		/** Read-only Desktop file-explorer bootstrap capability. */
		terminayFileExplorerHost?: {
			readonly version: 1;
			subscribeWatchEvents(
				listener: (
					message: import('./types/terminay').FileExplorerWatchEvent,
				) => void,
			): () => void;
			subscribeFolderSizeProgress(
				listener: (
					message: import('./types/terminay').FolderSizeProgress,
				) => void,
			): () => void;
			getHomePath(): Promise<string>;
			calculateFolderSize(request: {
				jobId: string;
				path: string;
			}): Promise<import('./types/terminay').FolderSizeResult>;
			cancelFolderSize(jobId: string): Promise<void>;
			resolveDroppedFilePath(file: File): string;
			searchFiles(request: {
				rootPath: string;
				query: string;
				limit: number;
			}): Promise<import('./types/terminay').FileSearchResult[]>;
			watchDirectory(path: string): Promise<void>;
			unwatchDirectory(path: string): Promise<void>;
		};
		/** Bounded native project-editor capability for the current Desktop shell. */
		terminayProjectEditHost?: {
			readonly version: 1;
			open(
				request: import('./types/terminay').ProjectEditWindowDraft & {
					projectId: string;
				},
			): Promise<import('./types/terminay').ProjectEditWindowResult | null>;
		};
		terminayTerminalEditHost?: {
			readonly version: 1;
			open(
				draft: import('./types/terminay').TerminalEditWindowDraft,
			): Promise<import('./types/terminay').TerminalEditWindowResult | null>;
		};
		/** Native microphone, credential-store, and transcription capability. */
		terminayDictationHost?: {
			readonly version: 1;
			getParakeetStatus(): Promise<
				import('./types/terminay').ParakeetRuntimeStatus
			>;
			installParakeet(): Promise<
				import('./types/terminay').ParakeetRuntimeStatus
			>;
			getKeyStatus(): Promise<import('./types/terminay').DictationKeyStatus>;
			saveKey(
				apiKey: string,
			): Promise<import('./types/terminay').DictationKeyStatus>;
			clearKey(): Promise<import('./types/terminay').DictationKeyStatus>;
			getMicrophonePermissionStatus(): Promise<
				import('./types/terminay').DictationMicrophonePermissionStatus
			>;
			requestMicrophonePermission(): Promise<
				import('./types/terminay').DictationMicrophonePermissionStatus
			>;
			transcribe(
				request: import('./types/terminay').DictationTranscribeRequest,
			): Promise<import('./types/terminay').DictationTranscribeResult>;
		};
		/** Narrow OS-link capability for the current Desktop workspace. */
		terminayExternalHost?: {
			readonly version: 1;
			open(url: string): Promise<void>;
		};
		/** Read-only native update availability for the current Desktop shell. */
		terminayUpdateHost?: {
			readonly version: 1;
			getStatus(force?: boolean): Promise<AppUpdateStatus>;
		};
		/** Narrow OS clipboard capability used by terminal presentation only. */
		terminayClipboardHost?: {
			readonly version: 1;
			subscribeCopyRequest(listener: () => void): () => void;
			readText(): Promise<string>;
			writeText(text: string): Promise<void>;
		};
		/** Read-only native terminal presentation state. */
		terminayTerminalPresentationHost?: {
			readonly version: 1;
			subscribeZoom(
				listener: (
					message: import('./types/terminay').TerminalZoomMessage,
				) => void,
			): () => void;
			subscribeRemoteSizeOverride(
				listener: (
					message: import('./types/terminay').TerminalRemoteSizeOverrideMessage,
				) => void,
			): () => void;
			getZoom(): Promise<number>;
			updateMetadata(
				sessionId: string,
				metadata: {
					title?: string;
					emoji?: string;
					color?: string;
					inheritsProjectColor?: boolean;
					viewportWidth?: number;
					viewportHeight?: number;
					projectId?: string;
					projectTitle?: string;
					projectEmoji?: string;
					projectColor?: string;
				},
			): void;
		};
		/** Bounded wait capability for an already attached server terminal. */
		terminayTerminalLifecycleHost: {
			readonly version: 1;
			waitForInactivity(
				identity: {
					readonly serverId: string;
					readonly projectId: string;
					readonly sessionId: string;
					readonly clientId: string;
				},
				durationMs: number,
			): Promise<void>;
		};
		/** Narrow OS reveal capability for the current Desktop workspace. */
		terminayRevealHost?: {
			readonly version: 1;
			reveal(filePath: string): Promise<void>;
		};
		/** Bounded Desktop-only MCP configuration capability. */
		terminayMcpInstallHost?: {
			readonly version: 1;
			getStatus(): Promise<import('./types/terminay').McpInstallStatus>;
			install(
				agent: import('./types/terminay').McpAgentId,
			): Promise<import('./types/terminay').McpInstallActionResult>;
			uninstall(
				agent: import('./types/terminay').McpAgentId,
			): Promise<import('./types/terminay').McpInstallActionResult>;
		};
		/** Bounded native recordings-window capability for the current Desktop shell. */
		terminayRecordingsHost?: {
			readonly version: 1;
			open(): Promise<void>;
		};
		/** Bounded Desktop recordings lifecycle/data capability. */
		terminayRecordingServiceHost?: {
			readonly version: 1;
			getTerminalRecordingState(
				sessionId: string,
			): Promise<import('./types/terminay').TerminalRecordingState>;
			startTerminalRecording(
				sessionId: string,
				metadata?: import('./types/terminay').TerminalRecordingStartMetadata,
			): Promise<import('./types/terminay').TerminalRecordingState>;
			stopTerminalRecording(
				sessionId: string,
			): Promise<import('./types/terminay').TerminalRecordingState>;
			listTerminalRecordings(): Promise<
				import('./types/terminay').TerminalRecordingListItem[]
			>;
			readTerminalRecordingChunk(
				request: import('./types/terminay').TerminalRecordingChunkRequest,
			): Promise<import('./types/terminay').TerminalRecordingChunk>;
			deleteTerminalRecordingById(recordingId: string): Promise<void>;
			revealTerminalRecordingById(recordingId: string): Promise<void>;
			onTerminalRecordingChanged(
				listener: (
					message: import('./types/terminay').TerminalRecordingChangeMessage,
				) => void,
			): () => void;
		};
		/** Bounded native window lifecycle capability for the current Desktop shell. */
		terminayWindowLifecycleHost?: {
			readonly version: 1;
			closeCurrent(confirmedRunningWork?: boolean): Promise<void>;
			confirmClose(
				kind: 'terminal' | 'project',
				runningTerminalCount: number,
			): Promise<boolean>;
			publishRunningTerminalSessions(
				sessionIds: readonly string[],
			): Promise<void>;
		};
		/** Bounded native settings-window capability for the current Desktop shell. */
		terminaySettingsWindowHost?: {
			readonly version: 1;
			subscribeFocusSection(
				listener: (message: { sectionId: string }) => void,
			): () => void;
			open(sectionId?: string): Promise<void>;
		};
		/** Bounded native project-environments window capability. */
		terminayProjectEnvironmentsHost?: {
			readonly version: 1;
			open(
				intent?: Readonly<{
					providerId: string;
					mode: 'profile' | 'environment';
					profileId?: string;
				}>,
			): Promise<void>;
			subscribeIntent(
				listener: (
					intent: Readonly<{
						providerId: string;
						mode: 'profile' | 'environment';
						profileId?: string;
					}>,
				) => void,
			): () => void;
		};
		/** Bounded native tab-bar presentation for the current Desktop window. */
		terminayProjectTabHost?: {
			readonly version: 1;
			subscribeDragHover(
				listener: (
					message: import('./types/terminay').ProjectTabDragHoverMessage,
				) => void,
			): () => void;
			subscribeTornOff(
				listener: (message: { active: boolean }) => void,
			): () => void;
			publishBarRect(
				rect: { x: number; y: number; width: number; height: number } | null,
			): Promise<void>;
			startDrag(
				preview: import('./types/terminay').ProjectTabDragPreview,
			): Promise<void>;
			endDrag(): Promise<import('./types/terminay').ProjectTabDragResult>;
		};
		/** Bounded native project transfer capability for the current Desktop window. */
		terminayWorkspaceTransferHost?: {
			readonly version: 1;
			bindView(viewId: string): Promise<void>;
			subscribeAdoptedProject(
				listener: (
					project: import('./types/terminay').AdoptedProjectPayload,
				) => void,
			): () => void;
			getAdoptedProject(): Promise<
				import('./types/terminay').AdoptedProjectPayload | null
			>;
			popoutProject(
				project: import('./types/terminay').AdoptedProjectPayload,
				targetViewId: string,
				x: number,
				y: number,
			): Promise<{ ok: boolean; windowId?: number }>;
			mergeProject(
				project: import('./types/terminay').AdoptedProjectPayload,
				targetWindowId: number,
			): Promise<{ ok: boolean }>;
		};
		/** Bounded native menu/keyboard command subscription. */
		terminayAppCommandHost?: {
			readonly version: 1;
			subscribe(
				listener: (
					command: import('./types/terminay').AppCommand,
				) => Promise<void> | void,
			): () => void;
		};
		terminayHost?: {
			getContext(): Promise<{
				version: number;
				hostKind?: string;
				windowId: string;
				connectionId: string;
				profileLabel: string;
				capabilities: HostCapabilitySet;
				presentation: unknown;
				profile?: { id: string; label: string };
				profiles?: readonly {
					id: string;
					isLocal?: boolean;
					label: string;
					serverId: string;
					status: string;
				}[];
			}>;
			requestAction(
				action: unknown,
				options?: { readonly userGesture?: boolean },
			): Promise<unknown>;
		};
		terminayBytes?: {
			readonly version: 1;
			send(frame: Uint8Array): Promise<void>;
			subscribe(listener: (frame: Uint8Array | null) => void): () => void;
		};
		terminayTest?: TerminayTestApi;
	}
}

export {};
