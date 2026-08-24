/// <reference types="vite/client" />

import type { HostCapabilitySet } from '@terminay/client-core';
import type { TerminayTestApi } from './types/terminay';

declare global {
	interface Window {
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
			resolveDroppedFilePath?(file: File): string | undefined;
			readTerminalClipboard?(): Promise<string>;
		};
		terminayBytes?: {
			readonly version: 1;
			replaceEndpoint(): Promise<void>;
			send(frame: Uint8Array): Promise<void>;
			subscribe(listener: (frame: Uint8Array | null) => void): () => void;
		};
		terminayTest?: TerminayTestApi;
		terminayWorkspaceTest?: {
			resetCommandRecords(): Promise<void>;
			getCommandRecords(): Promise<
				readonly {
					operation: string;
					command?: {
						type: string;
						projectId?: string;
						sidebar?: Readonly<Record<string, unknown>>;
					};
				}[]
			>;
		};
		terminayLocalConnectionFaultTest?: {
			failActiveConnection: () => Promise<{ connectionId: string }>;
		};
		terminayAgentStatusTest?: {
			publishLifecycle: (payload: {
				provider: string;
				terminalSessionId: string;
				providerSessionId: string;
				events: ReadonlyArray<Record<string, unknown>>;
			}) => Promise<boolean>;
		};
		terminayAiMetadataTest?: {
			setMock: (mock: {
				error?: string | null;
				models?: readonly Readonly<{ id: string; label: string }>[];
				noteResult?: string;
				titleResult?: string;
			}) => Promise<void>;
		};
	}
}

export {};
