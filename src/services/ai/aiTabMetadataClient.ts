import type {
	AiTabMetadataModel,
	AiTabMetadataProvider,
} from '../../types/terminay';

/** Selected-server model discovery used by the settings surface. */
export interface AiTabMetadataClient {
	listModels: (
		provider: AiTabMetadataProvider,
	) => Promise<readonly AiTabMetadataModel[]>;
}
