/**
 * Builds the document an HTML preview runs (ADR-0042).
 *
 * The preview's frame has an opaque origin and no network, so it can fetch
 * nothing. Every project file the page refers to is read here, through the
 * server's bounded and authorized file reads, and written into the document as
 * a `data:` URL before the document is handed to the sandbox.
 *
 * Nothing in this file is a security boundary. The server decides which paths
 * may be read, and the policy `buildViewDocument` puts first decides what the
 * page may load. A reference this scanner misses simply does not load.
 */

import { buildViewDocument } from '../../../workspace/appWindows/viewDocument.ts';

export const HTML_PREVIEW_LIMITS = {
	maxResources: 200,
	maxTotalBytes: 16 * 1024 * 1024,
	maxResourceBytes: 4 * 1024 * 1024,
	maxImportDepth: 4,
	readConcurrency: 6,
} as const;

export type HtmlPreviewLimits = { readonly [K in keyof typeof HTML_PREVIEW_LIMITS]: number };

export interface HtmlPreviewResource {
	readonly base64: string;
	readonly byteLength: number;
}

/**
 * Reads up to `maxBytes` of a project file named by its project-relative path.
 * It rejects when the server refuses the path or the file cannot be read.
 */
export type HtmlPreviewRead = (
	relativePath: string,
	maxBytes: number,
) => Promise<HtmlPreviewResource>;

/** Resources already read, kept by the caller for as long as the preview is shown. */
export type HtmlPreviewCache = Map<string, Promise<HtmlPreviewResource | undefined>>;

export interface HtmlPreviewInput {
	readonly html: string;
	/** The previewed file's folder, relative to the project root; empty at the root. */
	readonly baseDirectory: string;
	readonly read: HtmlPreviewRead;
	readonly cache?: HtmlPreviewCache;
	readonly limits?: Partial<HtmlPreviewLimits>;
}

export interface HtmlPreviewDocument {
	readonly html: string;
	/** The `allow` attribute for the preview's frame: always empty. */
	readonly allow: string;
	/** Some resource the page refers to was not loaded. */
	readonly incomplete: boolean;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
	css: 'text/css',
	js: 'text/javascript',
	mjs: 'text/javascript',
	cjs: 'text/javascript',
	png: 'image/png',
	apng: 'image/apng',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	avif: 'image/avif',
	bmp: 'image/bmp',
	ico: 'image/x-icon',
	svg: 'image/svg+xml',
	woff: 'font/woff',
	woff2: 'font/woff2',
	ttf: 'font/ttf',
	otf: 'font/otf',
	mp4: 'video/mp4',
	webm: 'video/webm',
	ogv: 'video/ogg',
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	ogg: 'audio/ogg',
	m4a: 'audio/mp4',
	vtt: 'text/vtt',
};

function mimeTypeOf(path: string): string | undefined {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	return dot <= 0 ? undefined : MIME_TYPES[name.slice(dot + 1).toLowerCase()];
}

export type ResolvedReference =
	/** A project file, with the fragment the reference carried. */
	| { readonly kind: 'project'; readonly path: string; readonly fragment: string }
	/** Another origin, which the preview's policy will not load. */
	| { readonly kind: 'external' }
	/** A path that climbs out of the project. */
	| { readonly kind: 'escape' }
	/** Nothing to fetch: empty, a fragment, or a `data:` or similar URL. */
	| { readonly kind: 'none' };

/** Where a reference written in a page or stylesheet points. */
export function resolveReference(reference: string, baseDirectory: string): ResolvedReference {
	const trimmed = reference.trim();
	if (trimmed === '' || trimmed.startsWith('#')) return { kind: 'none' };
	if (trimmed.startsWith('//') || /^(?:https?|wss?|ftp):/iu.test(trimmed))
		return { kind: 'external' };
	if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) return { kind: 'none' };
	const hash = trimmed.indexOf('#');
	const fragment = hash === -1 ? '' : trimmed.slice(hash);
	const withoutFragment = hash === -1 ? trimmed : trimmed.slice(0, hash);
	const query = withoutFragment.indexOf('?');
	const pathname = query === -1 ? withoutFragment : withoutFragment.slice(0, query);
	const segments = pathname.startsWith('/')
		? []
		: baseDirectory.split('/').filter((part) => part !== '' && part !== '.');
	for (const raw of pathname.split('/')) {
		let segment = raw;
		try {
			segment = decodeURIComponent(raw);
		} catch {
			// Not percent-encoding after all: the file is named as written.
		}
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			if (segments.length === 0) return { kind: 'escape' };
			segments.pop();
			continue;
		}
		if (segment.includes('/') || segment.includes('\\') || segment.includes('\0'))
			return { kind: 'escape' };
		segments.push(segment);
	}
	if (segments.length === 0) return { kind: 'none' };
	return { kind: 'project', path: segments.join('/'), fragment };
}

function directoryOf(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? '' : path.slice(0, slash);
}

function textOf(resource: HtmlPreviewResource): string {
	return new TextDecoder().decode(
		Uint8Array.from(atob(resource.base64), (character) => character.charCodeAt(0)),
	);
}

const cssDataUrl = (css: string): string =>
	`data:text/css;charset=utf-8,${encodeURIComponent(css)}`;

/** One build: what it has read, and whether anything was left out. */
class ResourceLoader {
	incomplete = false;
	private readonly claimed = new Map<string, Promise<HtmlPreviewResource | undefined>>();
	private totalBytes = 0;
	private reading = 0;
	private readonly waiting: (() => void)[] = [];
	private readonly read: HtmlPreviewRead;
	private readonly cache: HtmlPreviewCache;
	readonly limits: HtmlPreviewLimits;

	constructor(input: HtmlPreviewInput) {
		this.read = input.read;
		this.cache = input.cache ?? new Map();
		this.limits = { ...HTML_PREVIEW_LIMITS, ...input.limits };
	}

	/** The file at `path`, or nothing when it is refused, missing, or past a bound. */
	load(path: string): Promise<HtmlPreviewResource | undefined> {
		const claimed = this.claimed.get(path);
		if (claimed !== undefined) return claimed;
		if (this.claimed.size >= this.limits.maxResources) {
			this.incomplete = true;
			return Promise.resolve(undefined);
		}
		const loading = this.fetch(path).then((resource) => {
			if (
				resource === undefined ||
				this.totalBytes + resource.byteLength > this.limits.maxTotalBytes
			) {
				this.incomplete = true;
				return undefined;
			}
			this.totalBytes += resource.byteLength;
			return resource;
		});
		this.claimed.set(path, loading);
		return loading;
	}

	private fetch(path: string): Promise<HtmlPreviewResource | undefined> {
		const cached = this.cache.get(path);
		if (cached !== undefined) return cached;
		const limit = this.limits.maxResourceBytes;
		const fetching = this.limited(() => this.read(path, limit + 1)).then(
			(resource) => (resource.byteLength > limit ? undefined : resource),
			() => undefined,
		);
		this.cache.set(path, fetching);
		// A file that could not be read is asked for again next time: it may
		// have been created since.
		void fetching.then((resource) => {
			if (resource === undefined && this.cache.get(path) === fetching) this.cache.delete(path);
		});
		return fetching;
	}

	private async limited<T>(work: () => Promise<T>): Promise<T> {
		while (this.reading >= this.limits.readConcurrency)
			await new Promise<void>((resolve) => this.waiting.push(resolve));
		this.reading += 1;
		try {
			return await work();
		} finally {
			this.reading -= 1;
			this.waiting.shift()?.();
		}
	}

	/** A `data:` URL for a file of one of the wanted kinds. */
	async dataUrl(
		reference: string,
		baseDirectory: string,
		wanted: (mimeType: string) => boolean,
	): Promise<string | undefined> {
		const resolved = this.resolve(reference, baseDirectory);
		if (resolved === undefined) return undefined;
		const mimeType = mimeTypeOf(resolved.path);
		if (mimeType === undefined || !wanted(mimeType)) {
			this.incomplete = true;
			return undefined;
		}
		const resource = await this.load(resolved.path);
		if (resource === undefined) return undefined;
		return `data:${mimeType};base64,${resource.base64}${resolved.fragment}`;
	}

	/** A stylesheet's text with everything it refers to inlined, as a `data:` URL. */
	async stylesheetUrl(
		reference: string,
		baseDirectory: string,
		depth: number,
		ancestors: ReadonlySet<string>,
	): Promise<string | undefined> {
		const resolved = this.resolve(reference, baseDirectory);
		if (resolved === undefined) return undefined;
		if (
			mimeTypeOf(resolved.path) !== 'text/css' ||
			depth > this.limits.maxImportDepth ||
			ancestors.has(resolved.path)
		) {
			this.incomplete = true;
			return undefined;
		}
		const resource = await this.load(resolved.path);
		if (resource === undefined) return undefined;
		const css = await this.rewriteCss(
			textOf(resource),
			directoryOf(resolved.path),
			depth,
			new Set([...ancestors, resolved.path]),
		);
		return cssDataUrl(css);
	}

	/** Stylesheet text with its `@import` and `url()` references inlined. */
	async rewriteCss(
		css: string,
		baseDirectory: string,
		depth: number,
		ancestors: ReadonlySet<string>,
	): Promise<string> {
		const pattern =
			/@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^"'\s)]+))\s*\)|"([^"]*)"|'([^']*)')|url\(\s*(?:"([^"]*)"|'([^']*)'|([^"'\s)]*))\s*\)/giu;
		const parts: (string | Promise<string>)[] = [];
		let last = 0;
		for (const match of css.matchAll(pattern)) {
			const original = match[0];
			const imported = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
			const referenced = match[6] ?? match[7] ?? match[8];
			parts.push(css.slice(last, match.index));
			last = match.index + original.length;
			parts.push(
				imported !== undefined
					? this.stylesheetUrl(imported, baseDirectory, depth + 1, ancestors).then((url) =>
							url === undefined ? original : `@import url("${url}")`,
						)
					: this.dataUrl(referenced ?? '', baseDirectory, isAsset).then((url) =>
							url === undefined ? original : `url("${url}")`,
						),
			);
		}
		parts.push(css.slice(last));
		return (await Promise.all(parts)).join('');
	}

	private resolve(
		reference: string,
		baseDirectory: string,
	): { path: string; fragment: string } | undefined {
		const resolved = resolveReference(reference, baseDirectory);
		if (resolved.kind === 'project') return resolved;
		if (resolved.kind !== 'none') this.incomplete = true;
		return undefined;
	}
}

const isAsset = (mimeType: string): boolean =>
	mimeType.startsWith('image/') ||
	mimeType.startsWith('font/') ||
	mimeType.startsWith('video/') ||
	mimeType.startsWith('audio/');
const isImage = (mimeType: string): boolean => mimeType.startsWith('image/');
const isScript = (mimeType: string): boolean => mimeType === 'text/javascript';
const isMedia = (mimeType: string): boolean =>
	mimeType.startsWith('video/') || mimeType.startsWith('audio/');
const isTrack = (mimeType: string): boolean => mimeType === 'text/vtt';

interface Attribute {
	readonly name: string;
	/** The value as written, entities undecoded; absent for a bare attribute. */
	readonly raw: string | undefined;
	/** The value's range in the source, quotes included. */
	readonly start: number;
	readonly end: number;
}

interface Tag {
	readonly name: string;
	readonly start: number;
	readonly end: number;
	readonly attributes: readonly Attribute[];
	/** For an element whose content is not markup: where that content lies. */
	readonly content?: { readonly start: number; readonly end: number };
}

/** Elements whose content is text, so a `<` inside one starts no tag. */
const RAW_TEXT = new Set([
	'script',
	'style',
	'textarea',
	'title',
	'xmp',
	'noembed',
	'noframes',
	'iframe',
]);

const isSpace = (character: string | undefined): boolean =>
	character === ' ' ||
	character === '\n' ||
	character === '\t' ||
	character === '\r' ||
	character === '\f';

/** The start tags of a document, in order. Nothing is parsed into a tree. */
export function scanTags(html: string): Tag[] {
	const tags: Tag[] = [];
	const length = html.length;
	let index = 0;
	while (index < length) {
		const open = html.indexOf('<', index);
		if (open === -1) break;
		if (html.startsWith('<!--', open)) {
			const close = html.indexOf('-->', open + 4);
			index = close === -1 ? length : close + 3;
			continue;
		}
		const first = html[open + 1];
		if (first === undefined || !/[a-z]/iu.test(first)) {
			if (first === '/' || first === '!' || first === '?') {
				const close = html.indexOf('>', open + 1);
				index = close === -1 ? length : close + 1;
			} else index = open + 1;
			continue;
		}
		let cursor = open + 1;
		while (cursor < length && !isSpace(html[cursor]) && html[cursor] !== '/' && html[cursor] !== '>')
			cursor += 1;
		const name = html.slice(open + 1, cursor).toLowerCase();
		const attributes: Attribute[] = [];
		for (;;) {
			while (cursor < length && (isSpace(html[cursor]) || html[cursor] === '/')) cursor += 1;
			if (cursor >= length) break;
			if (html[cursor] === '>') {
				cursor += 1;
				break;
			}
			const nameStart = cursor;
			cursor += 1;
			while (
				cursor < length &&
				!isSpace(html[cursor]) &&
				html[cursor] !== '/' &&
				html[cursor] !== '>' &&
				html[cursor] !== '='
			)
				cursor += 1;
			const attributeName = html.slice(nameStart, cursor).toLowerCase();
			let value = cursor;
			while (value < length && isSpace(html[value])) value += 1;
			if (html[value] !== '=') {
				attributes.push({ name: attributeName, raw: undefined, start: cursor, end: cursor });
				continue;
			}
			value += 1;
			while (value < length && isSpace(html[value])) value += 1;
			const quote = html[value];
			if (quote === '"' || quote === "'") {
				const close = html.indexOf(quote, value + 1);
				const end = close === -1 ? length : close;
				attributes.push({
					name: attributeName,
					raw: html.slice(value + 1, end),
					start: value,
					end: close === -1 ? length : close + 1,
				});
				cursor = close === -1 ? length : close + 1;
			} else {
				let end = value;
				while (end < length && !isSpace(html[end]) && html[end] !== '>') end += 1;
				attributes.push({ name: attributeName, raw: html.slice(value, end), start: value, end });
				cursor = end;
			}
		}
		if (RAW_TEXT.has(name)) {
			const rest = html.slice(cursor);
			const close = rest.search(new RegExp(`</${name}`, 'iu'));
			const end = close === -1 ? length : cursor + close;
			tags.push({ name, start: open, end: cursor, attributes, content: { start: cursor, end } });
			index = end;
		} else {
			tags.push({ name, start: open, end: cursor, attributes });
			index = cursor;
		}
	}
	return tags;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
	amp: '&',
	quot: '"',
	apos: "'",
	lt: '<',
	gt: '>',
};

function decodeAttribute(raw: string): string {
	return raw.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/giu, (whole, decimal, hex, named) => {
		if (named !== undefined) return NAMED_ENTITIES[String(named).toLowerCase()] ?? whole;
		const code = decimal !== undefined ? Number(decimal) : Number.parseInt(String(hex), 16);
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
	});
}

const quoteAttribute = (value: string): string =>
	`"${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`;

interface Edit {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

/** Rewrite one attribute's value, or leave it when there is nothing to put there. */
async function replaceValue(
	attribute: Attribute | undefined,
	rewrite: (value: string) => Promise<string | undefined>,
): Promise<Edit | undefined> {
	if (attribute?.raw === undefined) return undefined;
	const value = await rewrite(decodeAttribute(attribute.raw));
	return value === undefined
		? undefined
		: { start: attribute.start, end: attribute.end, text: quoteAttribute(value) };
}

/** A `srcset` with each candidate's URL inlined. */
async function rewriteSrcset(
	value: string,
	loader: ResourceLoader,
	baseDirectory: string,
): Promise<string | undefined> {
	let changed = false;
	const candidates = await Promise.all(
		value.split(',').map(async (candidate) => {
			const [url, ...descriptors] = candidate.trim().split(/\s+/u);
			if (url === undefined || url === '') return candidate;
			const inlined = await loader.dataUrl(url, baseDirectory, isImage);
			if (inlined === undefined) return candidate.trim();
			changed = true;
			return [inlined, ...descriptors].join(' ');
		}),
	);
	return changed ? candidates.join(', ') : undefined;
}

function editsFor(tag: Tag, html: string, loader: ResourceLoader, baseDirectory: string): Promise<Edit | undefined>[] {
	const attribute = (name: string): Attribute | undefined =>
		tag.attributes.find((candidate) => candidate.name === name);
	const value = (name: string): string =>
		decodeAttribute(attribute(name)?.raw ?? '').trim().toLowerCase();
	const remove: Promise<Edit> = Promise.resolve({ start: tag.start, end: tag.end, text: '' });
	const inline = (name: string, wanted: (mimeType: string) => boolean) =>
		replaceValue(attribute(name), (reference) => loader.dataUrl(reference, baseDirectory, wanted));
	const edits: Promise<Edit | undefined>[] = [];

	const style = attribute('style');
	if (style?.raw !== undefined && /url\(/iu.test(style.raw))
		edits.push(replaceValue(style, (css) => loader.rewriteCss(css, baseDirectory, 0, new Set())));

	switch (tag.name) {
		case 'base':
			// The page's references are resolved here, against the file's folder.
			return [remove];
		case 'meta': {
			// A policy of the page's own could only forbid what was inlined for
			// it, and a refresh would navigate the frame and end the preview.
			const equivalent = value('http-equiv');
			return equivalent === 'content-security-policy' || equivalent === 'refresh'
				? [remove]
				: edits;
		}
		case 'link': {
			const rel = value('rel').split(/\s+/u);
			if (rel.includes('stylesheet')) {
				edits.push(
					replaceValue(attribute('href'), (reference) =>
						loader.stylesheetUrl(reference, baseDirectory, 0, new Set()),
					),
				);
				// The stylesheet's text changes when what it refers to is inlined.
				const integrity = attribute('integrity');
				if (integrity?.raw !== undefined)
					edits.push(
						Promise.resolve({ start: integrity.start, end: integrity.end, text: '""' }),
					);
			} else if (rel.includes('icon') || rel.includes('apple-touch-icon'))
				edits.push(inline('href', isImage));
			return edits;
		}
		case 'script':
			edits.push(inline('src', isScript));
			return edits;
		case 'style': {
			const content = tag.content;
			if (content === undefined || content.end === content.start) return edits;
			edits.push(
				loader
					.rewriteCss(html.slice(content.start, content.end), baseDirectory, 0, new Set())
					.then((css) => ({ start: content.start, end: content.end, text: css })),
			);
			return edits;
		}
		case 'img':
			edits.push(inline('src', isImage));
			edits.push(
				replaceValue(attribute('srcset'), (srcset) =>
					rewriteSrcset(srcset, loader, baseDirectory),
				),
			);
			return edits;
		case 'source':
			edits.push(inline('src', isAsset));
			edits.push(
				replaceValue(attribute('srcset'), (srcset) =>
					rewriteSrcset(srcset, loader, baseDirectory),
				),
			);
			return edits;
		case 'video':
			edits.push(inline('src', isMedia), inline('poster', isImage));
			return edits;
		case 'audio':
			edits.push(inline('src', isMedia));
			return edits;
		case 'track':
			edits.push(inline('src', isTrack));
			return edits;
		case 'image':
			// SVG's image element.
			edits.push(inline('href', isImage), inline('xlink:href', isImage));
			return edits;
		case 'input':
			if (value('type') === 'image') edits.push(inline('src', isImage));
			return edits;
		default:
			return edits;
	}
}

/** The previewed page as one self-contained document for the sandbox. */
export async function buildHtmlPreviewDocument(
	input: HtmlPreviewInput,
): Promise<HtmlPreviewDocument> {
	const loader = new ResourceLoader(input);
	const pending: Promise<Edit | undefined>[] = [];
	for (const tag of scanTags(input.html))
		pending.push(...editsFor(tag, input.html, loader, input.baseDirectory));
	const edits = (await Promise.all(pending))
		.filter((edit): edit is Edit => edit !== undefined)
		.sort((left, right) => right.start - left.start);
	let html = input.html;
	for (const edit of edits) html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
	const built = buildViewDocument({ html, source: { kind: 'file' } });
	return { html: built.html, allow: built.allow, incomplete: loader.incomplete };
}
