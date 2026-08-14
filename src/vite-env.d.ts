/// <reference types="vite/client" />

import type { HostCapabilitySet } from '@terminay/client-core';
import type { TerminayTestApi } from './types/terminay';

declare global {
	interface Window {
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
