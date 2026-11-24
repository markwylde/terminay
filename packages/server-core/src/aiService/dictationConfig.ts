import type { JsonValue } from '@terminay/protocol';
import type { ServerVaultService } from '../settings/vault.js';
import { OpenAiCompatibleDictationProvider } from './openAiCompatibleDictationProvider.js';
import { OpenAiDictationProvider } from './openAiDictationProvider.js';
import {
	AiServiceError,
	type DictationProviderAdapter,
	type DictationProviderRequest,
	type DictationSettings,
} from './types.js';

export function serverDictationSettings(
	settings: Readonly<Record<string, JsonValue>> | undefined,
): DictationSettings {
	const value = settings?.dictation;
	const d =
		typeof value === 'object' && value !== null && !Array.isArray(value)
			? value
			: {};
	const provider =
		d.provider === 'openai' ||
		d.provider === 'parakeet' ||
		d.provider === 'openai-compatible'
			? d.provider
			: 'disabled';
	return {
		enabled: d.enabled !== false,
		provider,
		model:
			provider === 'openai-compatible'
				? typeof d.customModel === 'string'
					? d.customModel.trim()
					: ''
				: provider === 'parakeet'
					? 'mlx-community/parakeet-tdt-0.6b-v3'
					: typeof d.model === 'string'
						? d.model
						: 'gpt-4o-transcribe',
		endpointUrl: typeof d.endpointUrl === 'string' ? d.endpointUrl.trim() : '',
		bypassTlsVerification: d.bypassTlsVerification === true,
		language: typeof d.language === 'string' ? d.language : '',
		prompt: typeof d.prompt === 'string' ? d.prompt : '',
	};
}

export class ServerDictationProvider implements DictationProviderAdapter {
	private readonly openai = new OpenAiDictationProvider();
	private readonly custom = new OpenAiCompatibleDictationProvider();
	constructor(private readonly parakeet?: DictationProviderAdapter) {}
	transcribe(request: DictationProviderRequest) {
		if (request.provider === 'openai-compatible')
			return this.custom.transcribe(request);
		if (request.provider === 'parakeet') {
			if (this.parakeet === undefined)
				throw new AiServiceError(
					'provider_unavailable',
					'Parakeet is unavailable on this server.',
				);
			return this.parakeet.transcribe(request);
		}
		return this.openai.transcribe(request);
	}
}

/** Explicit selectors keep a pending key mutation independent of Settings. */
export function createDictationCredentials(
	vault: Pick<
		ServerVaultService,
		'status' | 'withSecret' | 'put' | 'replace' | 'remove'
	>,
) {
	const reference = (provider = 'openai') => {
		if (provider !== 'openai' && provider !== 'openai-compatible')
			throw new AiServiceError(
				'invalid_request',
				'Invalid dictation credential provider.',
			);
		return {
			id:
				provider === 'openai'
					? 'dictation-openai-api-key'
					: 'dictation-custom-api-key',
			label:
				provider === 'openai' ? 'OpenAI API key' : 'OpenAI-compatible API key',
		};
	};
	const configured = (id: string) =>
		vault.status().entries.some((entry) => entry.id === id);
	return {
		status(provider?: string) {
			return { configured: configured(reference(provider).id) };
		},
		async set(value: Uint8Array, provider?: string) {
			const ref = reference(provider);
			await (configured(ref.id)
				? vault.replace({ ...ref, value })
				: vault.put({ ...ref, value }));
			return { configured: true };
		},
		async clear(provider?: string) {
			await vault.remove(reference(provider).id);
			return { configured: false };
		},
		async withCredential<T>(
			provider: string,
			callback: (secret: Uint8Array) => T | Promise<T>,
		): Promise<T> {
			const ref = reference(provider);
			if (provider === 'openai-compatible' && !configured(ref.id)) {
				if (vault.status().state !== 'unlocked')
					throw new AiServiceError(
						'provider_unavailable',
						'Dictation vault is unavailable.',
					);
				return callback(new Uint8Array());
			}
			let callbackFailed = false;
			try {
				return await vault.withSecret(ref.id, async (secret) => {
					try {
						return await callback(secret);
					} catch (error) {
						callbackFailed = true;
						throw error;
					}
				});
			} catch (error) {
				if (callbackFailed) throw error;
				throw new AiServiceError(
					'provider_unavailable',
					'Dictation credential is unavailable.',
				);
			}
		},
	};
}
