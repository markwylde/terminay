import { parseDocument } from 'yaml';
import { CanonicalProjectPathResolver } from './pathResolver.js';
import type { FileCatalogStorage, FileDirectoryEntry } from './catalog.js';

export const DOCUMENTATION_CATALOG_LIMITS = Object.freeze({
	maxEntries: 25_000,
	maxFiles: 5_000,
	maxDepth: 64,
	maxInspectionBytes: 32 * 1024,
	maxResultBytes: 2 * 1024 * 1024,
});

export type DocumentationExtension = 'md' | 'mdx';
export interface DocumentationDocument {
	readonly kind: 'document';
	readonly relativePath: string;
	readonly extension: DocumentationExtension;
	readonly title: string;
	readonly titleSource: 'frontmatter' | 'filename';
	readonly metadataDiagnostic?: string;
}
export interface DocumentationFolder { readonly kind: 'folder'; readonly relativePath: string; readonly title: string; }
export interface DocumentationCatalogResult {
	readonly revision: string;
	readonly folders: readonly DocumentationFolder[];
	readonly documents: readonly DocumentationDocument[];
	readonly scannedEntries: number;
	readonly scannedFiles: number;
	readonly partial: boolean;
	readonly partialReason?: 'entry_limit' | 'file_limit' | 'depth_limit' | 'result_limit';
}

export interface DocumentationCatalogOptions {
	readonly maxEntries?: number;
	readonly maxFiles?: number;
	readonly maxDepth?: number;
	readonly maxInspectionBytes?: number;
	readonly ignoredDirectories?: readonly string[];
}

const DEFAULT_IGNORED = new Set(['.git', '.hg', '.svn', '.next', '.turbo', '.vite', 'coverage', 'dist', 'dist-electron', 'node_modules', 'release']);

/** Bounded, server-owned Markdown/MDX discovery.  Paths are re-authorized
 * through the canonical resolver before every directory or content read. */
export class DocumentationCatalog {
	private readonly maxEntries: number;
	private readonly maxFiles: number;
	private readonly maxDepth: number;
	private readonly maxInspectionBytes: number;
	private readonly ignoredDirectories: ReadonlySet<string>;

	constructor(private readonly resolver: CanonicalProjectPathResolver, private readonly storage: FileCatalogStorage, options: DocumentationCatalogOptions = {}) {
		this.maxEntries = bounded(options.maxEntries, DOCUMENTATION_CATALOG_LIMITS.maxEntries);
		this.maxFiles = bounded(options.maxFiles, DOCUMENTATION_CATALOG_LIMITS.maxFiles);
		this.maxDepth = bounded(options.maxDepth, DOCUMENTATION_CATALOG_LIMITS.maxDepth);
		this.maxInspectionBytes = bounded(options.maxInspectionBytes, DOCUMENTATION_CATALOG_LIMITS.maxInspectionBytes);
		this.ignoredDirectories = new Set([ ...DEFAULT_IGNORED, ...(options.ignoredDirectories ?? []) ]);
	}

	async catalog(signal?: AbortSignal): Promise<DocumentationCatalogResult> {
		const root = await this.resolver.root();
		const documents: DocumentationDocument[] = [];
		const folders = new Set<string>();
		let scannedEntries = 0;
		let scannedFiles = 0;
		let partialReason: DocumentationCatalogResult['partialReason'];
		const visit = async (relative: string, depth: number): Promise<void> => {
			throwIfAborted(signal);
			if (depth > this.maxDepth) { partialReason ??= 'depth_limit'; return; }
			const directory = await this.resolver.resolve(relative || root, { requireDirectory: true });
			const entries = await this.storage.readDirectory(directory, signal);
			for (const entry of entries) {
				throwIfAborted(signal);
				if (++scannedEntries > this.maxEntries) { partialReason ??= 'entry_limit'; return; }
				if (!validName(entry)) continue;
				const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
				if (entry.isSymbolicLink) continue;
				if (entry.isDirectory) {
					if (!this.ignoredDirectories.has(entry.name) && !entry.name.startsWith('.')) await visit(child, depth + 1);
					continue;
				}
				if (!entry.isFile || !extension(child)) continue;
				if (++scannedFiles > this.maxFiles) { partialReason ??= 'file_limit'; return; }
				const canonical = await this.resolver.resolve(child, { requireFile: true });
				const metadata = await this.metadata(canonical, child, signal);
				documents.push(metadata);
				for (const folder of parentFolders(child)) folders.add(folder);
			}
		};
		await visit('', 0);
		documents.sort(compareRecord);
		const orderedFolders = [...folders].map((relativePath) => ({ kind: 'folder' as const, relativePath, title: relativePath.split('/').at(-1) ?? relativePath })).sort((a, b) => compareText(a.title, b.title) || a.relativePath.localeCompare(b.relativePath));
		const result: DocumentationCatalogResult = { revision: `${scannedEntries}:${scannedFiles}:${documents.map((item) => item.relativePath + item.title).join('|')}`, folders: orderedFolders, documents, scannedEntries, scannedFiles, partial: partialReason !== undefined, ...(partialReason === undefined ? {} : { partialReason }) };
		const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
		if (bytes > DOCUMENTATION_CATALOG_LIMITS.maxResultBytes) return { ...result, documents: documents.slice(0, Math.max(1, Math.floor(documents.length / 2))), partial: true, partialReason: 'result_limit' };
		return result;
	}

	private async metadata(canonical: string, relativePath: string, signal?: AbortSignal): Promise<DocumentationDocument> {
		const fallback = titleCase(relativePath.split('/').at(-1)!.replace(/\.mdx?$/iu, ''));
		const extensionValue = extension(relativePath)!;
		if (this.storage.readRange === undefined) return { kind: 'document', relativePath, extension: extensionValue, title: fallback, titleSource: 'filename', metadataDiagnostic: 'Document metadata is unavailable for this project environment.' };
		const bytes = await this.storage.readRange(canonical, 0, this.maxInspectionBytes, signal);
		const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
		const parsed = frontmatterTitle(text, bytes.byteLength === this.maxInspectionBytes);
		return { kind: 'document', relativePath, extension: extensionValue, title: parsed.title ?? fallback, titleSource: parsed.title === undefined ? 'filename' : 'frontmatter', ...(parsed.diagnostic === undefined ? {} : { metadataDiagnostic: parsed.diagnostic }) };
	}
}

export function titleCase(value: string): string {
	return value.replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2').replace(/([a-z\d])([A-Z])/gu, '$1 $2').replace(/[_\-.]+/gu, ' ').trim().split(/\s+/u).filter(Boolean).map((word) => word.length <= 4 && /^[A-Z\d]+$/u.test(word) ? word : word.slice(0, 1).toLocaleUpperCase() + word.slice(1)).join(' ');
}
function frontmatterTitle(text: string, truncated: boolean): { title?: string; diagnostic?: string } {
	if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return {};
	const closingOffset = text.slice(4).search(/\r?\n---(?:\r?\n|$)/u);
	if (closingOffset < 0) return { diagnostic: truncated ? 'Frontmatter exceeds the metadata inspection limit.' : 'Frontmatter is not closed.' };
	try {
		const document = parseDocument(text.slice(4, closingOffset + 4), { prettyErrors: false });
		if (document.errors.length > 0) return { diagnostic: 'Frontmatter could not be parsed.' };
		const value = document.get('title');
		return typeof value === 'string' && value.trim() ? { title: value.trim() } : value === undefined ? {} : { diagnostic: 'Frontmatter title must be a non-empty string.' };
	} catch { return { diagnostic: 'Frontmatter could not be parsed.' }; }
}
function extension(path: string): DocumentationExtension | undefined { const match = /\.([Mm][Dd][Xx]?)$/u.exec(path); return match === null || match[1] === undefined ? undefined : match[1].toLowerCase() as DocumentationExtension; }
function parentFolders(path: string): string[] { const parts = path.split('/'); parts.pop(); const folders: string[] = []; while (parts.length) { folders.push(parts.join('/')); parts.pop(); } return folders; }
function validName(entry: FileDirectoryEntry): boolean { return typeof entry.name === 'string' && entry.name.length > 0 && !entry.name.includes('/') && !entry.name.includes('\\') && entry.name !== '.' && entry.name !== '..'; }
function bounded(value: number | undefined, fallback: number): number { const result = value ?? fallback; if (!Number.isSafeInteger(result) || result < 1) throw new RangeError('documentation catalog limit must be a positive integer'); return result; }
function compareText(a: string, b: string): number { return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }); }
function compareRecord(a: DocumentationDocument, b: DocumentationDocument): number { return compareText(a.title, b.title) || a.relativePath.localeCompare(b.relativePath); }
function throwIfAborted(signal?: AbortSignal): void { if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError'); }
