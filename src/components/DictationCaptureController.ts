import {
	DictationCaptureClient,
	 type DictationCaptureClientOptions,
	 type DictationDisclosure,
	 type DictationTargetIdentity,
	TerminayAiClient,
} from '@terminay/client-core';

export type DictationControllerStatus =
	| 'idle'
	| 'recording'
	| 'stopping'
	| 'transcribing'
	| 'complete'
	| 'failure'
	| 'cancelled';

export interface DictationMediaStreamTrack {
	stop: () => void;
}

export interface DictationMediaStream {
	getTracks: () => readonly DictationMediaStreamTrack[];
}

export interface DictationMediaDevices {
	getUserMedia: (constraints: MediaStreamConstraints) => Promise<DictationMediaStream>;
}

export interface DictationMediaRecorderEvent {
	readonly data: Blob;
}

export interface DictationMediaRecorder {
	readonly state: 'inactive' | 'recording' | 'paused';
	readonly mimeType?: string;
	ondataavailable: ((event: DictationMediaRecorderEvent) => void) | null;
	onstop: (() => void) | null;
	onerror: (() => void) | null;
	start: (timeslice?: number) => void;
	stop: () => void;
}

export interface DictationAudioMeter {
	readLevel: () => number;
	close: () => void;
}

export interface DictationCaptureRuntime {
	readonly mediaDevices: DictationMediaDevices;
	readonly createRecorder: (
		stream: DictationMediaStream,
		mimeType?: string,
	) => DictationMediaRecorder;
	readonly isMimeTypeSupported?: (mimeType: string) => boolean;
	readonly createMeter?: (stream: DictationMediaStream) => DictationAudioMeter | undefined;
	readonly now?: () => number;
	readonly schedule?: (callback: () => void) => number;
	readonly cancelSchedule?: (handle: number) => void;
}

export interface DictationControllerSnapshot {
	readonly status: DictationControllerStatus;
	readonly elapsedMs: number;
	readonly waveformLevels: readonly number[];
	readonly transcript?: string;
	readonly error?: string;
}

export interface DictationCaptureControllerOptions {
	readonly client: TerminayAiClient;
	readonly target: DictationTargetIdentity;
	readonly disclosure: DictationDisclosure;
	readonly runtime: DictationCaptureRuntime;
	readonly capture?: DictationCaptureClientOptions;
	readonly language?: string;
	readonly model?: string;
	readonly prompt?: string;
	readonly appendNewline?: boolean;
	readonly silenceStopMs?: number;
	readonly silenceThreshold?: number;
	readonly onTranscript?: (text: string, target: DictationTargetIdentity) => void;
}

const DEFAULT_MIME_TYPES = [
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/mp4',
	'audio/wav',
] as const;
const DEFAULT_SILENCE_STOP_MS = 5_000;
const DEFAULT_SILENCE_THRESHOLD = 0.035;

/** Select a browser recorder format without making the server aware of browser capabilities. */
export function selectDictationMimeType(
	isSupported: (mimeType: string) => boolean = () => true,
): string | undefined {
	return DEFAULT_MIME_TYPES.find((mimeType) => isSupported(mimeType));
}

/** Small deterministic silence state machine used by the audio-level loop. */
export class DictationSilenceDetector {
	private silentSince: number | undefined;

	constructor(
		private readonly stopAfterMs = DEFAULT_SILENCE_STOP_MS,
		private readonly threshold = DEFAULT_SILENCE_THRESHOLD,
	) {
		if (!Number.isSafeInteger(stopAfterMs) || stopAfterMs <= 0) {
			throw new RangeError('silence stop duration must be positive');
		}
		if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
			throw new RangeError('silence threshold must be between zero and one');
		}
	}

	observe(level: number, now: number): boolean {
		const audible = Number.isFinite(level) && level >= this.threshold;
		if (audible) {
			this.silentSince = undefined;
			return false;
		}
		this.silentSince ??= now;
		return now - this.silentSince >= this.stopAfterMs;
	}

	reset(): void {
		this.silentSince = undefined;
	}
}

/**
 * Renderer-side dictation orchestration. It owns browser hardware only; the
 * transcript request crosses the existing shared binary AI client boundary.
 */
export class DictationCaptureController {
	private readonly capture: DictationCaptureClient;
	private readonly listeners = new Set<(snapshot: DictationControllerSnapshot) => void>();
	private readonly runtime: DictationCaptureRuntime;
	private readonly client: TerminayAiClient;
	private readonly target: DictationTargetIdentity;
	private readonly disclosure: DictationDisclosure;
	private readonly language: string | undefined;
	private readonly model: string | undefined;
	private readonly prompt: string | undefined;
	private readonly appendNewline: boolean | undefined;
	private readonly silenceStopMs: number;
	private readonly silenceThreshold: number;
	private readonly onTranscript: ((text: string, target: DictationTargetIdentity) => void) | undefined;
	private statusValue: DictationControllerStatus = 'idle';
	private elapsedMsValue = 0;
	private waveformLevelsValue: number[] = [];
	private transcriptValue: string | undefined;
	private errorValue: string | undefined;
	private stream: DictationMediaStream | undefined;
	private recorder: DictationMediaRecorder | undefined;
	private meter: DictationAudioMeter | undefined;
	private scheduleHandle: number | undefined;
	private recorderMimeType: string | undefined;
	private peakLevel = 0;
	private pendingChunks: Promise<void>[] = [];
	private requestAbortController: AbortController | undefined;
	private silenceDetector: DictationSilenceDetector;

	constructor(options: DictationCaptureControllerOptions) {
		this.capture = new DictationCaptureClient(options.capture);
		this.runtime = options.runtime;
		this.client = options.client;
		this.target = copyTarget(options.target);
		this.disclosure = { ...options.disclosure };
		this.language = options.language;
		this.model = options.model;
		this.prompt = options.prompt;
		this.appendNewline = options.appendNewline;
		this.silenceStopMs = options.silenceStopMs ?? DEFAULT_SILENCE_STOP_MS;
		this.silenceThreshold = options.silenceThreshold ?? DEFAULT_SILENCE_THRESHOLD;
		this.onTranscript = options.onTranscript;
		this.silenceDetector = new DictationSilenceDetector(
			this.silenceStopMs,
			this.silenceThreshold,
		);
	}

	snapshot(): DictationControllerSnapshot {
		return Object.freeze({
			status: this.statusValue,
			elapsedMs: this.elapsedMsValue,
			waveformLevels: Object.freeze([...this.waveformLevelsValue]),
			...(this.transcriptValue === undefined ? {} : { transcript: this.transcriptValue }),
			...(this.errorValue === undefined ? {} : { error: this.errorValue }),
		});
	}

	subscribe(listener: (snapshot: DictationControllerSnapshot) => void): () => void {
		this.listeners.add(listener);
		listener(this.snapshot());
		return () => this.listeners.delete(listener);
	}

	async start(): Promise<void> {
		if (
			this.statusValue === 'recording' ||
			this.statusValue === 'stopping' ||
			this.statusValue === 'transcribing'
		)
			return;
		this.resetForStart();
		const mimeType = selectDictationMimeType(this.runtime.isMimeTypeSupported);
		this.capture.begin(this.target, this.disclosure, { mimeType });
		try {
			this.stream = await this.runtime.mediaDevices.getUserMedia({ audio: true });
			this.recorder = this.runtime.createRecorder(this.stream, mimeType);
			this.recorderMimeType = this.recorder.mimeType ?? mimeType;
			this.recorder.ondataavailable = (event) => {
				const pending = this.appendBlob(event.data);
				this.pendingChunks.push(pending);
				void pending.catch(() => this.fail('The recording exceeded its local limit.'));
			};
			this.recorder.onstop = () => void this.finishRecording();
			this.recorder.onerror = () => this.fail('The microphone recording failed.');
			this.meter = this.runtime.createMeter?.(this.stream);
			this.recorder.start(250);
			this.setStatus('recording');
			this.scheduleLevelSample();
		} catch (error) {
			this.capture.cancel('cancelled');
			this.cleanupHardware();
			this.fail(publicDictationError(error));
		}
	}

	stop(): void {
		if (this.statusValue !== 'recording') return;
		this.setStatus('stopping');
		if (this.recorder === undefined || this.recorder.state === 'inactive') {
			void this.finishRecording();
			return;
		}
		try {
			this.recorder.stop();
		} catch (error) {
			this.fail(publicDictationError(error));
		}
	}

	cancel(): void {
		if (this.statusValue === 'idle' || this.statusValue === 'cancelled') return;
		this.capture.cancel('cancelled');
		this.requestAbortController?.abort();
		const requestId = this.capture.snapshot().requestId;
		if (requestId !== undefined) void this.client.cancel(requestId).catch(() => undefined);
		if (this.recorder !== undefined && this.recorder.state !== 'inactive') {
			try {
				this.recorder.stop();
			} catch {
				// Hardware cleanup below is still required when a recorder is already closing.
			}
		}
		this.cleanupHardware();
		this.setStatus('cancelled');
	}

	dispose(): void {
		this.cancel();
		this.listeners.clear();
	}

	private resetForStart(): void {
		this.capture.reset();
		this.transcriptValue = undefined;
		this.errorValue = undefined;
		this.elapsedMsValue = 0;
		this.waveformLevelsValue = [];
		this.peakLevel = 0;
		this.pendingChunks = [];
		this.silenceDetector.reset();
		this.setStatus('idle');
	}

	private async appendBlob(blob: Blob): Promise<void> {
		if (!(blob instanceof Blob) || blob.size === 0) return;
		this.capture.append(new Uint8Array(await blob.arrayBuffer()));
	}

	private async finishRecording(): Promise<void> {
		if (this.statusValue === 'cancelled') return;
		try {
			await Promise.all(this.pendingChunks);
			const upload = this.capture.finish({
				mimeType: this.recorderMimeType,
				durationMs: Math.max(1, this.elapsedMsValue),
			});
			this.cleanupHardware();
			this.setStatus('transcribing');
			this.requestAbortController = new AbortController();
			const result = await this.client.transcribe(
				{
					requestId: upload.requestId,
					target: upload.target,
					mimeType: upload.mimeType,
					durationMs: upload.durationMs,
					audio: upload.audio,
					...(this.language === undefined ? {} : { language: this.language }),
					...(this.model === undefined ? {} : { model: this.model }),
					...(this.prompt === undefined ? {} : { prompt: this.prompt }),
					...(this.appendNewline === undefined ? {} : { appendNewline: this.appendNewline }),
					peakLevel: this.peakLevel,
				},
				{ signal: this.requestAbortController.signal },
			);
			if (this.isCancelled()) return;
			const text = readDictationTranscript(result);
			this.transcriptValue = text;
			this.setStatus('complete');
			this.onTranscript?.(text, copyTarget(upload.target));
		} catch (error) {
			if (!this.isCancelled()) this.fail(publicDictationError(error));
		}
	}

	private scheduleLevelSample(): void {
		if (this.statusValue !== 'recording') return;
		const now = this.runtime.now?.() ?? Date.now();
		this.elapsedMsValue = Math.max(0, now - (this.capture.snapshot().startedAt ?? now));
		const level = this.meter?.readLevel() ?? 0;
		this.peakLevel = Math.max(this.peakLevel, clampLevel(level));
		this.waveformLevelsValue = [...this.waveformLevelsValue.slice(-17), clampLevel(level)];
		this.emit();
		if (this.meter !== undefined && this.silenceDetector.observe(level, now)) {
			this.stop();
			return;
		}
		if (this.runtime.schedule !== undefined) {
			this.scheduleHandle = this.runtime.schedule(() => this.scheduleLevelSample());
		}
	}

	private fail(message: string): void {
		if (this.isCancelled()) return;
		if (this.capture.status === 'recording') this.capture.cancel('cancelled');
		this.requestAbortController?.abort();
		this.cleanupHardware();
		this.errorValue = message;
		this.setStatus('failure');
	}

	private cleanupHardware(): void {
		if (this.scheduleHandle !== undefined) {
			this.runtime.cancelSchedule?.(this.scheduleHandle);
			this.scheduleHandle = undefined;
		}
		this.meter?.close();
		this.meter = undefined;
		for (const track of this.stream?.getTracks() ?? []) track.stop();
		this.stream = undefined;
		this.recorder = undefined;
	}

	private setStatus(status: DictationControllerStatus): void {
		this.statusValue = status;
		this.emit();
	}

	private isCancelled(): boolean {
		return this.statusValue === 'cancelled';
	}

	private emit(): void {
		const snapshot = this.snapshot();
		for (const listener of this.listeners) listener(snapshot);
	}
}

export function readDictationTranscript(value: unknown): string {
	if (
		typeof value !== 'object' ||
		value === null ||
		Array.isArray(value) ||
		typeof (value as { text?: unknown }).text !== 'string'
	) {
		throw new Error('The transcription response was invalid.');
	}
	const text = (value as { text: string }).text.trim();
	if (text.length === 0 || text.length > 32_000 || /[\0]/u.test(text)) {
		throw new Error('The transcription response was invalid.');
	}
	return text;
}

export function publicDictationError(error: unknown): string {
	const code = typeof error === 'object' && error !== null && 'code' in error
		? String((error as { code: unknown }).code)
		: '';
	return ({
		forbidden: 'This server is not authorized for the selected terminal.',
		not_found: 'The selected terminal is no longer available.',
		deadline: 'Dictation timed out.',
		cancelled: 'Dictation was cancelled.',
		resource: 'The recording exceeded a server limit.',
		unavailable: 'The selected transcription provider is unavailable.',
		validation: 'The recording could not be transcribed.',
	}[code] ?? (error instanceof DOMException && error.name === 'NotAllowedError'
		? 'Microphone permission was not granted.'
		: 'Dictation could not be completed.'));
}

export function createBrowserDictationRuntime(): DictationCaptureRuntime {
	if (!globalThis.navigator?.mediaDevices?.getUserMedia) {
		throw new Error('Microphone capture is not available in this renderer.');
	}
	const recorderConstructor = globalThis.MediaRecorder;
	if (typeof recorderConstructor !== 'function') {
		throw new Error('MediaRecorder is not available in this renderer.');
	}
	const supported = (mimeType: string) =>
		typeof recorderConstructor.isTypeSupported !== 'function' || recorderConstructor.isTypeSupported(mimeType);
	return {
		mediaDevices: globalThis.navigator.mediaDevices,
		isMimeTypeSupported: supported,
		createRecorder: (stream, mimeType) => {
			const browserStream = stream as unknown as MediaStream;
			const recorder = mimeType && supported(mimeType)
				? new recorderConstructor(browserStream, { mimeType })
				: new recorderConstructor(browserStream);
			return recorder as unknown as DictationMediaRecorder;
		},
		createMeter: createBrowserDictationMeter,
		now: () => Date.now(),
		schedule: (callback) => globalThis.requestAnimationFrame(callback),
		cancelSchedule: (handle) => globalThis.cancelAnimationFrame(handle),
	};
}

function createBrowserDictationMeter(stream: DictationMediaStream): DictationAudioMeter | undefined {
	const AudioContextConstructor = (globalThis as typeof globalThis & {
		webkitAudioContext?: typeof AudioContext;
	}).AudioContext ?? (globalThis as typeof globalThis & {
		webkitAudioContext?: typeof AudioContext;
	}).webkitAudioContext;
	if (AudioContextConstructor === undefined) return undefined;
	const context = new AudioContextConstructor();
	const source = context.createMediaStreamSource(stream as unknown as MediaStream);
	const analyser = context.createAnalyser();
	analyser.fftSize = 512;
	source.connect(analyser);
	const samples = new Uint8Array(analyser.fftSize);
	return {
		readLevel: () => {
			analyser.getByteTimeDomainData(samples);
			let sum = 0;
			for (const sample of samples) {
				const normalized = (sample - 128) / 128;
				sum += normalized * normalized;
			}
			return Math.min(1, Math.sqrt(sum / samples.length));
		},
		close: () => {
			source.disconnect();
			void context.close();
		},
	};
}

function clampLevel(value: number): number {
	return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function copyTarget(target: DictationTargetIdentity): DictationTargetIdentity {
	return Object.freeze({ ...target });
}
