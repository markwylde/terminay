import { parseDocument } from 'yaml';
import { CanonicalProjectPathResolver } from './pathResolver.js';
import type { FileCatalogStorage, FileDirectoryEntry } from './catalog.js';
import { FileServiceError } from './types.js';
import {
	DEFAULT_IGNORED_DIRECTORIES,
	shouldSkipDocumentationDirectory,
	validIgnorePattern,
} from './ignore.js';

export const DOCUMENTATION_CATALOG_LIMITS = Object.freeze({
	maxEntries: 25_000,
	maxFiles: 5_000,
	maxDepth: 64,
	maxInspectionBytes: 32 * 1024,
	maxResultBytes: 2 * 1024 * 1024,
	maxDurationMs: 8_000,
	maxTitleBytes: 512,
	maxDiagnosticBytes: 256,
	maxPageRecords: 10_000,
});

export type DocumentationExtension = 'md' | 'mdx';
export type DocumentationTitleSource = 'frontmatter' | 'filename';
export type DocumentationPartialReason =
	| 'entry_limit'
	| 'file_limit'
	| 'depth_limit'
	| 'result_limit'
	| 'duration_limit'
	| 'cancelled';
export type DocumentationObservationCapability = 'watching' | 'unavailable';

export interface DocumentationDocument {
	readonly kind: 'document';
	readonly relativePath: string;
	readonly extension: DocumentationExtension;
	readonly title: string;
	readonly titleSource: DocumentationTitleSource;
	readonly metadataDiagnostic?: string;
}

export interface DocumentationFolder {
	readonly kind: 'folder';
	readonly relativePath: string;
	readonly title: string;
}

export interface DocumentationCatalogResult {
	readonly revision: string;
	readonly folders: readonly DocumentationFolder[];
	readonly documents: readonly DocumentationDocument[];
	readonly scannedEntries: number;
	readonly scannedFiles: number;
	readonly partial: boolean;
	readonly partialReason?: DocumentationPartialReason;
	readonly nextCursor?: string;
	readonly observationCapability: DocumentationObservationCapability;
}

export interface DocumentationCatalogScanOptions {
	readonly signal?: AbortSignal;
	readonly cursor?: string;
	readonly knownRevision?: string;
}

export interface DocumentationCatalogOptions {
	readonly maxEntries?: number;
	readonly maxFiles?: number;
	readonly maxDepth?: number;
	readonly maxInspectionBytes?: number;
	readonly maxResultBytes?: number;
	readonly maxDurationMs?: number;
	readonly ignoredDirectories?: readonly string[];
	readonly observationCapability?: DocumentationObservationCapability;
	readonly now?: () => number;
}

const YAML_PARSE_OPTIONS = Object.freeze({
	prettyErrors: false,
	maxAliasCount: 0,
	uniqueKeys: true,
	merge: false,
	logLevel: 'silent' as const,
	schema: 'core' as const,
});

/** Bounded, server-owned Markdown/MDX discovery. Paths are re-authorized
 * through the canonical resolver before every directory or content read. */
export class DocumentationCatalog {
	private readonly maxEntries: number;
	private readonly maxFiles: number;
	private readonly maxDepth: number;
	private readonly maxInspectionBytes: number;
	private readonly maxResultBytes: number;
	private readonly maxDurationMs: number;
	private readonly ignoredDirectories: readonly string[];
	private readonly observationCapability: DocumentationObservationCapability;
	private readonly now: () => number;

	constructor(
		private readonly resolver: CanonicalProjectPathResolver,
		private readonly storage: FileCatalogStorage,
		options: DocumentationCatalogOptions = {},
	) {
		this.maxEntries = bounded(options.maxEntries, DOCUMENTATION_CATALOG_LIMITS.maxEntries);
		this.maxFiles = bounded(options.maxFiles, DOCUMENTATION_CATALOG_LIMITS.maxFiles);
		this.maxDepth = bounded(options.maxDepth, DOCUMENTATION_CATALOG_LIMITS.maxDepth);
		this.maxInspectionBytes = bounded(
			options.maxInspectionBytes,
			DOCUMENTATION_CATALOG_LIMITS.maxInspectionBytes,
		);
		this.maxResultBytes = bounded(
			options.maxResultBytes,
			DOCUMENTATION_CATALOG_LIMITS.maxResultBytes,
		);
		this.maxDurationMs = bounded(
			options.maxDurationMs,
			DOCUMENTATION_CATALOG_LIMITS.maxDurationMs,
		);
		this.ignoredDirectories = Object.freeze(
			(options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES).map(validIgnorePattern),
		);
		this.observationCapability = options.observationCapability ?? 'unavailable';
		this.now = options.now ?? Date.now;
	}

	async catalog(signalOrOptions?: AbortSignal | DocumentationCatalogScanOptions): Promise<DocumentationCatalogResult> {
		const options: DocumentationCatalogScanOptions =
			signalOrOptions instanceof AbortSignal || signalOrOptions === undefined
				? { signal: signalOrOptions }
				: signalOrOptions;
		const started = this.now();
		const root = await this.resolver.root();
		const documents: DocumentationDocument[] = [];
		const folders = new Set<string>();
		let scannedEntries = 0;
		let scannedFiles = 0;
		let partialReason: DocumentationPartialReason | undefined;
		let skipping = options.cursor !== undefined && options.cursor.length > 0;
		const deadline = started + this.maxDurationMs;

		const timedOut = (): boolean => this.now() >= deadline;
		const visit = async (relative: string, depth: number): Promise<void> => {
			throwIfAborted(options.signal);
			if (timedOut()) {
				partialReason ??= 'duration_limit';
				return;
			}
			if (depth > this.maxDepth) {
				partialReason ??= 'depth_limit';
				return;
			}
			let directory: string;
			try {
				directory = await this.resolver.resolve(relative || root, { requireDirectory: true });
			} catch (error) {
				if (isPathEscape(error)) return;
				throw error;
			}
			const entries = await this.storage.readDirectory(directory, options.signal);
			for (const entry of entries) {
				throwIfAborted(options.signal);
				if (timedOut()) {
					partialReason ??= 'duration_limit';
					return;
				}
				if (++scannedEntries > this.maxEntries) {
					partialReason ??= 'entry_limit';
					return;
				}
				if (!validName(entry)) continue;
				const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
				if (entry.isSymbolicLink) continue;
				if (entry.isDirectory) {
					if (!shouldSkipDocumentationDirectory(entry.name, this.ignoredDirectories))
						await visit(child, depth + 1);
					if (partialReason !== undefined) return;
					continue;
				}
				if (!entry.isFile) continue;
				const extensionValue = documentationExtension(child);
				if (extensionValue === undefined) continue;
				if (skipping) {
					if (child === options.cursor) skipping = false;
					continue;
				}
				if (++scannedFiles > this.maxFiles) {
					partialReason ??= 'file_limit';
					return;
				}
				let canonical: string;
				try {
					canonical = await this.resolver.resolve(child, { requireFile: true });
				} catch (error) {
					if (isPathEscape(error)) continue;
					throw error;
				}
				documents.push(await this.metadata(canonical, child, extensionValue, options.signal));
				for (const folder of parentFolders(child)) folders.add(folder);
			}
		};

		try {
			await visit('', 0);
		} catch (error) {
			if (isAbortError(error)) {
				partialReason ??= 'cancelled';
			} else {
				throw error;
			}
		}

		documents.sort(compareDocument);
		const orderedFolders = [...folders]
			.map((relativePath) => ({
				kind: 'folder' as const,
				relativePath,
				title: titleCase(relativePath.split('/').at(-1) ?? relativePath),
			}))
			.sort(compareFolder);

		let pageDocuments = documents;
		let pageFolders = orderedFolders;
		let nextCursor: string | undefined;
		const encode = (value: object): number =>
			new TextEncoder().encode(JSON.stringify(value)).byteLength;
		let resultShape = {
			folders: pageFolders,
			documents: pageDocuments,
		};
		if (
			pageDocuments.length + pageFolders.length > DOCUMENTATION_CATALOG_LIMITS.maxPageRecords ||
			encode(resultShape) > this.maxResultBytes
		) {
			partialReason ??= 'result_limit';
			while (pageDocuments.length > 1 && encode(resultShape) > this.maxResultBytes) {
				pageDocuments = pageDocuments.slice(0, Math.max(1, Math.floor(pageDocuments.length / 2)));
				const kept = new Set<string>();
				for (const document of pageDocuments)
					for (const folder of parentFolders(document.relativePath)) kept.add(folder);
				pageFolders = orderedFolders.filter((folder) => kept.has(folder.relativePath));
				resultShape = { folders: pageFolders, documents: pageDocuments };
			}
			nextCursor = pageDocuments.at(-1)?.relativePath;
		} else if (partialReason !== undefined) {
			nextCursor = documents.at(-1)?.relativePath;
		}

		const result: DocumentationCatalogResult = {
			revision: catalogRevision(scannedEntries, scannedFiles, documents),
			folders: pageFolders,
			documents: pageDocuments,
			scannedEntries,
			scannedFiles,
			partial: partialReason !== undefined,
			observationCapability: this.observationCapability,
			...(partialReason === undefined ? {} : { partialReason }),
			...(nextCursor === undefined ? {} : { nextCursor }),
		};
		return result;
	}

	private async metadata(
		canonical: string,
		relativePath: string,
		extensionValue: DocumentationExtension,
		signal?: AbortSignal,
	): Promise<DocumentationDocument> {
		const fallback = titleCase(relativePath.split('/').at(-1)!.replace(/\.mdx?$/iu, ''));
		if (this.storage.readRange === undefined) {
			return {
				kind: 'document',
				relativePath,
				extension: extensionValue,
				title: fallback,
				titleSource: 'filename',
				metadataDiagnostic: boundDiagnostic(
					'Document metadata is unavailable for this project environment.',
				),
			};
		}
		const bytes = await this.storage.readRange(canonical, 0, this.maxInspectionBytes, signal);
		const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
		const parsed = frontmatterTitle(text, bytes.byteLength === this.maxInspectionBytes);
		return {
			kind: 'document',
			relativePath,
			extension: extensionValue,
			title: parsed.title ?? fallback,
			titleSource: parsed.title === undefined ? 'filename' : 'frontmatter',
			...(parsed.diagnostic === undefined
				? {}
				: { metadataDiagnostic: boundDiagnostic(parsed.diagnostic) }),
		};
	}
}

export function titleCase(value: string): string {
	return value
		.replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
		.replace(/([a-z\d])([A-Z])/gu, '$1 $2')
		.replace(/[_\-.]+/gu, ' ')
		.trim()
		.split(/\s+/u)
		.filter(Boolean)
		.map((word) => word.slice(0, 1).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase())
		.join(' ');
}

export function frontmatterTitle(
	text: string,
	truncated: boolean,
): { title?: string; diagnostic?: string } {
	if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return {};
	const closingOffset = text.slice(4).search(/\r?\n---(?:\r?\n|$)/u);
	if (closingOffset < 0) {
		return {
			diagnostic: truncated
				? 'Frontmatter exceeds the metadata inspection limit.'
				: 'Frontmatter is not closed.',
		};
	}
	const raw = text.slice(4, closingOffset + 4);
	try {
		const document = parseDocument(raw, YAML_PARSE_OPTIONS);
		if (document.errors.length > 0) return { diagnostic: 'Frontmatter could not be parsed.' };
		if (document.warnings.some((warning) => /alias|anchor|merge/iu.test(warning.message)))
			return { diagnostic: 'Frontmatter aliases are not allowed.' };
		const value = document.get('title');
		if (value === undefined || value === null) return {};
		if (typeof value !== 'string')
			return { diagnostic: 'Frontmatter title must be a non-empty string.' };
		const title = value.trim();
		if (!title) return { diagnostic: 'Frontmatter title must be a non-empty string.' };
		if (new TextEncoder().encode(title).byteLength > DOCUMENTATION_CATALOG_LIMITS.maxTitleBytes) {
			return { diagnostic: 'Frontmatter title exceeds the display-title limit.' };
		}
		return { title };
	} catch {
		return { diagnostic: 'Frontmatter could not be parsed.' };
	}
}

function documentationExtension(path: string): DocumentationExtension | undefined {
	const match = /\.([Mm][Dd][Xx]?)$/u.exec(path);
	return match === null || match[1] === undefined
		? undefined
		: (match[1].toLowerCase() as DocumentationExtension);
}

function parentFolders(path: string): string[] {
	const parts = path.split('/');
	parts.pop();
	const folders: string[] = [];
	while (parts.length) {
		folders.push(parts.join('/'));
		parts.pop();
	}
	return folders;
}

function validName(entry: FileDirectoryEntry): boolean {
	return (
		typeof entry.name === 'string' &&
		entry.name.length > 0 &&
		!entry.name.includes('/') &&
		!entry.name.includes('\\') &&
		entry.name !== '.' &&
		entry.name !== '..'
	);
}

function bounded(value: number | undefined, fallback: number): number {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result < 1)
		throw new RangeError('documentation catalog limit must be a positive integer');
	return result;
}

function compareText(a: string, b: string): number {
	return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

function compareDocument(a: DocumentationDocument, b: DocumentationDocument): number {
	return compareText(a.title, b.title) || a.relativePath.localeCompare(b.relativePath);
}

function compareFolder(a: DocumentationFolder, b: DocumentationFolder): number {
	return compareText(a.title, b.title) || a.relativePath.localeCompare(b.relativePath);
}

function catalogRevision(
	scannedEntries: number,
	scannedFiles: number,
	documents: readonly DocumentationDocument[],
): string {
	let hash = 0x811c9dc5;
	const update = (value: string): void => {
		for (let index = 0; index < value.length; index += 1) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 0x01000193);
		}
	};
	for (const document of documents) {
		update(document.relativePath);
		update('\0');
		update(document.title);
		update('\0');
		update(document.titleSource);
		update('\0');
	}
	return `${scannedEntries}:${scannedFiles}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function boundDiagnostic(value: string): string {
	const bytes = new TextEncoder().encode(value);
	if (bytes.byteLength <= DOCUMENTATION_CATALOG_LIMITS.maxDiagnosticBytes) return value;
	return new TextDecoder().decode(bytes.slice(0, DOCUMENTATION_CATALOG_LIMITS.maxDiagnosticBytes));
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted)
		throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function isAbortError(error: unknown): boolean {
	return (
		(error instanceof DOMException && error.name === 'AbortError') ||
		(error instanceof Error && error.name === 'AbortError')
	);
}

function isPathEscape(error: unknown): boolean {
	return error instanceof FileServiceError && error.code === 'path_escape';
}
