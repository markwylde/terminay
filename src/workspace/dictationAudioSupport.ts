import { formatBracketedPaste } from '../terminalInput';

export type DictationAudioLevels = {
	durationMs: number;
	peakRms: number;
	rms: number;
};

export const DICTATION_WAVEFORM_BAR_COUNT = 18;
export const DICTATION_SILENCE_RMS_THRESHOLD = 0.008;
export const DICTATION_SPEECH_RMS_THRESHOLD = 0.014;
export const DICTATION_MIN_SPEECH_RMS = 0.012;
export const DICTATION_MIN_SPEECH_FRAMES = 4;
export const DICTATION_MIN_RECORDING_MS = 700;
export const DICTATION_INITIAL_SILENCE_GRACE_MS = 1000;
export const DICTATION_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
export const DICTATION_RECORDER_TIMESLICE_MS = 250;
export const DICTATION_SCRIPT_PROCESSOR_BUFFER_SIZE = 2048;
export const DICTATION_WAVEFORM_GAIN = 8.5;
export const DICTATION_MIME_TYPES = [
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/mp4',
	'audio/mpeg',
	'audio/wav',
];
export const EMPTY_DICTATION_WAVEFORM = Array.from(
	{ length: DICTATION_WAVEFORM_BAR_COUNT },
	() => 0.08,
);

export function getDictationMimeType(): string | undefined {
	if (typeof MediaRecorder === 'undefined') {
		return undefined;
	}

	return DICTATION_MIME_TYPES.find((mimeType) =>
		MediaRecorder.isTypeSupported(mimeType),
	);
}

export function getDictationFileExtension(mimeType: string): string {
	const normalized = mimeType.toLowerCase().split(';', 1)[0]?.trim();
	switch (normalized) {
		case 'audio/mp4':
			return 'mp4';
		case 'audio/mpeg':
			return 'mp3';
		case 'audio/wav':
			return 'wav';
		default:
			return 'webm';
	}
}

export function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () =>
			reject(reader.error ?? new Error('Unable to read dictation audio.'));
		reader.onload = () => {
			const result = reader.result;
			if (typeof result !== 'string') {
				reject(new Error('Unable to encode dictation audio.'));
				return;
			}

			const separatorIndex = result.indexOf(',');
			resolve(
				separatorIndex === -1 ? result : result.slice(separatorIndex + 1),
			);
		};
		reader.readAsDataURL(blob);
	});
}

export function encodeDictationWav(
	chunks: Float32Array[],
	sampleRate: number,
	totalLength: number,
): Blob {
	const dataLength = totalLength * 2;
	const buffer = new ArrayBuffer(44 + dataLength);
	const view = new DataView(buffer);
	let offset = 0;

	const writeString = (value: string) => {
		for (let index = 0; index < value.length; index += 1) {
			view.setUint8(offset, value.charCodeAt(index));
			offset += 1;
		}
	};

	writeString('RIFF');
	view.setUint32(offset, 36 + dataLength, true);
	offset += 4;
	writeString('WAVE');
	writeString('fmt ');
	view.setUint32(offset, 16, true);
	offset += 4;
	view.setUint16(offset, 1, true);
	offset += 2;
	view.setUint16(offset, 1, true);
	offset += 2;
	view.setUint32(offset, sampleRate, true);
	offset += 4;
	view.setUint32(offset, sampleRate * 2, true);
	offset += 4;
	view.setUint16(offset, 2, true);
	offset += 2;
	view.setUint16(offset, 16, true);
	offset += 2;
	writeString('data');
	view.setUint32(offset, dataLength, true);
	offset += 4;

	for (const chunk of chunks) {
		for (const sample of chunk) {
			const clamped = Math.max(-1, Math.min(1, sample));
			view.setInt16(
				offset,
				clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
				true,
			);
			offset += 2;
		}
	}

	return new Blob([buffer], { type: 'audio/wav' });
}

export async function measureDictationBlobAudio(
	blob: Blob,
): Promise<DictationAudioLevels | null> {
	if (typeof AudioContext === 'undefined') {
		return null;
	}

	const audioContext = new AudioContext();
	try {
		const audioBuffer = await audioContext.decodeAudioData(
			await blob.arrayBuffer(),
		);
		const channelCount = Math.max(1, audioBuffer.numberOfChannels);
		const frameCount = audioBuffer.length;
		if (frameCount === 0) {
			return null;
		}

		const windowSize = Math.max(256, Math.floor(audioBuffer.sampleRate / 24));
		let totalSquares = 0;
		let totalSamples = 0;
		let peakWindowRms = 0;

		for (let channel = 0; channel < channelCount; channel += 1) {
			const samples = audioBuffer.getChannelData(channel);
			for (let start = 0; start < samples.length; start += windowSize) {
				const end = Math.min(samples.length, start + windowSize);
				let windowSquares = 0;
				for (let index = start; index < end; index += 1) {
					const sample = samples[index] ?? 0;
					const square = sample * sample;
					windowSquares += square;
					totalSquares += square;
				}
				const windowLength = end - start;
				totalSamples += windowLength;
				if (windowLength > 0) {
					peakWindowRms = Math.max(
						peakWindowRms,
						Math.sqrt(windowSquares / windowLength),
					);
				}
			}
		}

		return {
			durationMs: Math.round(audioBuffer.duration * 1000),
			peakRms: peakWindowRms,
			rms: totalSamples > 0 ? Math.sqrt(totalSquares / totalSamples) : 0,
		};
	} catch (error) {
		console.warn('Unable to measure dictation recording audio levels', error);
		return null;
	} finally {
		void audioContext.close().catch(() => {});
	}
}

export function formatDictationTranscriptForTerminal(text: string): string {
	return /[\r\n]/.test(text) ? formatBracketedPaste(text) : text;
}
