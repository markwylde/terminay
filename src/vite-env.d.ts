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
		};
		terminayBytes?: {
			readonly version: 1;
			replaceEndpoint(): Promise<void>;
			send(frame: Uint8Array): Promise<void>;
			subscribe(listener: (frame: Uint8Array | null) => void): () => void;
		};
		terminayTest?: TerminayTestApi;
		terminayLocalConnectionFaultTest?: {
			failActiveConnection: () => Promise<{ connectionId: string }>;
		};
		terminayAgentStatusTest?: {
			emitJournalRecord: (payload: {
				provider: 'codex' | 'claude';
				terminalSessionId: string;
				record: Record<string, unknown>;
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
