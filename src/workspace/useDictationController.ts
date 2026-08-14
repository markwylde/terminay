import {
	DictationCaptureClient,
	type DictationDisclosure,
	type TerminayAiClient,
} from '@terminay/client-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
	DictationOverlayProps,
	DictationOverlayState,
} from '../components/DictationOverlay';
import type { TerminalSettings } from '../types/settings';
import {
	blobToBase64,
	DICTATION_INITIAL_SILENCE_GRACE_MS,
	DICTATION_MIN_RECORDING_MS,
	DICTATION_MIN_SPEECH_FRAMES,
	DICTATION_MIN_SPEECH_RMS,
	DICTATION_RECORDER_TIMESLICE_MS,
	DICTATION_SCRIPT_PROCESSOR_BUFFER_SIZE,
	DICTATION_SILENCE_RMS_THRESHOLD,
	DICTATION_SPEECH_RMS_THRESHOLD,
	DICTATION_UPLOAD_LIMIT_BYTES,
	DICTATION_WAVEFORM_BAR_COUNT,
	DICTATION_WAVEFORM_GAIN,
	EMPTY_DICTATION_WAVEFORM,
	encodeDictationWav,
	formatDictationTranscriptForTerminal,
	getDictationFileExtension,
	getDictationMimeType,
	measureDictationBlobAudio,
} from './dictationAudioSupport';

export type DictationSessionState = DictationOverlayState & {
	sessionId: string;
};

type DictationControllerOptions = {
	aiClient?: TerminayAiClient;
	closeLauncher: () => void;
	defaultLanguage: string;
	focusTargetSession: (sessionId: string) => void;
	getActiveSessionId: () => string | null;
	getOverlayTargets: () => Array<{ color: string; sessionId: string }>;
	getSettings: () => TerminalSettings['dictation'];
	getDisclosure?: () => DictationDisclosure;
	getTargetIdentity?: (sessionId: string) => {
		serverId: string;
		projectId: string;
		panelId: string;
		sessionId: string;
	};
	hasTargetSession: (sessionId: string) => boolean;
	sendTerminalInput: (sessionId: string, input: string) => void;
	setErrorText: (message: string | null) => void;
};

export function useDictationController({
	aiClient,
	closeLauncher,
	defaultLanguage,
	focusTargetSession,
	getActiveSessionId,
	getOverlayTargets,
	getSettings,
	getDisclosure,
	getTargetIdentity,
	hasTargetSession,
	sendTerminalInput,
	setErrorText,
}: DictationControllerOptions) {
	const [session, setSession] = useState<DictationSessionState | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const monitorGainRef = useRef<GainNode | null>(null);
	const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
	const waveformFrameRef = useRef<number | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const pcmChunksRef = useRef<Float32Array[]>([]);
	const pcmLengthRef = useRef(0);
	const pcmSampleRateRef = useRef(0);
	const silenceStartedAtRef = useRef<number | null>(null);
	const peakRmsRef = useRef(0);
	const speechFrameCountRef = useRef(0);
	const serverCaptureRef = useRef<DictationCaptureClient | null>(null);
	const serverDisclosureRef = useRef<DictationDisclosure | null>(null);
	const startRef = useRef<() => Promise<void>>(async () => {});

	const cleanup = useCallback(() => {
		if (waveformFrameRef.current !== null) {
			window.cancelAnimationFrame(waveformFrameRef.current);
			waveformFrameRef.current = null;
		}
		streamRef.current?.getTracks().forEach((track) => {
			track.stop();
		});
		streamRef.current = null;
		mediaSourceRef.current = null;
		analyserRef.current = null;
		monitorGainRef.current = null;
		scriptProcessorRef.current?.disconnect();
		scriptProcessorRef.current = null;
		void audioContextRef.current?.close().catch(() => {});
		audioContextRef.current = null;
		mediaRecorderRef.current = null;
		pcmChunksRef.current = [];
		pcmLengthRef.current = 0;
		pcmSampleRateRef.current = 0;
		silenceStartedAtRef.current = null;
		peakRmsRef.current = 0;
		speechFrameCountRef.current = 0;
	}, []);

	const stop = useCallback(() => {
		const recorder = mediaRecorderRef.current;
		if (recorder?.state !== 'recording') return;
		setSession((current) =>
			current ? { ...current, status: 'processing' } : current,
		);
		recorder.stop();
	}, []);

	const cancel = useCallback(() => {
		serverCaptureRef.current?.cancel();
		serverCaptureRef.current = null;
		serverDisclosureRef.current = null;
		cleanup();
		setSession(null);
	}, [cleanup]);

	const insertTranscript = useCallback(
		async (sessionId: string, transcript: string) => {
			if (!hasTargetSession(sessionId)) {
				await window.terminayClipboardHost?.writeText(transcript);
				throw new Error(
					'The target terminal closed. Transcript copied to clipboard.',
				);
			}
			sendTerminalInput(
				sessionId,
				formatDictationTranscriptForTerminal(transcript),
			);
			focusTargetSession(sessionId);
		},
		[focusTargetSession, hasTargetSession, sendTerminalInput],
	);

	const startDictation = useCallback(async () => {
		closeLauncher();

		if (mediaRecorderRef.current?.state === 'recording') {
			setErrorText('Dictation is already recording.');
			return;
		}

		if (!getSettings().enabled) {
			setErrorText('Enable dictation in Settings before recording.');
			void window.terminaySettingsWindowHost?.open('dictation');
			return;
		}

		const sessionId = getActiveSessionId();
		if (!sessionId) {
			setErrorText('Open a terminal before starting dictation.');
			return;
		}

		try {
			const dictationHost = window.terminayDictationHost;
			if (dictationHost === undefined) {
				throw new Error('Desktop dictation is unavailable.');
			}
			const dictationSettings = getSettings();
			const keyStatus =
				aiClient === undefined && dictationSettings.provider === 'openai'
					? await dictationHost.getKeyStatus()
					: null;
			if (keyStatus !== null && !keyStatus.configured) {
				setErrorText(
					'Add an OpenAI API key in Settings before starting dictation.',
				);
				void window.terminaySettingsWindowHost?.open('dictation');
				return;
			}
			if (aiClient === undefined && dictationSettings.provider === 'parakeet') {
				const runtimeStatus = await dictationHost.getParakeetStatus();
				if (runtimeStatus.state !== 'ready') {
					setErrorText(
						runtimeStatus.message ??
							'Install the on-device Parakeet engine in Settings before starting dictation.',
					);
					void window.terminaySettingsWindowHost?.open('dictation');
					return;
				}
			}

			if (
				!navigator.mediaDevices?.getUserMedia ||
				typeof MediaRecorder === 'undefined'
			) {
				throw new Error(
					'Microphone recording is not available in this environment.',
				);
			}

			const microphonePermissionStatus =
				await dictationHost.requestMicrophonePermission();
			if (
				microphonePermissionStatus === 'denied' ||
				microphonePermissionStatus === 'restricted'
			) {
				throw new Error(
					`Microphone access is ${microphonePermissionStatus}. Allow microphone access in macOS Privacy & Security settings, then restart Terminay.`,
				);
			}

			const captureConfig = getSettings();
			const selectedMicrophoneDeviceId =
				captureConfig.microphoneDeviceId.trim();
			const audioConstraints: MediaTrackConstraints = {};
			if (selectedMicrophoneDeviceId) {
				audioConstraints.deviceId = { exact: selectedMicrophoneDeviceId };
			}

			let stream: MediaStream;
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					audio: audioConstraints,
				});
			} catch (error) {
				if (selectedMicrophoneDeviceId) {
					throw new Error(
						'Unable to open the selected microphone. Refresh the dictation microphone list in Settings or choose System default.',
					);
				}

				if (microphonePermissionStatus !== 'granted') {
					const message =
						error instanceof Error ? error.message : String(error);
					throw new Error(
						`Unable to open the microphone while permission is ${microphonePermissionStatus}: ${message}`,
					);
				}

				throw error;
			}
			const audioTrack = stream.getAudioTracks()[0] ?? null;
			console.info('Dictation microphone stream opened', {
				requestedDevice: selectedMicrophoneDeviceId ? 'selected' : 'default',
				muted: audioTrack?.muted,
				readyState: audioTrack?.readyState,
			});
			const mimeType = getDictationMimeType();
			const recorder = mimeType
				? new MediaRecorder(stream, { mimeType })
				: new MediaRecorder(stream);
			const actualMimeType = recorder.mimeType || mimeType || 'audio/webm';
			if (
				aiClient !== undefined &&
				getTargetIdentity !== undefined &&
				getDisclosure !== undefined
			) {
				const capture = new DictationCaptureClient({
					maxBytes: DICTATION_UPLOAD_LIMIT_BYTES,
					maxDurationMs: dictationSettings.maxDurationSeconds * 1000,
				});
				const disclosure = getDisclosure();
				capture.begin(getTargetIdentity(sessionId), disclosure, {
					mimeType: actualMimeType,
				});
				serverCaptureRef.current = capture;
				serverDisclosureRef.current = disclosure;
			}
			const audioContext = new AudioContext();
			await audioContext.resume();
			const source = audioContext.createMediaStreamSource(stream);
			const analyser = audioContext.createAnalyser();
			analyser.fftSize = 512;
			analyser.smoothingTimeConstant = 0.72;
			const processor = audioContext.createScriptProcessor(
				DICTATION_SCRIPT_PROCESSOR_BUFFER_SIZE,
				1,
				1,
			);
			const monitorGain = audioContext.createGain();
			monitorGain.gain.value = 0;
			source.connect(analyser);
			source.connect(processor);
			processor.connect(monitorGain);
			monitorGain.connect(audioContext.destination);

			const startedAt = Date.now();

			chunksRef.current = [];
			pcmChunksRef.current = [];
			pcmLengthRef.current = 0;
			pcmSampleRateRef.current = audioContext.sampleRate;
			streamRef.current = stream;
			mediaRecorderRef.current = recorder;
			audioContextRef.current = audioContext;
			mediaSourceRef.current = source;
			analyserRef.current = analyser;
			monitorGainRef.current = monitorGain;
			scriptProcessorRef.current = processor;
			silenceStartedAtRef.current = null;
			peakRmsRef.current = 0;
			speechFrameCountRef.current = 0;

			processor.onaudioprocess = (event) => {
				if (recorder.state !== 'recording') {
					return;
				}

				const input = event.inputBuffer.getChannelData(0);
				const samples = new Float32Array(input.length);
				samples.set(input);
				pcmChunksRef.current.push(samples);
				pcmLengthRef.current += samples.length;

				let sum = 0;
				for (const sample of samples) {
					sum += sample * sample;
				}
				const rms = Math.sqrt(sum / samples.length);
				peakRmsRef.current = Math.max(peakRmsRef.current, rms);
				if (rms >= DICTATION_SPEECH_RMS_THRESHOLD) {
					speechFrameCountRef.current += 1;
				}

				const now = Date.now();
				const elapsedMs = now - startedAt;
				const bars = Array.from(
					{ length: DICTATION_WAVEFORM_BAR_COUNT },
					(_, index) => {
						const start = Math.floor(
							(index / DICTATION_WAVEFORM_BAR_COUNT) * samples.length,
						);
						const end = Math.max(
							start + 1,
							Math.floor(
								((index + 1) / DICTATION_WAVEFORM_BAR_COUNT) * samples.length,
							),
						);
						let total = 0;
						for (let offset = start; offset < end; offset += 1) {
							total += Math.abs(samples[offset] ?? 0);
						}
						return Math.max(
							0.08,
							Math.min(1, (total / (end - start)) * DICTATION_WAVEFORM_GAIN),
						);
					},
				);

				setSession((current) =>
					current &&
					current.sessionId === sessionId &&
					current.status === 'recording'
						? { ...current, elapsedMs, waveformLevels: bars }
						: current,
				);

				const config = getSettings();
				const maxDurationMs = config.maxDurationSeconds * 1000;
				const silenceStopMs = config.silenceStopSeconds * 1000;
				if (elapsedMs >= maxDurationMs) {
					stop();
					return;
				}

				if (elapsedMs > DICTATION_INITIAL_SILENCE_GRACE_MS) {
					if (rms < DICTATION_SILENCE_RMS_THRESHOLD) {
						silenceStartedAtRef.current ??= now;
						if (now - silenceStartedAtRef.current >= silenceStopMs) {
							stop();
							return;
						}
					} else {
						silenceStartedAtRef.current = null;
					}
				}
			};

			recorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					chunksRef.current.push(event.data);
				}
			};

			recorder.onerror = () => {
				cleanup();
				setSession((current) =>
					current && current.sessionId === sessionId
						? {
								...current,
								status: 'failed',
								error: 'Microphone recording failed.',
							}
						: current,
				);
			};

			recorder.onstop = () => {
				void (async () => {
					const chunks = chunksRef.current;
					const pcmChunks = pcmChunksRef.current;
					const pcmLength = pcmLengthRef.current;
					const pcmSampleRate =
						pcmSampleRateRef.current || audioContext.sampleRate;
					const durationMs = Date.now() - startedAt;
					const peakRms = peakRmsRef.current;
					const speechFrameCount = speechFrameCountRef.current;
					chunksRef.current = [];
					pcmChunksRef.current = [];
					pcmLengthRef.current = 0;
					cleanup();

					if (chunks.length === 0 && pcmLength === 0) {
						setSession((current) =>
							current && current.sessionId === sessionId
								? {
										...current,
										status: 'failed',
										error: 'No dictation audio was captured.',
									}
								: current,
						);
						return;
					}

					const pcmAudioAvailable = pcmChunks.length > 0 && pcmLength > 0;
					const uploadMimeType = pcmAudioAvailable
						? 'audio/wav'
						: actualMimeType;
					const audioBlob = pcmAudioAvailable
						? encodeDictationWav(pcmChunks, pcmSampleRate, pcmLength)
						: new Blob(chunks, { type: actualMimeType });
					if (audioBlob.size === 0) {
						setSession((current) =>
							current && current.sessionId === sessionId
								? {
										...current,
										status: 'failed',
										error: 'No dictation audio was captured.',
									}
								: current,
						);
						return;
					}
					if (audioBlob.size > DICTATION_UPLOAD_LIMIT_BYTES) {
						setSession((current) =>
							current && current.sessionId === sessionId
								? {
										...current,
										status: 'failed',
										error: 'Dictation audio exceeds the 25 MB upload limit.',
									}
								: current,
						);
						return;
					}
					const recordedLevels =
						peakRms < DICTATION_MIN_SPEECH_RMS
							? await measureDictationBlobAudio(audioBlob)
							: null;
					const effectivePeakRms = Math.max(
						peakRms,
						recordedLevels?.peakRms ?? 0,
					);
					const audioDiagnostics = {
						audioBytes: audioBlob.size,
						audioSource: pcmAudioAvailable ? 'pcm-wav' : 'media-recorder',
						durationMs,
						livePeakRms: Number(peakRms.toFixed(5)),
						pcmLength,
						pcmSampleRate,
						recordedDurationMs: recordedLevels?.durationMs,
						recordedPeakRms:
							typeof recordedLevels?.peakRms === 'number'
								? Number(recordedLevels.peakRms.toFixed(5))
								: undefined,
						recordedRms:
							typeof recordedLevels?.rms === 'number'
								? Number(recordedLevels.rms.toFixed(5))
								: undefined,
						speechFrameCount,
						trackMuted: audioTrack?.muted,
						trackReadyState: audioTrack?.readyState,
					};
					console.info('Dictation audio diagnostics', audioDiagnostics);
					if (
						durationMs < DICTATION_MIN_RECORDING_MS ||
						(effectivePeakRms < DICTATION_MIN_SPEECH_RMS &&
							speechFrameCount < DICTATION_MIN_SPEECH_FRAMES)
					) {
						console.warn(
							'Dictation audio levels are below the local speech threshold; uploading anyway.',
							audioDiagnostics,
						);
					}

					setSession((current) =>
						current && current.sessionId === sessionId
							? { ...current, status: 'transcribing' }
							: current,
					);

					try {
						const config = getSettings();
						const result =
							aiClient !== undefined && serverCaptureRef.current !== null
								? await (async () => {
										const capture = serverCaptureRef.current!;
										serverCaptureRef.current = null;
										capture.append(
											new Uint8Array(await audioBlob.arrayBuffer()),
										);
										const upload = capture.finish({
											durationMs: Math.max(1, durationMs),
											mimeType: uploadMimeType,
										});
										return aiClient.transcribe({
											requestId: upload.requestId,
											target: upload.target,
											audio: upload.audio,
											durationMs: upload.durationMs,
											language: config.language.trim() || defaultLanguage,
											mimeType: upload.mimeType,
											model: config.model,
											peakLevel: effectivePeakRms,
											prompt: config.prompt,
										});
									})()
								: await (async () => {
										const dictationHost = window.terminayDictationHost;
										if (dictationHost === undefined)
											throw new Error('Desktop dictation is unavailable.');
										return dictationHost.transcribe({
											audioBase64: await blobToBase64(audioBlob),
											fileName: `dictation-${Date.now()}.${getDictationFileExtension(uploadMimeType)}`,
											language: config.language.trim() || defaultLanguage,
											mimeType: uploadMimeType,
											model: config.model,
											provider: config.provider,
											prompt: config.prompt,
										});
									})();
						const transcript =
							typeof result === 'object' &&
							result !== null &&
							'text' in result &&
							typeof result.text === 'string'
								? result.text.trim()
								: '';
						if (!transcript) {
							throw new Error(
								'The transcription provider returned an empty transcript.',
							);
						}

						await insertTranscript(sessionId, transcript);
						setErrorText(null);
						setSession((current) =>
							current && current.sessionId === sessionId
								? {
										...current,
										status: 'complete',
										transcript,
									}
								: current,
						);
						window.setTimeout(() => {
							setSession((current) =>
								current &&
								current.sessionId === sessionId &&
								current.status === 'complete'
									? null
									: current,
							);
						}, 1400);
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						setErrorText(`Dictation failed: ${message}`);
						setSession((current) =>
							current && current.sessionId === sessionId
								? { ...current, status: 'failed', error: message }
								: current,
						);
					}
				})();
			};

			recorder.start(DICTATION_RECORDER_TIMESLICE_MS);
			const disclosureText =
				serverDisclosureRef.current?.audioDestination === 'selected-server'
					? `Audio stays on ${serverDisclosureRef.current.serverLabel}.`
					: serverDisclosureRef.current?.audioDestination === 'openai'
						? `Audio is sent from ${serverDisclosureRef.current.serverLabel} to OpenAI.`
						: undefined;
			setSession({
				sessionId,
				...(disclosureText === undefined ? {} : { disclosure: disclosureText }),
				status: 'recording',
				elapsedMs: 0,
				waveformLevels: EMPTY_DICTATION_WAVEFORM,
			});
			setErrorText(null);
		} catch (error) {
			serverCaptureRef.current?.cancel();
			serverCaptureRef.current = null;
			serverDisclosureRef.current = null;
			cleanup();
			const message = error instanceof Error ? error.message : String(error);
			setErrorText(`Unable to start dictation: ${message}`);
			setSession({
				sessionId,
				status: 'failed',
				elapsedMs: 0,
				waveformLevels: EMPTY_DICTATION_WAVEFORM,
				error: message,
			});
		}
	}, [
		cleanup,
		closeLauncher,
		defaultLanguage,
		getActiveSessionId,
		getDisclosure,
		getSettings,
		getTargetIdentity,
		insertTranscript,
		setErrorText,
		stop,
	]);
	startRef.current = startDictation;

	const retry = useCallback(() => {
		setSession(null);
		void startRef.current();
	}, []);

	useEffect(() => cleanup, [cleanup]);

	useEffect(() => {
		for (const target of getOverlayTargets()) {
			const overlay: DictationOverlayProps | null =
				session?.sessionId === target.sessionId
					? {
							...session,
							accentColor: target.color,
							onCancel: cancel,
							onRetry: retry,
							onStop: stop,
						}
					: null;
			window.dispatchEvent(
				new CustomEvent('terminay-dictation-overlay', {
					detail: { sessionId: target.sessionId, overlay },
				}),
			);
		}
	}, [cancel, getOverlayTargets, retry, session, stop]);

	return {
		analyserRef,
		audioContextRef,
		cancel,
		chunksRef,
		cleanup,
		mediaRecorderRef,
		mediaSourceRef,
		monitorGainRef,
		pcmChunksRef,
		pcmLengthRef,
		pcmSampleRateRef,
		peakRmsRef,
		retry,
		scriptProcessorRef,
		session,
		setSession,
		silenceStartedAtRef,
		speechFrameCountRef,
		start: startDictation,
		startRef,
		stop,
		streamRef,
		waveformFrameRef,
	};
}
