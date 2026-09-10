import {
	LANGUAGE_CAPABILITY,
	LANGUAGE_OPERATIONS,
	type LanguageCapabilitiesDto,
	type LanguageCompletionResultDto,
	type LanguageDefinitionResultDto,
	type LanguageDiagnosticsEventDto,
	type LanguageDocumentChangeRequest,
	type LanguageDocumentOpenRequest,
	type LanguageDocumentRef,
	type LanguageHoverResultDto,
	type LanguagePositionRequest,
	parseLanguageCapabilitiesDto,
	parseLanguageCompletionResultDto,
	parseLanguageDefinitionResultDto,
	parseLanguageDiagnosticsEventDto,
	parseLanguageHoverResultDto,
} from "@terminay/protocol";
import type { QueryOptions } from "./types.js";
import type { QueryCommandTransport } from "./queryCommand.js";

export { LANGUAGE_CAPABILITY, LANGUAGE_OPERATIONS };

export interface LanguageTransport extends QueryCommandTransport {
	subscribeEvents(event: string, listener: (payload: unknown) => void, onResync?: () => void): Promise<() => void>;
}

/** Project-scoped client facade for server-hosted language intelligence.
 * The UI sees bounded DTOs only; the Language Server Protocol stays on the
 * server. Every query carries the document revision it was made against so
 * the caller can drop stale results. */
export class LanguageClient {
	constructor(private readonly transport: LanguageTransport) {}

	async capabilities(ref: Pick<LanguageDocumentRef, "projectId" | "path">, options: QueryOptions = {}): Promise<LanguageCapabilitiesDto> {
		return parseLanguageCapabilitiesDto(
			await this.transport.query(LANGUAGE_OPERATIONS.capabilities, { projectId: ref.projectId, path: ref.path }, options),
		);
	}

	async openDocument(request: LanguageDocumentOpenRequest): Promise<void> {
		await this.transport.command(LANGUAGE_OPERATIONS.documentOpen, { ...request });
	}

	async changeDocument(request: LanguageDocumentChangeRequest): Promise<void> {
		await this.transport.command(LANGUAGE_OPERATIONS.documentChange, { ...request });
	}

	async closeDocument(ref: LanguageDocumentRef): Promise<void> {
		await this.transport.command(LANGUAGE_OPERATIONS.documentClose, { projectId: ref.projectId, path: ref.path, revision: ref.revision });
	}

	async completion(request: LanguagePositionRequest, options: QueryOptions = {}): Promise<LanguageCompletionResultDto> {
		return parseLanguageCompletionResultDto(
			await this.transport.query(LANGUAGE_OPERATIONS.completion, positionPayload(request), options),
		);
	}

	async hover(request: LanguagePositionRequest, options: QueryOptions = {}): Promise<LanguageHoverResultDto> {
		return parseLanguageHoverResultDto(
			await this.transport.query(LANGUAGE_OPERATIONS.hover, positionPayload(request), options),
		);
	}

	async definition(request: LanguagePositionRequest, options: QueryOptions = {}): Promise<LanguageDefinitionResultDto> {
		return parseLanguageDefinitionResultDto(
			await this.transport.query(LANGUAGE_OPERATIONS.definition, positionPayload(request), options),
		);
	}

	/** Subscribes to diagnostics for every file of every project on this
	 * connection; the listener filters by project and path. */
	async subscribeDiagnostics(listener: (event: LanguageDiagnosticsEventDto) => void, onResync?: () => void): Promise<() => void> {
		return this.transport.subscribeEvents(
			LANGUAGE_OPERATIONS.diagnosticsEvent,
			(payload) => {
				let event: LanguageDiagnosticsEventDto;
				try {
					event = parseLanguageDiagnosticsEventDto(payload);
				} catch {
					return;
				}
				listener(event);
			},
			onResync,
		);
	}
}

function positionPayload(request: LanguagePositionRequest) {
	return {
		projectId: request.projectId,
		path: request.path,
		revision: request.revision,
		position: { line: request.position.line, character: request.position.character },
	};
}
