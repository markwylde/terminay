import type {
	AiTabMetadataGenerateRequest,
	AiTabMetadataGenerateResult,
	AiTabMetadataModel,
	AiTabMetadataProvider,
} from '../../types/terminay'

export interface AiTabMetadataClient {
	generate: (
		request: AiTabMetadataGenerateRequest,
	) => Promise<AiTabMetadataGenerateResult>
	listModels: (provider: AiTabMetadataProvider) => Promise<readonly AiTabMetadataModel[]>
}

export type LegacyAiTabMetadataApi = Readonly<{
	generateAiTabMetadata: (request: AiTabMetadataGenerateRequest) => Promise<AiTabMetadataGenerateResult>
	listAiTabMetadataModels: (provider: AiTabMetadataProvider) => Promise<AiTabMetadataModel[]>
}>

/**
 * Capture the only host operation the transitional AI-metadata client may
 * use. This deliberately avoids retaining the preload object passed by the
 * named Desktop compatibility caller.
 */
export function captureLegacyAiTabMetadataCapability(
	api: LegacyAiTabMetadataApi,
): LegacyAiTabMetadataApi {
	const { generateAiTabMetadata, listAiTabMetadataModels } = api
	if (
		typeof generateAiTabMetadata !== 'function' ||
		typeof listAiTabMetadataModels !== 'function'
	) {
		throw new TypeError('legacy AI metadata capability is unavailable')
	}
	return Object.freeze({
		generateAiTabMetadata: (request) => generateAiTabMetadata(request),
		listAiTabMetadataModels: (provider) => listAiTabMetadataModels(provider),
	})
}

/**
 * Compatibility transport for the old Desktop-only metadata IPC method.
 * Production feature code uses the canonical server client; this is the only
 * place that translates the legacy request shape during migration.
 */
export function createLegacyAiTabMetadataClient(
	api: LegacyAiTabMetadataApi,
): AiTabMetadataClient {
	const capability = captureLegacyAiTabMetadataCapability(api)
	return {
		generate: async (request) => {
			// This adapter preserves only the old request/response transport. It must
			// not invent a server, project, panel, or terminal identity to emulate the
			// canonical client: those placeholders could look authoritative in a
			// compatibility path.
			const result = await capability.generateAiTabMetadata(request)
			if (typeof result?.text !== 'string') {
				throw new TypeError('legacy AI metadata response is invalid')
			}
			return { text: result.text }
		},
		listModels: async (provider) => {
			const models = await capability.listAiTabMetadataModels(provider)
			if (!Array.isArray(models) || models.length > 1_000) {
				throw new TypeError('legacy AI model response is invalid')
			}
			return Object.freeze(models.map((model) => {
				if (
					typeof model !== 'object' || model === null ||
					typeof model.id !== 'string' || model.id.length === 0 || model.id.length > 512 ||
					typeof model.label !== 'string' || model.label.length === 0 || model.label.length > 512
				) {
					throw new TypeError('legacy AI model response is invalid')
				}
				return Object.freeze({ id: model.id, label: model.label })
			}))
		},
	}
}
