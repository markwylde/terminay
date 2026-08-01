import { useCallback, useEffect } from 'react';
import type {
	TerminalRecordingStartMetadata,
	TerminalRecordingState,
} from '../types/terminay';

type RecordingClient = {
	getState: (sessionId: string) => Promise<TerminalRecordingState>;
	onStateChanged: (
		listener: (state: TerminalRecordingState) => void,
	) => () => void;
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
	legacyClient?: RecordingClient;
	projectId: string;
	serverClient?: Pick<RecordingClient, 'start' | 'stop'>;
	setErrorText: (message: string | null) => void;
};

export function useTerminalRecordingController({
	applyState,
	getStartMetadata,
	legacyClient,
	projectId,
	serverClient,
	setErrorText,
}: TerminalRecordingControllerOptions) {
	const startRecordingForSession = useCallback(
		async (sessionId: string) => {
			try {
				const client = serverClient ?? legacyClient;
				if (client === undefined)
					throw new Error('Recording capability is unavailable');
				applyState(await client.start(sessionId, getStartMetadata(sessionId)));
			} catch (error) {
				setErrorText(
					`Unable to start recording: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
		[applyState, getStartMetadata, legacyClient, serverClient, setErrorText],
	);

	const stopRecordingForSession = useCallback(
		async (sessionId: string) => {
			try {
				const client = serverClient ?? legacyClient;
				if (client === undefined)
					throw new Error('Recording capability is unavailable');
				applyState(
					await client.stop(
						sessionId,
						serverClient === undefined ? undefined : { projectId },
					),
				);
			} catch (error) {
				setErrorText(
					`Unable to stop recording: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
		[applyState, legacyClient, projectId, serverClient, setErrorText],
	);

	const revealRecording = useCallback(
		async (recordingId: string) => {
			try {
				if (legacyClient === undefined) {
					throw new Error('Recording reveal is unavailable in this host');
				}
				await legacyClient.reveal(recordingId);
			} catch (error) {
				setErrorText(
					`Unable to reveal recording: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
		[legacyClient, setErrorText],
	);

	const hydrateRecordingStateForSession = useCallback(
		(sessionId: string) => {
			if (legacyClient !== undefined) {
				void legacyClient.getState(sessionId).then(applyState, () => {});
			}
		},
		[applyState, legacyClient],
	);

	useEffect(() => {
		if (legacyClient === undefined) return;
		return legacyClient.onStateChanged(applyState);
	}, [applyState, legacyClient]);

	return {
		hydrateRecordingStateForSession,
		revealRecording,
		startRecordingForSession,
		stopRecordingForSession,
	};
}
