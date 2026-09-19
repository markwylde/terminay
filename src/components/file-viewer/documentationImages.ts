/**
 * Resolve an image `src` from a Markdown document to a file path in the
 * project. Relative sources resolve against the document's folder and a
 * leading `/` against the project root, as GitHub renders a README. Returns
 * undefined for anything the browser can load itself (URLs, data, blobs).
 */
export function resolveDocumentationImagePath(
	src: string,
	documentPath: string,
	projectRoot: string,
): string | undefined {
	if (!src || /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(src)) return undefined;
	let path = src.replace(/[?#].*$/u, '');
	try {
		path = decodeURI(path);
	} catch {
		// Keep the raw path when it is not valid percent-encoding.
	}
	const base = path.startsWith('/')
		? projectRoot
		: documentPath.slice(0, documentPath.lastIndexOf('/'));
	const parts: string[] = [];
	for (const part of `${base}/${path}`.split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') parts.pop();
		else parts.push(part);
	}
	return `/${parts.join('/')}`;
}

const IMAGE_TYPES: Readonly<Record<string, string>> = {
	avif: 'image/avif',
	bmp: 'image/bmp',
	gif: 'image/gif',
	ico: 'image/x-icon',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	png: 'image/png',
	svg: 'image/svg+xml',
	webp: 'image/webp',
};

/** An `<img>` only renders SVG from a blob typed `image/svg+xml`. */
export function documentationImageType(
	path: string,
	reported: string | null | undefined,
): string {
	const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
	return IMAGE_TYPES[extension] ?? reported ?? 'application/octet-stream';
}
