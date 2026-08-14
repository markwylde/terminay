/// <reference types="vite/client" />

import type { HostCapabilitySet } from '@terminay/client-core';
import type { TerminayTestApi } from './types/terminay';

declare global {
	interface Window {
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
		terminayEditWindowHost: import('./components/EditTabWindow').EditWindowClient & {
			readonly version: 1;
		};
		terminayQuickPushHost: import('./components/QuickPushModal').QuickPushClient & {
			readonly version: 1;
		};
		terminayRemotePairingPinHost: import('./remotePairingPin').RemotePairingPinClient & {
			readonly version: 1;
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
		/** Bounded native settings-window capability for the current Desktop shell. */
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
