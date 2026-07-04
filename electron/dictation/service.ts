import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import OpenAI from 'openai';

export const DEFAULT_DICTATION_MODEL = 'gpt-4o-transcribe';
export const MAX_DICTATION_UPLOAD_BYTES = 25 * 1024 * 1024;

const DEFAULT_AUDIO_FILE_NAME = 'dictation.webm';
const DATA_URL_BASE64_MARKER = ';base64,';

export type DictationApiKeyProvider = () =>
	| Promise<string | null | undefined>
	| string
	| null
	| undefined;

export type DictationTranscribeRequest = {
	audioBase64: string;
	fileName?: string;
	language?: string;
	mimeType: string;
	model?: string;
	prompt?: string;
};

export type DictationTranscribeResult = {
	model: string;
	text: string;
};

type DictationServiceOptions = {
	apiKeyProvider: DictationApiKeyProvider;
};

type UploadFileHandle = {
	cleanup: () => Promise<void>;
	file: File | ReturnType<typeof createReadStream>;
};

function trimOptional(value: string | null | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function getBase64Payload(audioBase64: string): string {
	const trimmed = audioBase64.trim();
	const markerIndex = trimmed.indexOf(DATA_URL_BASE64_MARKER);
	if (markerIndex === -1) {
		return trimmed;
	}

	return trimmed.slice(markerIndex + DATA_URL_BASE64_MARKER.length).trim();
}

function estimateBase64DecodedBytes(base64: string): number {
	const normalized = base64.replace(/\s/g, '');
	if (!normalized) {
		return 0;
	}

	const padding = normalized.endsWith('==')
		? 2
		: normalized.endsWith('=')
			? 1
			: 0;
	return Math.floor((normalized.length * 3) / 4) - padding;
}

function decodeAudioBase64(audioBase64: unknown): Buffer {
	if (typeof audioBase64 !== 'string') {
		throw new Error('Dictation audio must be base64 encoded.');
	}

	const payload = getBase64Payload(audioBase64);
	const estimatedBytes = estimateBase64DecodedBytes(payload);
	if (estimatedBytes === 0) {
		throw new Error('Dictation audio is empty.');
	}

	if (estimatedBytes > MAX_DICTATION_UPLOAD_BYTES) {
		throw new Error('Dictation audio exceeds the 25 MB upload limit.');
	}

	const audio = Buffer.from(payload, 'base64');
	if (audio.byteLength === 0) {
		throw new Error('Dictation audio is empty.');
	}

	if (audio.byteLength > MAX_DICTATION_UPLOAD_BYTES) {
		throw new Error('Dictation audio exceeds the 25 MB upload limit.');
	}

	return audio;
}

function getSafeFileName(
	fileName: string | undefined,
	mimeType: string,
): string {
	const trimmed = fileName?.trim();
	const fallbackExtension = getExtensionForMimeType(mimeType);
	if (!trimmed) {
		return `dictation.${fallbackExtension}`;
	}

	const baseName = path.basename(trimmed).replace(/[^\w.-]/g, '_');
	if (!baseName || baseName === '.' || baseName === '..') {
		return `dictation.${fallbackExtension}`;
	}

	return path.extname(baseName) ? baseName : `${baseName}.${fallbackExtension}`;
}

function getExtensionForMimeType(mimeType: string): string {
	const normalized = mimeType.toLowerCase().split(';', 1)[0]?.trim();
	switch (normalized) {
		case 'audio/m4a':
		case 'audio/x-m4a':
			return 'm4a';
		case 'audio/mp4':
		case 'video/mp4':
			return 'mp4';
		case 'audio/mpeg':
		case 'audio/mp3':
			return 'mp3';
		case 'audio/mpga':
			return 'mpga';
		case 'audio/wav':
		case 'audio/wave':
		case 'audio/x-wav':
			return 'wav';
		case 'audio/webm':
		case 'video/webm':
			return 'webm';
		default:
			return path.extname(DEFAULT_AUDIO_FILE_NAME).slice(1) || 'webm';
	}
}

async function createUploadFile(
	audio: Buffer,
	mimeType: string,
	fileName: string,
): Promise<UploadFileHandle> {
	if (typeof File === 'function') {
		return {
			cleanup: async () => {},
			file: new File([new Uint8Array(audio)], fileName, { type: mimeType }),
		};
	}

	const tempDir = await mkdtemp(path.join(os.tmpdir(), 'terminay-dictation-'));
	const tempPath = path.join(tempDir, fileName);
	await writeFile(tempPath, audio);

	return {
		cleanup: () => rm(tempDir, { force: true, recursive: true }),
		file: createReadStream(tempPath),
	};
}

function readTranscriptText(response: unknown): string {
	if (typeof response === 'string') {
		return response.trim();
	}

	if (typeof response === 'object' && response !== null && 'text' in response) {
		const text = (response as { text?: unknown }).text;
		if (typeof text === 'string') {
			return text.trim();
		}
	}

	return '';
}

export class DictationService {
	private readonly apiKeyProvider: DictationApiKeyProvider;

	constructor(options: DictationServiceOptions) {
		this.apiKeyProvider = options.apiKeyProvider;
	}

	async transcribe(
		request: DictationTranscribeRequest,
	): Promise<DictationTranscribeResult> {
		if (!request || typeof request !== 'object') {
			throw new Error('Dictation request is required.');
		}

		const mimeType = trimOptional(request.mimeType);
		if (!mimeType) {
			throw new Error('Dictation audio MIME type is required.');
		}

		const model = trimOptional(request.model) ?? DEFAULT_DICTATION_MODEL;
		const audio = decodeAudioBase64(request.audioBase64);
		const fileName = getSafeFileName(request.fileName, mimeType);

		const apiKey = trimOptional(await this.apiKeyProvider());
		if (!apiKey) {
			throw new Error('OpenAI API key is not configured.');
		}

		const uploadFile = await createUploadFile(audio, mimeType, fileName);

		try {
			const openai = new OpenAI({ apiKey });
			const transcription = await openai.audio.transcriptions.create({
				file: uploadFile.file,
				language: trimOptional(request.language),
				model,
				prompt: trimOptional(request.prompt),
				response_format: 'json',
			});
			const text = readTranscriptText(transcription);
			if (!text) {
				throw new Error('OpenAI returned an empty transcript.');
			}

			return { model, text };
		} finally {
			await uploadFile.cleanup();
		}
	}
}
