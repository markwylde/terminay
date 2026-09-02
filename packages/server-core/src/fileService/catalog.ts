import { CanonicalProjectPathResolver } from './pathResolver.js';
import {
	aggregateMarkdownTasks,
	type MarkdownTaskAggregationOptions,
	type MarkdownTaskAggregationResult,
} from './tasks.js';
import {
	type CanonicalPathAdapter,
	FileServiceError,
	type MaybePromise,
	type PathStat,
} from './types.js';
import {
	DEFAULT_IGNORED_DIRECTORIES,
	isIgnoredDirectoryName,
	validIgnorePattern,
} from './ignore.js';


export interface FileDirectoryEntry {
	readonly name: string;
	readonly isDirectory?: boolean;
	readonly isFile?: boolean;
	readonly isSymbolicLink?: boolean;
	readonly size?: number;
	readonly mtimeMs?: number;
	readonly mode?: number;
}

export interface FileCatalogStorage extends CanonicalPathAdapter {
	readonly readDirectory: (
		path: string,
		signal?: AbortSignal,
	) => MaybePromise<readonly FileDirectoryEntry[]>;
	/** Optional bounded prefix read used for deterministic content sniffing. */
	readonly readRange?: (
		path: string,
		offset: number,
		length: number,
		signal?: AbortSignal,
	) => MaybePromise<Uint8Array>;
	readonly makeDirectory?: (
		path: string,
		signal?: AbortSignal,
	) => MaybePromise<void>;
	readonly rename?: (
		from: string,
		to: string,
		signal?: AbortSignal,
	) => MaybePromise<void>;
	readonly remove?: (
		path: string,
		options?: { readonly recursive?: boolean },
		signal?: AbortSignal,
	) => MaybePromise<void>;
	readonly atomicWrite?: (
		path: string,
		bytes: Uint8Array,
		signal?: AbortSignal,
	) => MaybePromise<void>;
}

export interface FileCatalogOptions {
	readonly maxEntries?: number;
	readonly maxDepth?: number;
	readonly maxSearchResults?: number;
	readonly maxSearchQueryLength?: number;
	readonly maxWriteBytes?: number;
	/** Maximum prefix inspected when classifying a file for preview. */
	readonly maxPreviewInspectionBytes?: number;
	/** Files above this threshold use an incremental/fallback viewer path. */
	readonly maxPreviewBytes?: number;
	readonly ignoredDirectories?: readonly string[];
}

export type FileCatalogEntryKind = 'file' | 'directory' | 'symlink' | 'other';

export interface FileCatalogEntry {
	readonly name: string;
	/** Project-relative; the project root is represented as `.`. */
	readonly relativePath: string;
	readonly kind: FileCatalogEntryKind;
	readonly isSymbolicLink: boolean;
	/** False for a symlink whose target is outside the authorized project. */
	readonly accessible: boolean;
	readonly size: number;
	readonly mtimeMs?: number;
	readonly mode?: number;
}

export interface FileCatalogListOptions {
	readonly offset?: number;
	readonly limit?: number;
	readonly includeIgnored?: boolean;
	readonly signal?: AbortSignal;
}

export interface FileCatalogPage {
	readonly root: string;
	readonly offset: number;
	readonly entries: readonly FileCatalogEntry[];
	readonly nextOffset?: number;
	readonly truncated: boolean;
}

export interface FileCatalogSearchOptions {
	readonly limit?: number;
	readonly maxEntries?: number;
	readonly maxDepth?: number;
	readonly includeDirectories?: boolean;
	readonly ignoredDirectories?: readonly string[];
	readonly signal?: AbortSignal;
}

export interface FileCatalogSearchResult extends FileCatalogEntry {
	readonly score: number;
}

export interface FileCatalogSearchPage {
	readonly root: string;
	readonly query: string;
	readonly results: readonly FileCatalogSearchResult[];
	readonly scannedEntries: number;
	readonly truncated: boolean;
}

export interface FileCatalogSizeOptions {
	readonly maxEntries?: number;
	readonly maxDepth?: number;
	readonly maxBytes?: number;
	readonly ignoredDirectories?: readonly string[];
	readonly signal?: AbortSignal;
}

export interface FileCatalogSizeResult {
	readonly root: string;
	readonly bytes: number;
	readonly entries: number;
	readonly truncated: boolean;
}

export type FileCatalogPreviewKind =
	| 'markdown'
	| 'image'
	| 'pdf'
	| 'text'
	| 'hex'
	| 'unsupported';
export type FileCatalogPreviewMode = 'preview' | 'text' | 'hex';

/** Server-authorized, content-free capabilities for a file viewer. */
export interface FileCatalogPreviewMetadata {
	readonly relativePath: string;
	readonly size: number;
	readonly mtimeMs?: number;
	readonly mode?: number;
	readonly mimeType?: string;
	readonly previewKind: FileCatalogPreviewKind;
	readonly preferredMode: FileCatalogPreviewMode;
	readonly isBinary: boolean;
	readonly isLargeFile: boolean;
	readonly safePreview: boolean;
	readonly canEditText: boolean;
	readonly canEditHex: boolean;
	readonly inspectedBytes: number;
	readonly inspectionTruncated: boolean;
}

export interface FileCatalogPreviewOptions {
	readonly signal?: AbortSignal;
}

const DEFAULT_MAX_ENTRIES = 25_000;
const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_SEARCH_RESULTS = 200;
const DEFAULT_MAX_QUERY_LENGTH = 256;
const DEFAULT_MAX_WRITE_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_PREVIEW_INSPECTION_BYTES = 8 * 1024;
const DEFAULT_MAX_PREVIEW_BYTES = 8 * 1024 * 1024;
const LARGE_FILE_BYTES = 100 * 1024 * 1024;

/**
 * Bounded, project-relative directory/search/size operations. The adapter is
 * supplied by the server host; every child is canonicalized again before its
 * metadata is returned, so a stale listing cannot grant access through a
 * symlink or rename race.
 */
export class FileCatalog {
	readonly resolver: CanonicalProjectPathResolver;
	readonly storage: FileCatalogStorage;
	readonly maxEntries: number;
	readonly maxDepth: number;
	readonly maxSearchResults: number;
	readonly maxSearchQueryLength: number;
	readonly maxWriteBytes: number;
	readonly maxPreviewInspectionBytes: number;
	readonly maxPreviewBytes: number;
	readonly ignoredDirectories: readonly string[];

	constructor(
		resolver: CanonicalProjectPathResolver,
		storage: FileCatalogStorage,
		options: FileCatalogOptions = {},
	) {
		if (typeof storage.readDirectory !== 'function')
			throw new TypeError('file catalog storage must provide readDirectory');
		this.resolver = resolver;
		this.storage = storage;
		this.maxEntries = positive(
			options.maxEntries ?? DEFAULT_MAX_ENTRIES,
			'maxEntries',
		);
		this.maxDepth = positive(options.maxDepth ?? DEFAULT_MAX_DEPTH, 'maxDepth');
		this.maxSearchResults = positive(
			options.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS,
			'maxSearchResults',
		);
		this.maxSearchQueryLength = positive(
			options.maxSearchQueryLength ?? DEFAULT_MAX_QUERY_LENGTH,
			'maxSearchQueryLength',
		);
		this.maxWriteBytes = positive(
			options.maxWriteBytes ?? DEFAULT_MAX_WRITE_BYTES,
			'maxWriteBytes',
		);
		this.maxPreviewInspectionBytes = positive(
			options.maxPreviewInspectionBytes ?? DEFAULT_MAX_PREVIEW_INSPECTION_BYTES,
			'maxPreviewInspectionBytes',
		);
		this.maxPreviewBytes = positive(
			options.maxPreviewBytes ?? DEFAULT_MAX_PREVIEW_BYTES,
			'maxPreviewBytes',
		);
		this.ignoredDirectories = Object.freeze(
			(options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES).map(
				(pattern) => validIgnorePattern(pattern),
			),
		);
	}

	async list(
		requestedPath = '.',
		options: FileCatalogListOptions = {},
	): Promise<FileCatalogPage> {
		throwIfAborted(options.signal);
		const root = normalizeRelative(requestedPath);
		const canonical = await this.resolver.resolve(root || '.', {
			requireDirectory: true,
		});
		const offset = boundedOffset(options.offset ?? 0, 'offset');
		const limit = boundedLimit(
			options.limit ?? Math.min(256, this.maxEntries),
			this.maxEntries,
			'limit',
		);
		let rawEntries: readonly FileDirectoryEntry[];
		try {
			rawEntries = await this.storage.readDirectory(canonical, options.signal);
		} catch (error) {
			throw directoryReadFailure(error);
		}
		const entries: FileCatalogEntry[] = [];
		for (const raw of rawEntries) {
			throwIfAborted(options.signal);
			const name = validEntryName(raw.name);
			const relativePath = root.length === 0 ? name : `${root}/${name}`;
			if (!options.includeIgnored && this.isIgnored(name, relativePath, []))
				continue;
			const entry =
				listingMetadataEntry(relativePath, raw) ??
				(await this.describe(relativePath, raw, options.signal));
			if (entry !== undefined) entries.push(entry);
		}
		entries.sort(compareEntries);
		const page = entries.slice(offset, offset + limit);
		const nextOffset =
			offset + page.length < entries.length ? offset + page.length : undefined;
		return Object.freeze({
			root: root || '.',
			offset,
			entries: Object.freeze(page),
			...(nextOffset === undefined ? {} : { nextOffset }),
			truncated: nextOffset !== undefined,
		});
	}

	async search(
		requestedPath: string,
		query: string,
		options: FileCatalogSearchOptions = {},
	): Promise<FileCatalogSearchPage> {
		throwIfAborted(options.signal);
		const root = normalizeRelative(requestedPath);
		await this.resolver.resolve(root || '.', { requireDirectory: true });
		const normalizedQuery = normalizeQuery(query, this.maxSearchQueryLength);
		if (normalizedQuery.length === 0)
			return Object.freeze({
				root: root || '.',
				query: normalizedQuery,
				results: Object.freeze([]),
				scannedEntries: 0,
				truncated: false,
			});
		const limit = boundedLimit(
			options.limit ?? this.maxSearchResults,
			Math.min(this.maxSearchResults, DEFAULT_MAX_SEARCH_RESULTS),
			'limit',
		);
		const maxEntries = boundedLimit(
			options.maxEntries ?? this.maxEntries,
			this.maxEntries,
			'maxEntries',
		);
		const maxDepth = boundedLimit(
			options.maxDepth ?? this.maxDepth,
			this.maxDepth,
			'maxDepth',
		);
		const ignored = (options.ignoredDirectories ?? this.ignoredDirectories).map(
			(pattern) => validIgnorePattern(pattern),
		);
		const includeDirectories = options.includeDirectories ?? true;
		const results: FileCatalogSearchResult[] = [];
		const pending: Array<{
			readonly relativePath: string;
			readonly depth: number;
		}> = [{ relativePath: root, depth: 0 }];
		const queryTokens = normalizedQuery
			.toLocaleLowerCase()
			.split(/\s+/u)
			.filter(Boolean);
		let scannedEntries = 0;
		let truncated = false;
		while (pending.length > 0) {
			throwIfAborted(options.signal);
			const current = pending.shift();
			if (current === undefined) break;
			const canonical = await this.resolver.resolve(
				current.relativePath || '.',
				{ requireDirectory: true },
			);
			let directoryEntries: readonly FileDirectoryEntry[];
			try {
				directoryEntries = await this.storage.readDirectory(
					canonical,
					options.signal,
				);
			} catch {
				continue;
			}
			for (const raw of directoryEntries) {
				throwIfAborted(options.signal);
				scannedEntries += 1;
				if (scannedEntries > maxEntries) {
					truncated = true;
					break;
				}
				const name = validEntryName(raw.name);
				if (isIgnoredDirectoryName(name, ignored)) continue;
				const relativePath =
					current.relativePath.length === 0
						? name
						: `${current.relativePath}/${name}`;
				const entry = await this.describe(relativePath, raw, options.signal);
				if (entry === undefined || !entry.accessible) continue;
				const score = scorePath(relativePath, queryTokens);
				if (score > 0 && (entry.kind !== 'directory' || includeDirectories))
					results.push(Object.freeze({ ...entry, score }));
				if (
					entry.kind === 'directory' &&
					!entry.isSymbolicLink &&
					current.depth < maxDepth
				)
					pending.push({ relativePath, depth: current.depth + 1 });
			}
			if (truncated) break;
		}
		results.sort(
			(left, right) =>
				right.score - left.score ||
				compareNames(left.relativePath, right.relativePath),
		);
		return Object.freeze({
			root: root || '.',
			query: normalizedQuery,
			results: Object.freeze(results.slice(0, limit)),
			scannedEntries,
			truncated: truncated || results.length > limit,
		});
	}

	async size(
		requestedPath: string,
		options: FileCatalogSizeOptions = {},
	): Promise<FileCatalogSizeResult> {
		throwIfAborted(options.signal);
		const root = normalizeRelative(requestedPath);
		const canonical = await this.resolver.resolve(root || '.');
		const rootStat = await this.storage.stat(canonical);
		if (rootStat.isFile === true)
			return Object.freeze({
				root: root || '.',
				bytes: safeSize(rootStat.size),
				entries: 1,
				truncated: false,
			});
		if (rootStat.isDirectory !== true)
			return Object.freeze({
				root: root || '.',
				bytes: safeSize(rootStat.size),
				entries: 1,
				truncated: false,
			});
		const maxEntries = boundedLimit(
			options.maxEntries ?? this.maxEntries,
			this.maxEntries,
			'maxEntries',
		);
		const maxDepth = boundedLimit(
			options.maxDepth ?? this.maxDepth,
			this.maxDepth,
			'maxDepth',
		);
		const maxBytes = boundedSize(
			options.maxBytes ?? Number.MAX_SAFE_INTEGER,
			'maxBytes',
		);
		const ignored = (options.ignoredDirectories ?? this.ignoredDirectories).map(
			(pattern) => validIgnorePattern(pattern),
		);
		const pending: Array<{
			readonly relativePath: string;
			readonly depth: number;
		}> = [{ relativePath: root, depth: 0 }];
		let bytes = 0;
		let entries = 0;
		let truncated = false;
		while (pending.length > 0) {
			throwIfAborted(options.signal);
			const current = pending.pop();
			if (current === undefined) break;
			const currentCanonical = await this.resolver.resolve(
				current.relativePath || '.',
				{ requireDirectory: true },
			);
			let children: readonly FileDirectoryEntry[];
			try {
				children = await this.storage.readDirectory(
					currentCanonical,
					options.signal,
				);
			} catch {
				continue;
			}
			for (const raw of children) {
				throwIfAborted(options.signal);
				entries += 1;
				if (entries > maxEntries) {
					truncated = true;
					break;
				}
				const name = validEntryName(raw.name);
				if (isIgnoredDirectoryName(name, ignored) || raw.isSymbolicLink === true)
					continue;
				const relativePath =
					current.relativePath.length === 0
						? name
						: `${current.relativePath}/${name}`;
				const entry = await this.describe(relativePath, raw, options.signal);
				if (entry === undefined || !entry.accessible) continue;
				if (entry.kind === 'directory') {
					if (current.depth < maxDepth)
						pending.push({ relativePath, depth: current.depth + 1 });
					else truncated = true;
				} else {
					bytes += entry.size;
					if (bytes > maxBytes) {
						bytes = maxBytes;
						truncated = true;
						break;
					}
				}
			}
			if (truncated) break;
		}
		return Object.freeze({
			root: root || '.',
			bytes,
			entries: Math.min(entries, maxEntries),
			truncated,
		});
	}

	/** Aggregate bounded Markdown checkbox tasks within this project scope. */
	async aggregateMarkdownTasks(
		requestedPath = '.',
		options: MarkdownTaskAggregationOptions = {},
	): Promise<MarkdownTaskAggregationResult> {
		return aggregateMarkdownTasks(
			this.resolver,
			this.storage,
			requestedPath,
			options,
		);
	}

	/**
	 * Classify a file for the viewer using only a bounded prefix and canonical
	 * server-side metadata. The response is intentionally content-free: clients
	 * use the file-session range contract after this capability decision.
	 */
	async previewMetadata(
		requestedPath: string,
		options: FileCatalogPreviewOptions = {},
	): Promise<FileCatalogPreviewMetadata> {
		throwIfAborted(options.signal);
		const relativePath = normalizeRelative(requestedPath);
		const canonical = await this.resolver.resolve(relativePath, {
			requireFile: true,
		});
		const stat = await this.storage.stat(canonical);
		if (stat.isFile === false)
			throw new FileServiceError('not_file', 'preview target is not a file', {
				requested: requestedPath,
			});
		const size = safeSize(stat.size);
		const sampleLength = Math.min(size, this.maxPreviewInspectionBytes);
		let sample = new Uint8Array();
		if (sampleLength > 0 && this.storage.readRange !== undefined) {
			const read = await this.storage.readRange(
				canonical,
				0,
				sampleLength,
				options.signal,
			);
			throwIfAborted(options.signal);
			if (!(read instanceof Uint8Array))
				throw new FileServiceError(
					'write_failed',
					'preview inspection returned invalid bytes',
				);
			sample =
				read.byteLength > sampleLength
					? read.slice(0, sampleLength)
					: new Uint8Array(read);
		}
		const classification = classifyPreview(
			relativePath,
			sample,
			this.maxPreviewBytes,
			size,
		);
		const isLargeFile = size > LARGE_FILE_BYTES;
		const safePreview = classification.safePreview && !isLargeFile;
		const preferredMode: FileCatalogPreviewMode =
			classification.previewKind === 'unsupported'
				? 'hex'
				: safePreview
					? 'preview'
					: classification.isBinary
						? 'hex'
						: 'text';
		return Object.freeze({
			relativePath: relativePath || '.',
			size,
			...(finite(stat.mtimeMs) ? { mtimeMs: stat.mtimeMs } : {}),
			...(safeMode(stat.mode) === undefined
				? {}
				: { mode: safeMode(stat.mode) }),
			...(classification.mimeType === undefined
				? {}
				: { mimeType: classification.mimeType }),
			previewKind:
				classification.previewKind === 'unsupported'
					? 'unsupported'
					: safePreview
						? classification.previewKind
						: classification.isBinary
							? 'hex'
							: 'text',
			preferredMode,
			isBinary: classification.isBinary,
			isLargeFile,
			safePreview,
			canEditText: !classification.isBinary,
			// HEX is a bounded ranged editor for every regular file, including a
			// text/preview file when a user explicitly switches modes.
			canEditHex: true,
			inspectedBytes: sample.byteLength,
			inspectionTruncated: size > sample.byteLength,
		});
	}

	async createFile(
		requestedPath: string,
		bytes = new Uint8Array(),
		signal?: AbortSignal,
	): Promise<void> {
		throwIfAborted(signal);
		if (this.storage.atomicWrite === undefined)
			throw new FileServiceError(
				'write_failed',
				'file storage cannot create files',
			);
		if (!(bytes instanceof Uint8Array) || bytes.byteLength > this.maxWriteBytes)
			throw new FileServiceError(
				'draft_too_large',
				'created file exceeds the configured limit',
				{ max: this.maxWriteBytes },
			);
		const relativePath = normalizeRelative(requestedPath);
		await this.ensureMissing(relativePath, signal);
		await this.requireParent(relativePath, signal);
		await this.storage.atomicWrite(
			await this.resolver.resolve(relativePath, { allowMissing: true }),
			new Uint8Array(bytes),
			signal,
		);
	}

	async createDirectory(
		requestedPath: string,
		signal?: AbortSignal,
	): Promise<void> {
		throwIfAborted(signal);
		if (this.storage.makeDirectory === undefined)
			throw new FileServiceError(
				'write_failed',
				'file storage cannot create directories',
			);
		const relativePath = normalizeRelative(requestedPath);
		await this.ensureMissing(relativePath, signal);
		await this.requireParent(relativePath, signal);
		await this.storage.makeDirectory(
			await this.resolver.resolve(relativePath, { allowMissing: true }),
			signal,
		);
	}

	async rename(
		fromPath: string,
		toPath: string,
		signal?: AbortSignal,
	): Promise<void> {
		throwIfAborted(signal);
		if (this.storage.rename === undefined)
			throw new FileServiceError(
				'write_failed',
				'file storage cannot rename entries',
			);
		const from = normalizeRelative(fromPath);
		const to = normalizeRelative(toPath);
		if (from.length === 0 || to.length === 0)
			throw new FileServiceError(
				'path_escape',
				'project root cannot be renamed',
			);
		await this.assertNotSymlink(from, signal);
		const source = await this.resolver.resolve(from);
		await this.ensureMissing(to, signal);
		await this.requireParent(to, signal);
		await this.storage.rename(
			source,
			await this.resolver.resolve(to, { allowMissing: true }),
			signal,
		);
	}

	async delete(
		requestedPath: string,
		options: {
			readonly recursive?: boolean;
			readonly signal?: AbortSignal;
		} = {},
	): Promise<void> {
		throwIfAborted(options.signal);
		if (this.storage.remove === undefined)
			throw new FileServiceError(
				'write_failed',
				'file storage cannot delete entries',
			);
		const relativePath = normalizeRelative(requestedPath);
		if (relativePath.length === 0)
			throw new FileServiceError(
				'path_escape',
				'project root cannot be deleted',
			);
		await this.assertNotSymlink(relativePath, options.signal);
		await this.storage.remove(
			await this.resolver.resolve(relativePath),
			{ recursive: options.recursive === true },
			options.signal,
		);
	}

	private async ensureMissing(
		relativePath: string,
		signal?: AbortSignal,
	): Promise<void> {
		try {
			await this.resolver.resolve(relativePath, {
				requireFile: false,
				requireDirectory: false,
			});
			throw new FileServiceError('write_failed', 'destination already exists');
		} catch (error) {
			if (!(error instanceof FileServiceError) || error.code !== 'path_missing')
				throw error;
		}
		throwIfAborted(signal);
	}

	private async requireParent(
		relativePath: string,
		signal?: AbortSignal,
	): Promise<void> {
		const separator = relativePath.lastIndexOf('/');
		const parent = separator < 0 ? '.' : relativePath.slice(0, separator);
		await this.resolver.resolve(parent, { requireDirectory: true });
		throwIfAborted(signal);
	}

	private async describe(
		relativePath: string,
		raw: FileDirectoryEntry,
		signal?: AbortSignal,
	): Promise<FileCatalogEntry | undefined> {
		throwIfAborted(signal);
		const symbolic =
			raw.isSymbolicLink === true ||
			(this.storage.lstat !== undefined &&
				(await this.isSymlink(relativePath, signal)));
		try {
			const canonical = await this.resolver.resolve(relativePath);
			const stat = await this.storage.stat(canonical);
			const kind = symbolic ? 'symlink' : classify(stat, raw);
			return Object.freeze({
				name: raw.name,
				relativePath,
				kind,
				isSymbolicLink: symbolic,
				accessible: true,
				size: safeSize(stat.size),
				...(finite(stat.mtimeMs) ? { mtimeMs: stat.mtimeMs } : {}),
				...(safeMode(stat.mode) === undefined
					? {}
					: { mode: safeMode(stat.mode) }),
			});
		} catch (error) {
			if (
				symbolic &&
				error instanceof FileServiceError &&
				error.code === 'path_escape'
			)
				return Object.freeze({
					name: raw.name,
					relativePath,
					kind: 'symlink',
					isSymbolicLink: true,
					accessible: false,
					size: 0,
				});
			if (error instanceof FileServiceError && error.code === 'path_missing')
				return undefined;
			throw directoryReadFailure(error);
		}
	}

	private async isSymlink(
		relativePath: string,
		signal?: AbortSignal,
	): Promise<boolean> {
		throwIfAborted(signal);
		try {
			return (
				(await this.storage.lstat!(await this.lexicalPath(relativePath)))
					.isSymbolicLink === true
			);
		} catch {
			return false;
		}
	}

	private async assertNotSymlink(
		relativePath: string,
		signal?: AbortSignal,
	): Promise<void> {
		if (this.storage.lstat === undefined) return;
		throwIfAborted(signal);
		try {
			if (
				(await this.storage.lstat(await this.lexicalPath(relativePath)))
					.isSymbolicLink === true
			)
				throw new FileServiceError(
					'path_escape',
					'symlink mutations are not permitted',
					{ requested: relativePath },
				);
		} catch (error) {
			if (error instanceof FileServiceError) throw error;
			throw error;
		}
	}

	private async lexicalPath(relativePath: string): Promise<string> {
		const root = await this.resolver.root();
		const separator = root.includes('\\') ? '\\' : '/';
		return `${root.replace(/[\\/]$/u, '')}${separator}${relativePath.split('/').join(separator)}`;
	}

	private isIgnored(
		name: string,
		relativePath: string,
		extra: readonly string[],
	): boolean {
		return (
			isIgnoredDirectoryName(name, [...extra, ...this.ignoredDirectories]) ||
			relativePath
				.split('/')
				.some((part) => isIgnoredDirectoryName(part, this.ignoredDirectories))
		);
	}
}

function classify(
	stat: PathStat,
	raw: FileDirectoryEntry,
): FileCatalogEntryKind {
	if (stat.isDirectory === true || raw.isDirectory === true) return 'directory';
	if (stat.isFile === true || raw.isFile === true) return 'file';
	return 'other';
}

function listingMetadataEntry(
	relativePath: string,
	raw: FileDirectoryEntry,
): FileCatalogEntry | undefined {
	if (raw.isSymbolicLink === true) return undefined;
	if (raw.isDirectory !== true && raw.isFile !== true) return undefined;
	if (typeof raw.size !== 'number' || !Number.isFinite(raw.size))
		return undefined;
	return Object.freeze({
		name: raw.name,
		relativePath,
		kind: raw.isDirectory === true ? 'directory' : 'file',
		isSymbolicLink: false,
		accessible: true,
		size: safeSize(raw.size),
		...(finite(raw.mtimeMs) ? { mtimeMs: raw.mtimeMs } : {}),
		...(safeMode(raw.mode) === undefined ? {} : { mode: safeMode(raw.mode) }),
	});
}

interface PreviewClassification {
	readonly previewKind: FileCatalogPreviewKind;
	readonly mimeType?: string;
	readonly isBinary: boolean;
	readonly safePreview: boolean;
}

function classifyPreview(
	relativePath: string,
	sample: Uint8Array,
	maxPreviewBytes: number,
	size: number,
): PreviewClassification {
	const extension = extensionOf(relativePath);
	const mimeType = mimeTypeFor(extension, sample);
	const image = mimeType?.startsWith('image/') === true;
	const pdf = mimeType === 'application/pdf';
	const markdown =
		extension === 'md' ||
		extension === 'markdown' ||
		extension === 'mdown' ||
		extension === 'mkd' ||
		extension === 'mdx';
	const utf8 = decodeUtf8(sample);
	const hasNul = sample.includes(0);
	const knownText =
		mimeType?.startsWith('text/') === true ||
		mimeType === 'application/json' ||
		mimeType === 'application/toml';
	const unknownText = mimeType === undefined && utf8 !== false && !hasNul;
	const uninspectedUnknown =
		size > 0 &&
		sample.byteLength === 0 &&
		!knownText &&
		!markdown &&
		mimeType === undefined;
	const isBinary =
		image || pdf || hasNul || utf8 === false || uninspectedUnknown;
	const previewKind: FileCatalogPreviewKind = image
		? 'image'
		: pdf
			? 'pdf'
			: isBinary
				? 'hex'
				: markdown
					? 'markdown'
					: unknownText
						? 'unsupported'
						: 'text';
	const safePreview =
		size <= maxPreviewBytes &&
		(previewKind === 'markdown' ||
			previewKind === 'image' ||
			previewKind === 'pdf' ||
			previewKind === 'text');
	return {
		previewKind,
		...(mimeType === undefined ? {} : { mimeType }),
		isBinary,
		safePreview,
	};
}

function extensionOf(relativePath: string): string {
	const name = relativePath
		.slice(relativePath.lastIndexOf('/') + 1)
		.toLocaleLowerCase();
	const dot = name.lastIndexOf('.');
	return dot <= 0 ? '' : name.slice(dot + 1);
}

function mimeTypeFor(
	extension: string,
	sample: Uint8Array,
): string | undefined {
	if (startsWithAscii(sample, '%PDF-')) return 'application/pdf';
	if (
		sample.length >= 8 &&
		sample[0] === 0x89 &&
		sample[1] === 0x50 &&
		sample[2] === 0x4e &&
		sample[3] === 0x47 &&
		sample[4] === 0x0d &&
		sample[5] === 0x0a &&
		sample[6] === 0x1a &&
		sample[7] === 0x0a
	)
		return 'image/png';
	if (
		sample.length >= 3 &&
		sample[0] === 0xff &&
		sample[1] === 0xd8 &&
		sample[2] === 0xff
	)
		return 'image/jpeg';
	if (
		sample.length >= 6 &&
		(startsWithAscii(sample, 'GIF87a') || startsWithAscii(sample, 'GIF89a'))
	)
		return 'image/gif';
	if (
		sample.length >= 12 &&
		startsWithAscii(sample, 'RIFF') &&
		startsWithAscii(sample.subarray(8), 'WEBP')
	)
		return 'image/webp';
	const known: Record<string, string> = {
		md: 'text/markdown',
		markdown: 'text/markdown',
		mdown: 'text/markdown',
		mkd: 'text/markdown',
		mdx: 'text/markdown',
		txt: 'text/plain',
		text: 'text/plain',
		json: 'application/json',
		js: 'text/javascript',
		jsx: 'text/javascript',
		ts: 'text/typescript',
		tsx: 'text/typescript',
		mjs: 'text/javascript',
		c: 'text/plain',
		cc: 'text/plain',
		cpp: 'text/plain',
		h: 'text/plain',
		py: 'text/plain',
		rb: 'text/plain',
		rs: 'text/plain',
		sh: 'text/plain',
		sql: 'text/plain',
		log: 'text/plain',
		css: 'text/css',
		html: 'text/html',
		htm: 'text/html',
		xml: 'text/xml',
		yaml: 'text/yaml',
		yml: 'text/yaml',
		toml: 'application/toml',
		png: 'image/png',
		apng: 'image/apng',
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		gif: 'image/gif',
		webp: 'image/webp',
		avif: 'image/avif',
		bmp: 'image/bmp',
		ico: 'image/x-icon',
		tif: 'image/tiff',
		tiff: 'image/tiff',
		svg: 'image/svg+xml',
		pdf: 'application/pdf',
	};
	return known[extension];
}

function startsWithAscii(bytes: Uint8Array, value: string): boolean {
	if (bytes.byteLength < value.length) return false;
	for (let index = 0; index < value.length; index += 1)
		if (bytes[index] !== value.charCodeAt(index)) return false;
	return true;
}

function decodeUtf8(bytes: Uint8Array): string | false {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return false;
	}
}

function compareEntries(
	left: FileCatalogEntry,
	right: FileCatalogEntry,
): number {
	const leftDirectory = left.kind === 'directory' ? 0 : 1;
	const rightDirectory = right.kind === 'directory' ? 0 : 1;
	return leftDirectory - rightDirectory || compareNames(left.name, right.name);
}

function compareNames(left: string, right: string): number {
	const lower = left
		.toLocaleLowerCase()
		.localeCompare(right.toLocaleLowerCase());
	return lower || left.localeCompare(right);
}

function scorePath(relativePath: string, tokens: readonly string[]): number {
	const candidate = relativePath.toLocaleLowerCase();
	const name = candidate.slice(candidate.lastIndexOf('/') + 1);
	let score = 0;
	for (const token of tokens) {
		if (name === token) score += 10_000;
		else if (name.startsWith(token)) score += 5_000 - name.length;
		else if (name.includes(token)) score += 3_000 - name.indexOf(token);
		else if (candidate.includes(token))
			score += 2_000 - candidate.indexOf(token);
		else {
			const fuzzy = fuzzyScore(candidate, token);
			if (fuzzy === 0) return 0;
			score += 1_000 + fuzzy;
		}
	}
	return score;
}

function fuzzyScore(source: string, token: string): number {
	let cursor = -1;
	let score = 0;
	for (const character of token) {
		const index = source.indexOf(character, cursor + 1);
		if (index < 0) return 0;
		score += index === cursor + 1 ? 15 : 5;
		cursor = index;
	}
	return score;
}

function normalizeRelative(value: string): string {
	if (
		typeof value !== 'string' ||
		value.includes('\0') ||
		value.includes('\\') ||
		value.startsWith('/')
	)
		throw new FileServiceError(
			'invalid_path',
			'project-relative path is invalid',
			{ requested: value },
		);
	if (value === '' || value === '.') return '';
	const parts = value.split('/');
	if (parts.some((part) => part.length === 0 || part === '.' || part === '..'))
		throw new FileServiceError(
			'path_escape',
			'project-relative path is not canonical',
			{ requested: value },
		);
	return parts.join('/');
}

function validEntryName(name: string): string {
	if (
		typeof name !== 'string' ||
		name.length === 0 ||
		name.length > 4096 ||
		name.includes('\0') ||
		name.includes('/') ||
		name.includes('\\') ||
		name === '.' ||
		name === '..'
	)
		throw new FileServiceError(
			'invalid_path',
			'directory entry name is invalid',
		);
	return name;
}

/** Never let a platform-specific read error escape the file-service boundary.
 * The error still distinguishes a vanished directory from an inaccessible or
 * otherwise failed read, without carrying an absolute path into the protocol. */
function directoryReadFailure(error: unknown): FileServiceError {
	if (error instanceof FileServiceError) return error;
	if (isMissingPathError(error))
		return new FileServiceError('path_missing', 'folder is no longer available');
	return new FileServiceError('read_failed', 'folder could not be read');
}

function isMissingPathError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		((error as { readonly code?: unknown }).code === 'ENOENT' ||
			(error as { readonly code?: unknown }).code === 'ENOTDIR')
	);
}


function normalizeQuery(value: string, max: number): string {
	if (typeof value !== 'string' || value.length > max)
		throw new FileServiceError('invalid_path', 'search query is invalid');
	return value.trim().replace(/[\\/]+/gu, '/');
}

function safeSize(value: number | undefined): number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
		? value
		: 0;
}

function safeMode(value: number | undefined): number | undefined {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
		? value
		: undefined;
}
function finite(value: number | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function positive(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError(`${name} must be a positive safe integer`);
	return value;
}
function boundedOffset(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new RangeError(`${name} must be a non-negative safe integer`);
	return value;
}
function boundedLimit(value: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0 || value > maximum)
		throw new RangeError(`${name} exceeds the configured limit`);
	return value;
}
function boundedSize(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0)
		throw new RangeError(`${name} must be a non-negative safe integer`);
	return value;
}
function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted === true)
		throw signal.reason instanceof Error
			? signal.reason
			: new DOMException('The operation was aborted', 'AbortError');
}
