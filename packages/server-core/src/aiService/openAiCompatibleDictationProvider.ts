import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import {
	AiServiceError,
	type DictationProviderAdapter,
	type DictationProviderRequest,
} from './types.js';

export function transcriptionEndpoint(value: string | undefined): URL {
	try {
		if (!value || value.length > 2048) throw new Error();
		const url = new URL(value);
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		)
			throw new Error();
		return url;
	} catch {
		throw new AiServiceError(
			'invalid_request',
			'Enter a full HTTP(S) transcription URL without credentials, query parameters or a fragment.',
		);
	}
}

/** Custom-provider transport. No redirect handling or shared TLS state. */
export class OpenAiCompatibleDictationProvider
	implements DictationProviderAdapter
{
	async transcribe(
		request: DictationProviderRequest,
	): Promise<{ text: string }> {
		const endpoint = transcriptionEndpoint(request.endpointUrl);
		const send = async (secret?: Uint8Array): Promise<{ text: string }> => {
			const key =
				secret === undefined ? '' : new TextDecoder().decode(secret).trim();
			const form = new FormData();
			const extension =
				(
					{
						'audio/wav': 'wav',
						'audio/webm': 'webm',
						'audio/ogg': 'ogg',
						'audio/mp4': 'mp4',
						'audio/mpeg': 'mp3',
					} as Record<string, string>
				)[request.mimeType] ?? 'audio';
			form.set(
				'file',
				new Blob([request.audio.slice().buffer], { type: request.mimeType }),
				`dictation.${extension}`,
			);
			form.set('model', request.model);
			form.set('response_format', 'json');
			if (request.language) form.set('language', request.language);
			if (request.prompt) form.set('prompt', request.prompt);
			const encoded = new Request(endpoint, { method: 'POST', body: form });
			const body = Buffer.from(await encoded.arrayBuffer());
			request.signal.throwIfAborted();
			return new Promise((resolve, reject) => {
				const fail = () =>
					reject(
						new AiServiceError(
							'provider_unavailable',
							'Custom transcription request failed. Check the endpoint, API key and TLS verification setting.',
							true,
						),
					);
				const transport =
					endpoint.protocol === 'https:' ? httpsRequest : httpRequest;
				const req = transport(
					endpoint,
					{
						method: 'POST',
						agent: false,
						rejectUnauthorized: request.bypassTlsVerification !== true,
						signal: request.signal,
						headers: {
							'content-type': encoded.headers.get('content-type')!,
							'content-length': body.byteLength,
							...(key ? { authorization: `Bearer ${key}` } : {}),
						},
					},
					(response) => {
						if (response.statusCode !== 200) {
							response.destroy();
							fail();
							return;
						}
						const chunks: Buffer[] = [];
						let bytes = 0;
						response.on('error', fail);
						response.on('data', (chunk: Buffer) => {
							bytes += chunk.byteLength;
							if (bytes > request.maxOutputBytes) {
								reject(
									new AiServiceError(
										'audio_output_too_large',
										'Custom transcription output exceeds the limit.',
									),
								);
								response.destroy();
								req.destroy();
								return;
							}
							chunks.push(chunk);
						});
						response.on('end', () => {
							try {
								const value: unknown = JSON.parse(
									Buffer.concat(chunks).toString('utf8'),
								);
								if (
									!value ||
									typeof value !== 'object' ||
									!('text' in value) ||
									typeof value.text !== 'string'
								) {
									fail();
									return;
								}
								resolve({ text: value.text });
							} catch {
								fail();
							}
						});
					},
				);
				req.on('error', fail);
				req.end(body);
			});
		};
		return request.withCredential === undefined
			? send()
			: request.withCredential(send);
	}
}
