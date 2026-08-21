import { scopeAllows } from '../auth.js';
import type { AuthScope, JsonValue } from '@terminay/protocol';
import type { BinaryQueryHandlerResult, QueryHandler, QueryRequest } from '../types.js';
import { FileServiceError } from './types.js';
import { DocumentationCatalog } from './documentationCatalog.js';

export const DOCUMENTATION_OPERATIONS = Object.freeze({ catalog: 'docs.catalog' } as const);
export interface DocumentationProjectContext { readonly projectId: string; readonly catalog: DocumentationCatalog; }
export interface DocumentationCatalogAdapterOptions { readonly serverId: string; readonly projects: ReadonlyMap<string, DocumentationProjectContext>; readonly authorizeProject?: (context: DocumentationAuthorization, projectId: string) => boolean; }
export interface DocumentationAuthorization { readonly serverId: string; readonly projectId?: string; readonly clientId?: string; readonly scope: AuthScope; }

export class ServerDocumentationCatalogAdapter {
	constructor(private readonly options: DocumentationCatalogAdapterOptions) {}
	operations(): { readonly queries: Readonly<Record<string, QueryHandler>> } { return { queries: { [DOCUMENTATION_OPERATIONS.catalog]: (request) => this.catalogRequest(request) } }; }
	private async catalogRequest(request: QueryRequest): Promise<BinaryQueryHandlerResult> {
		const payload = object(request.envelope.payload);
		const projectId = typeof payload.projectId === 'string' ? payload.projectId : claimProject(request.context.claims);
		if (projectId === undefined) throw new FileServiceError('path_escape', 'documentation project identity is missing');
		const authorization: DocumentationAuthorization = { serverId: this.options.serverId, clientId: request.context.clientId, scope: request.context.authScope, ...(claimProject(request.context.claims) === undefined ? {} : { projectId: claimProject(request.context.claims) }) };
		if (!scopeAllows(authorization.scope, 'read') || (authorization.projectId !== undefined && authorization.projectId !== projectId) || this.options.authorizeProject?.(authorization, projectId) === false) throw new FileServiceError('path_escape', 'documentation is outside the authorized project');
		const project = this.options.projects.get(projectId);
		if (project === undefined || project.projectId !== projectId) throw new FileServiceError('path_escape', 'project is not authorized');
		const result = await project.catalog.catalog(request.context.signal);
		const body = new TextEncoder().encode(JSON.stringify({ folders: result.folders, documents: result.documents }));
		return { result: { contentType: 'application/json', bodyLength: body.byteLength, revision: result.revision, scannedEntries: result.scannedEntries, scannedFiles: result.scannedFiles, partial: result.partial, ...(result.partialReason === undefined ? {} : { partialReason: result.partialReason }) } as JsonValue, body };
	}
}
function object(value: unknown): Record<string, unknown> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('documentation payload is invalid'); return value as Record<string, unknown>; }
function claimProject(claims: unknown): string | undefined { return typeof claims === 'object' && claims !== null && typeof (claims as Record<string, unknown>).projectId === 'string' ? (claims as Record<string, string>).projectId : undefined; }
