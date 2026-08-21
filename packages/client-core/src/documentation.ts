import type { JsonValue } from '@terminay/protocol';
import type { QueryOptions } from './types.js';
import type { BinaryQueryTransport } from './queryCommand.js';

export const DOCUMENTATION_OPERATIONS = Object.freeze({ catalog: 'docs.catalog' } as const);
export type DocumentationExtension = 'md' | 'mdx';
export interface DocumentationFolder { readonly kind: 'folder'; readonly relativePath: string; readonly title: string; }
export interface DocumentationDocument { readonly kind: 'document'; readonly relativePath: string; readonly extension: DocumentationExtension; readonly title: string; readonly titleSource: 'frontmatter' | 'filename'; readonly metadataDiagnostic?: string; }
export interface DocumentationCatalog { readonly revision: string; readonly scannedEntries: number; readonly scannedFiles: number; readonly partial: boolean; readonly partialReason?: string; readonly folders: readonly DocumentationFolder[]; readonly documents: readonly DocumentationDocument[]; }

/** Validates the bounded binary Documentation catalog returned by the server. */
export class DocumentationClient {
	constructor(private readonly transport: BinaryQueryTransport) {}
	async catalog(projectId: string, knownRevision?: string, options: QueryOptions = {}): Promise<DocumentationCatalog> {
		const response = await this.transport.queryWithBody<JsonValue>(DOCUMENTATION_OPERATIONS.catalog, { projectId, ...(knownRevision === undefined ? {} : { knownRevision }) }, options);
		const metadata = record(response.result, 'documentation catalog metadata');
		const body = record(JSON.parse(new TextDecoder().decode(response.body)), 'documentation catalog body');
		const folders = array(body.folders, 'folders').map(folder);
		const documents = array(body.documents, 'documents').map(document);
		return Object.freeze({ revision: text(metadata.revision, 'revision'), scannedEntries: count(metadata.scannedEntries, 'scannedEntries'), scannedFiles: count(metadata.scannedFiles, 'scannedFiles'), partial: bool(metadata.partial, 'partial'), ...(metadata.partialReason === undefined ? {} : { partialReason: text(metadata.partialReason, 'partialReason') }), folders: Object.freeze(folders), documents: Object.freeze(documents) });
	}
}
function document(value: unknown): DocumentationDocument { const item = record(value, 'document'); const extension = text(item.extension, 'extension'); if (extension !== 'md' && extension !== 'mdx') throw new TypeError('documentation extension is invalid'); const titleSource = text(item.titleSource, 'titleSource'); if (titleSource !== 'frontmatter' && titleSource !== 'filename') throw new TypeError('documentation title source is invalid'); return Object.freeze({ kind: 'document', relativePath: path(item.relativePath), extension, title: text(item.title, 'title'), titleSource, ...(item.metadataDiagnostic === undefined ? {} : { metadataDiagnostic: text(item.metadataDiagnostic, 'metadataDiagnostic') }) }); }
function folder(value: unknown): DocumentationFolder { const item = record(value, 'folder'); return Object.freeze({ kind: 'folder', relativePath: path(item.relativePath), title: text(item.title, 'title') }); }
function record(value: unknown, name: string): Record<string, unknown> { if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError(`${name} is invalid`); return value as Record<string, unknown>; }
function array(value: unknown, name: string): readonly unknown[] { if (!Array.isArray(value) || value.length > 10_000) throw new TypeError(`${name} are invalid`); return value; }
function text(value: unknown, name: string): string { if (typeof value !== 'string' || value.length > 4096) throw new TypeError(`${name} is invalid`); return value; }
function path(value: unknown): string { const result = text(value, 'relativePath'); if (!result || result.startsWith('/') || result.split('/').some((part) => !part || part === '.' || part === '..')) throw new TypeError('documentation path is invalid'); return result; }
function count(value: unknown, name: string): number { if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${name} is invalid`); return value as number; }
function bool(value: unknown, name: string): boolean { if (typeof value !== 'boolean') throw new TypeError(`${name} is invalid`); return value; }
