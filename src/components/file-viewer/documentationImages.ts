/**
 * Resolve an image `src` from a Markdown document to a project-relative
 * path. `documentPath` is project-relative too. Relative sources resolve
 * against the document's folder and a leading `/` against the project root,
 * as GitHub renders a README. Returns undefined for anything the browser can
 * load itself (URLs, data, blobs) and for paths that climb out of the project.
 */
export function resolveDocumentationImagePath(
	src: string,
	documentPath: string,
): string | undefined {
	if (!src || /^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(src)) return undefined;
	let path = src.replace(/[?#].*$/u, '');
	try {
		path = decodeURI(path);
	} catch {
		// Keep the raw path when it is not valid percent-encoding.
	}
	const parts = path.startsWith('/')
		? []
		: documentPath.split('/').slice(0, -1);
	for (const part of path.split('/')) {
		if (part === '' || part === '.') continue;
		if (part !== '..') parts.push(part);
		else if (parts.pop() === undefined) return undefined;
	}
	return parts.length ? parts.join('/') : undefined;
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
