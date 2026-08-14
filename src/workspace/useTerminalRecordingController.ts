import { useCallback } from 'react';
import type {
	TerminalRecordingStartMetadata,
	TerminalRecordingState,
} from '../types/terminay';

type RecordingClient = {
	reveal: (recordingId: string) => Promise<unknown>;
	start: (
		sessionId: string,
		metadata: TerminalRecordingStartMetadata,
	) => Promise<TerminalRecordingState>;
	stop: (
		sessionId: string,
		options?: { projectId: string },
	) => Promise<TerminalRecordingState>;
};

type TerminalRecordingControllerOptions = {
	applyState: (state: TerminalRecordingState) => void;
	getStartMetadata: (sessionId: string) => TerminalRecordingStartMetadata;
	projectId: string;
	serverClient?: RecordingClient;
	setErrorText: (message: string | null) => void;
};

export class RecordingCapabilityUnavailableError extends Error {
	readonly code = 'unavailable';

	constructor() {
		super('The selected server recording capability is unavailable');
		this.name = 'RecordingCapabilityUnavailableError';
	}
}

export function requireRecordingClient(
	client: RecordingClient | undefined,
): RecordingClient {
	if (client === undefined) throw new RecordingCapabilityUnavailableError();
	return client;
}

export function useTerminalRecordingController({
	applyState,
	getStartMetadata,
	projectId,
	serverClient,
	setErrorText,
}: TerminalRecordingControllerOptions) {
	const startRecordingForSession = useCallback(
		async (sessionId: string) => {
			try {
				const client = requireRecordingClient(serverClient);
				applyState(await client.start(sessionId, getStartMetadata(sessionId)));
			} catch (error) {
				setErrorText(
					`Unable to start recording: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
		[applyState, getStartMetadata, serverClient, setErrorText],
	);

	const stopRecordingForSession = useCallback(
		async (sessionId: string) => {
			try {
				const client = requireRecordingClient(serverClient);
				applyState(
					await client.stop(
						sessionId,
						{ projectId },
					),
				);
			} catch (error) {
				setErrorText(
					`Unable to stop recording: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
		[applyState, projectId, serverClient, setErrorText],
	);

	const revealRecording = useCallback(
		async (recordingId: string) => {
			try {
				await requireRecordingClient(serverClient).reveal(recordingId);
			} catch (error) {
				setErrorText(
					`Unable to reveal recording: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
		[serverClient, setErrorText],
	);

	// Recording state is part of the selected server's canonical workspace
	// projection. Hydration is therefore driven by workspace reconciliation,
	// never by a second host-local subscription.
	const hydrateRecordingStateForSession = useCallback((_sessionId: string) => {}, []);

	return {
		hydrateRecordingStateForSession,
		revealRecording,
		startRecordingForSession,
		stopRecordingForSession,
	};
}
