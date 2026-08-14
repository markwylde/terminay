import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DictationProviderAdapter, DictationProviderRequest } from './types.js';
import { AiServiceError } from './types.js';

export const SERVER_PARAKEET_MODEL = 'mlx-community/parakeet-tdt-0.6b-v3';

export interface ServerParakeetRuntime {
	readonly transcribe: (audioPath: string) => Promise<string>;
	readonly getStatus?: () => Promise<unknown>;
	readonly install?: () => Promise<unknown>;
	readonly stop?: () => void;
}
export interface ServerParakeetRuntimeStatus {
	readonly state: 'unsupported' | 'not-installed' | 'installing' | 'ready' | 'error';
	readonly model: typeof SERVER_PARAKEET_MODEL;
	readonly message?: string;
	readonly progress?: number;
	readonly engine?: { readonly package: string; readonly version: string; readonly license: string };
	readonly modelRevision?: string;
	readonly modelLicense?: string;
	readonly audioFormat?: string;
}

/**
 * Selected-server Parakeet adapter. The protocol supplies bounded bytes; only
 * this server-owned adapter creates a private input file and passes its path to
 * the fixed runtime. Neither path nor runtime controls cross the protocol.
 */
export class ServerParakeetDictationProvider implements DictationProviderAdapter {
	constructor(
		private readonly runtime: ServerParakeetRuntime,
		private readonly temporaryRoot: string = os.tmpdir(),
	) {}

	async transcribe(request: DictationProviderRequest): Promise<string> {
		if (request.model !== SERVER_PARAKEET_MODEL) {
			throw new AiServiceError('invalid_request', 'The Parakeet model is not the pinned server model.');
		}
		if (request.signal.aborted) {
			throw new AiServiceError('provider_cancelled', 'Parakeet transcription was cancelled.', true);
		}
		await mkdir(this.temporaryRoot, { recursive: true, mode: 0o700 });
		const directory = await mkdtemp(path.join(this.temporaryRoot, 'terminay-parakeet-input-'));
		const inputPath = path.join(directory, `capture.${extensionForMime(request.mimeType)}`);
		try {
			await writeFile(inputPath, request.audio, { mode: 0o600 });
			const text = await this.runtime.transcribe(inputPath);
			if (request.signal.aborted) {
				throw new AiServiceError('provider_cancelled', 'Parakeet transcription was cancelled.', true);
			}
			return text;
		} finally {
			await rm(directory, { force: true, recursive: true });
		}
	}

	async status(): Promise<ServerParakeetRuntimeStatus> {
		if (this.runtime.getStatus === undefined) throw new AiServiceError('provider_unavailable', 'Parakeet runtime status is unavailable.', true);
		return normalizeStatus(await this.runtime.getStatus());
	}

	async install(): Promise<ServerParakeetRuntimeStatus> {
		if (this.runtime.install === undefined) throw new AiServiceError('provider_unavailable', 'Parakeet runtime installation is unavailable.', true);
		return normalizeStatus(await this.runtime.install());
	}

	stop(): void { this.runtime.stop?.(); }
}

function normalizeStatus(input: unknown): ServerParakeetRuntimeStatus {
	if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new AiServiceError('provider_unavailable', 'Parakeet runtime returned invalid status.', true);
	const value = input as Record<string, unknown>;
	if (!['unsupported', 'not-installed', 'installing', 'ready', 'error'].includes(String(value.state)) || value.model !== SERVER_PARAKEET_MODEL) throw new AiServiceError('provider_unavailable', 'Parakeet runtime returned invalid status.', true);
	const message = typeof value.message === 'string' && value.message.length <= 512 && !value.message.includes('\0') ? value.message : undefined;
	const progress = typeof value.progress === 'number' && Number.isFinite(value.progress) && value.progress >= 0 && value.progress <= 1 ? value.progress : undefined;
	const engineValue = typeof value.engine === 'object' && value.engine !== null && !Array.isArray(value.engine) ? value.engine as Record<string, unknown> : undefined;
	const engine = engineValue && ['package', 'version', 'license'].every((key) => typeof engineValue[key] === 'string' && (engineValue[key] as string).length <= 64) ? { package: engineValue.package as string, version: engineValue.version as string, license: engineValue.license as string } : undefined;
	const safe = (field: unknown, max = 128) => typeof field === 'string' && field.length > 0 && field.length <= max && !/[\0\r\n/\\]/u.test(field) ? field : undefined;
	const modelRevision = safe(value.modelRevision);
	const modelLicense = safe(value.modelLicense);
	const audioFormat = safe(value.audioFormat);
	return { state: value.state as ServerParakeetRuntimeStatus['state'], model: SERVER_PARAKEET_MODEL, ...(message === undefined ? {} : { message }), ...(progress === undefined ? {} : { progress }), ...(engine === undefined ? {} : { engine }), ...(modelRevision === undefined ? {} : { modelRevision }), ...(modelLicense === undefined ? {} : { modelLicense }), ...(audioFormat === undefined ? {} : { audioFormat }) };
}

function extensionForMime(mimeType: string): string {
	const normalized = mimeType.toLowerCase().split(';', 1)[0]?.trim();
	return ({ 'audio/wav': 'wav', 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3' } as Record<string, string>)[normalized ?? ''] ?? 'audio';
}
