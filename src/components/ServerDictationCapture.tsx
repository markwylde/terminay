import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import type { DictationDisclosure, DictationTargetIdentity, TerminayAiClient } from '@terminay/client-core';
import { DictationOverlay } from './DictationOverlay';
import {
	createBrowserDictationRuntime,
	DictationCaptureController,
	publicDictationError,
	type DictationCaptureControllerOptions,
	type DictationControllerSnapshot,
} from './DictationCaptureController';

export interface ServerDictationCaptureProps {
	readonly client: TerminayAiClient;
	readonly target: DictationTargetIdentity;
	readonly disclosure: DictationDisclosure;
	readonly language?: string;
	readonly model?: string;
	readonly prompt?: string;
	readonly appendNewline?: boolean;
	readonly onTranscript?: (text: string, target: DictationTargetIdentity) => void;
}

/**
 * Shared renderer entry point for dictation. Hosts pass the already-connected
 * TerminayAiClient and the exact terminal target; this component never reads
 * provider settings, secrets, xterm state, or Electron preload methods.
 */
export function ServerDictationCapture({
	client,
	target,
	disclosure,
	language,
	model,
	prompt,
	appendNewline,
	onTranscript,
}: ServerDictationCaptureProps): JSX.Element {
	const runtimeResult = useMemo(() => {
		try {
			return { runtime: createBrowserDictationRuntime() };
		} catch (error) {
			return { error: publicDictationError(error) };
		}
	}, []);
	const controllerOptions = useMemo<DictationCaptureControllerOptions | undefined>(
		() => runtimeResult.runtime === undefined
			? undefined
			: ({
			client,
			target,
			disclosure,
			runtime: runtimeResult.runtime,
			...(language === undefined ? {} : { language }),
			...(model === undefined ? {} : { model }),
			...(prompt === undefined ? {} : { prompt }),
			...(appendNewline === undefined ? {} : { appendNewline }),
			onTranscript,
			}),
		[appendNewline, client, disclosure, language, model, onTranscript, prompt, runtimeResult.runtime, target],
	);
	const controller = useMemo(
		() => controllerOptions === undefined ? undefined : new DictationCaptureController(controllerOptions),
		[controllerOptions],
	);
	const [snapshot, setSnapshot] = useState<DictationControllerSnapshot>(() =>
		controller?.snapshot() ?? {
			status: 'failure',
			elapsedMs: 0,
			waveformLevels: [],
			error: runtimeResult.error ?? 'Microphone capture is unavailable.',
		},
	);
	useEffect(() => {
		if (controller === undefined) return;
		const unsubscribe = controller.subscribe(setSnapshot);
		return () => {
			unsubscribe();
			controller.dispose();
		};
	}, [controller]);

	const start = useCallback(() => {
		if (controller !== undefined) void controller.start();
	}, [controller]);
	const showOverlay =
		snapshot.status === 'recording' ||
		snapshot.status === 'stopping' ||
		snapshot.status === 'transcribing' ||
		snapshot.status === 'failure';
	if (controller === undefined) {
		return (
			<div className="server-dictation-capture" role="alert">
				{runtimeResult.error ?? 'Microphone capture is unavailable.'}
			</div>
		);
	}

	if (showOverlay) {
		return (
			<DictationOverlay
				status={snapshot.status === 'failure' ? 'failure' : snapshot.status}
				elapsedMs={snapshot.elapsedMs}
				waveformLevels={[...snapshot.waveformLevels]}
				error={snapshot.error}
				onStop={() => controller.stop()}
				onRetry={snapshot.status === 'failure' ? start : undefined}
				onCancel={() => controller.cancel()}
			/>
		);
	}

	return (
		<div className="server-dictation-capture">
			{snapshot.status === 'complete' && snapshot.transcript ? (
				<output className="server-dictation-capture__transcript" aria-live="polite">
					{snapshot.transcript}
				</output>
			) : null}
			<button
				type="button"
				className="dictation-overlay__button dictation-overlay__button--secondary"
				onClick={start}
				aria-label="Start dictation"
			>
				Start Dictation
			</button>
		</div>
	);
}
