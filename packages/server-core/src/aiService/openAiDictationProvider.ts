import {
	AiServiceError,
	type DictationProviderAdapter,
	type DictationProviderRequest,
} from './types.js';

/** Server-owned OpenAI transcription adapter. Credentials remain scoped to
 * the provider callback and are never represented in protocol JSON. */
export class OpenAiDictationProvider implements DictationProviderAdapter {
	async transcribe(
		request: DictationProviderRequest,
	): Promise<{ text: string }> {
		if (request.withCredential === undefined)
			throw new AiServiceError(
				'provider_unavailable',
				'provider credential is unavailable.',
				true,
			);
		return request.withCredential(async (secret) => {
			const key = new TextDecoder().decode(secret).trim();
			if (!key)
				throw new AiServiceError(
					'provider_unavailable',
					'provider credential is unavailable.',
					true,
				);
			const form = new FormData();
			form.set(
				'file',
				new Blob([request.audio.slice().buffer], { type: request.mimeType }),
				'dictation',
			);
			form.set('model', request.model);
			if (request.language) form.set('language', request.language);
			if (request.prompt) form.set('prompt', request.prompt);
			const response = await fetch(
				'https://api.openai.com/v1/audio/transcriptions',
				{
					method: 'POST',
					headers: { Authorization: `Bearer ${key}` },
					body: form,
					signal: request.signal,
				},
			);
			if (!response.ok)
				throw new AiServiceError(
					'provider_unavailable',
					'dictation provider failed.',
					response.status >= 500,
				);
			const value = (await response.json()) as { text?: unknown };
			if (typeof value.text !== 'string')
				throw new AiServiceError(
					'provider_unavailable',
					'dictation provider returned invalid output.',
				);
			return { text: value.text };
		});
	}
}
