/** Default hidden, VCS, dependency, and generated directories skipped by
 * Documentation discovery and folder Markdown tasks. Keep this the only copy of
 * these names so ignore-rule tests can prove there is no duplicated string logic. */
export const DEFAULT_IGNORED_DIRECTORIES = Object.freeze([
	'.git',
	'.hg',
	'.svn',
	'.next',
	'.turbo',
	'.vite',
	'coverage',
	'dist',
	'dist-electron',
	'node_modules',
	'release',
]);

export function validIgnorePattern(pattern: string): string {
	if (
		typeof pattern !== 'string' ||
		pattern.length === 0 ||
		pattern.length > 256 ||
		pattern.includes('\0') ||
		pattern.includes('/')
	)
		throw new TypeError('ignore pattern is invalid');
	return pattern;
}

export function matchesIgnorePattern(pattern: string, value: string): boolean {
	let p = 0;
	let v = 0;
	let star = -1;
	let match = 0;
	while (v < value.length) {
		if (p < pattern.length && (pattern[p] === '?' || pattern[p] === value[v])) {
			p += 1;
			v += 1;
			continue;
		}
		if (p < pattern.length && pattern[p] === '*') {
			star = p;
			match = v;
			p += 1;
			continue;
		}
		if (star >= 0) {
			p = star + 1;
			match += 1;
			v = match;
			continue;
		}
		return false;
	}
	while (p < pattern.length && pattern[p] === '*') p += 1;
	return p === pattern.length;
}

export function isIgnoredDirectoryName(
	name: string,
	patterns: readonly string[] = DEFAULT_IGNORED_DIRECTORIES,
): boolean {
	return patterns.some((pattern) => matchesIgnorePattern(pattern, name));
}

export function isHiddenDirectoryName(name: string): boolean {
	return name.startsWith('.') && name !== '.' && name !== '..';
}

export function isIgnoredPath(
	path: string,
	patterns: readonly string[] = DEFAULT_IGNORED_DIRECTORIES,
): boolean {
	return path
		.split('/')
		.some((part) => part.length > 0 && isIgnoredDirectoryName(part, patterns));
}

/** Documentation skips hidden directories in addition to the shared ignore list. */
export function shouldSkipDocumentationDirectory(
	name: string,
	patterns: readonly string[] = DEFAULT_IGNORED_DIRECTORIES,
): boolean {
	return isHiddenDirectoryName(name) || isIgnoredDirectoryName(name, patterns);
}
