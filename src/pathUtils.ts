export function normalizePathSeparators(path: string): string {
	return path.replace(/\\/g, '/');
}

function trimTrailingSlash(path: string): string {
	const normalized = normalizePathSeparators(path);
	if (/^[A-Za-z]:\/?$/.test(normalized) || normalized === '/') {
		return normalized;
	}
	return normalized.replace(/\/+$/, '');
}

function isAbsolutePath(path: string): boolean {
	return path.startsWith('/') || /^[A-Za-z]:\//.test(path);
}

export function getParentPath(path: string): string {
	const normalized = trimTrailingSlash(path);
	const separatorIndex = normalized.lastIndexOf('/');

	if (separatorIndex <= 0) {
		return separatorIndex === 0 ? '/' : normalized;
	}

	if (/^[A-Za-z]:\/[^/]+$/.test(normalized)) {
		return normalized.slice(0, 3);
	}

	return normalized.slice(0, separatorIndex);
}

export function getPathRelativeToRoot(path: string, rootPath: string): string {
	const normalizedPath = trimTrailingSlash(path);
	const normalizedRoot = trimTrailingSlash(rootPath);

	if (!normalizedPath || !normalizedRoot) {
		return normalizedPath;
	}

	if (normalizedPath === normalizedRoot) {
		return '.';
	}

	if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
		return normalizedPath.slice(normalizedRoot.length + 1) || '.';
	}

	if (!isAbsolutePath(normalizedPath) || !isAbsolutePath(normalizedRoot)) {
		return normalizedPath;
	}

	const pathSegments = normalizedPath.split('/').filter(Boolean);
	const rootSegments = normalizedRoot.split('/').filter(Boolean);

	if (
		pathSegments[0]?.endsWith(':') &&
		rootSegments[0]?.endsWith(':') &&
		pathSegments[0].toLowerCase() !== rootSegments[0].toLowerCase()
	) {
		return normalizedPath;
	}

	let commonLength = 0;
	while (
		commonLength < pathSegments.length &&
		commonLength < rootSegments.length &&
		pathSegments[commonLength] === rootSegments[commonLength]
	) {
		commonLength += 1;
	}

	const upSegments = rootSegments.slice(commonLength).map(() => '..');
	const downSegments = pathSegments.slice(commonLength);
	return [...upSegments, ...downSegments].join('/') || '.';
}
