/** Pure presentation model for the workspace status bar. Nothing here reads
 * external state; callers pass in what the workspace already holds. */

export type StatusBarPathSegment = {
	/** Index into the full segment list, stable across collapse. */
	index: number;
	label: string;
	/** Absolute path this segment names, or null for the collapse marker. */
	path: string | null;
};

const MAX_VISIBLE_TRAILING_SEGMENTS = 3;

function trimTrailingSeparators(path: string): string {
	if (path.length <= 1) return path;
	return path.replace(/[\\/]+$/u, '') || path.slice(0, 1);
}

function separatorOf(path: string): '/' | '\\' {
	return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

/** The home directory a path lies under, recognised by the conventional
 * layouts of macOS, Linux and Windows. The renderer is not told the server's
 * home directory, and this is display only, so a shape match is enough. */
export function inferHomeDirectory(absolutePath: string): string {
	const match =
		/^(\/Users\/[^/]+|\/home\/[^/]+|\/root)(?=\/|$)/u.exec(absolutePath) ??
		/^([A-Za-z]:\\Users\\[^\\]+)(?=\\|$)/u.exec(absolutePath);
	return match?.[1] ?? '';
}

/** Split a path into display segments, with the home directory as `~`. The
 * first segment is `~`, `/`, or a drive such as `C:`. */
export function splitStatusBarPath(
	absolutePath: string,
	homePath: string,
): string[] {
	const path = trimTrailingSeparators(absolutePath.trim());
	if (path.length === 0) return [];
	const home = trimTrailingSeparators(homePath.trim());
	const separator = separatorOf(path);
	if (home.length > 1 && (path === home || path.startsWith(`${home}${separator}`))) {
		const rest = path.slice(home.length).split(/[\\/]+/u).filter(Boolean);
		return ['~', ...rest];
	}
	const parts = path.split(/[\\/]+/u);
	if (parts[0] === '') return ['/', ...parts.slice(1).filter(Boolean)];
	return parts.filter(Boolean);
}

function joinSegments(segments: readonly string[], absolutePath: string, homePath: string, count: number): string {
	const separator = separatorOf(absolutePath);
	const head = segments[0];
	const tail = segments.slice(1, count);
	if (head === '~') {
		const home = trimTrailingSeparators(homePath.trim());
		return tail.length === 0 ? home : `${home}${separator}${tail.join(separator)}`;
	}
	if (head === '/') return `/${tail.join('/')}`;
	return tail.length === 0 ? `${head}${separator}` : `${head}${separator}${tail.join(separator)}`;
}

/** Visible breadcrumb: the root, a collapse marker, then the last few segments
 * so the directory the user is in always stays readable. */
export function statusBarBreadcrumb(
	absolutePath: string,
	homePath: string,
): StatusBarPathSegment[] {
	const segments = splitStatusBarPath(absolutePath, homePath);
	const toSegment = (index: number): StatusBarPathSegment => ({
		index,
		label: segments[index],
		path: joinSegments(segments, absolutePath, homePath, index + 1),
	});
	if (segments.length <= MAX_VISIBLE_TRAILING_SEGMENTS + 2) {
		return segments.map((_, index) => toSegment(index));
	}
	const trailingStart = segments.length - MAX_VISIBLE_TRAILING_SEGMENTS;
	return [
		toSegment(0),
		{ index: -1, label: '…', path: null },
		...segments.slice(trailingStart).map((_, offset) => toSegment(trailingStart + offset)),
	];
}

/** Index of the first segment that differs from the previously shown path.
 * Segments before it stay in place; the rest animate in. */
export function firstChangedSegmentIndex(
	previous: readonly string[] | null,
	next: readonly string[],
): number {
	if (previous === null) return next.length;
	let index = 0;
	while (index < previous.length && index < next.length && previous[index] === next[index]) {
		index += 1;
	}
	return index;
}

const FILE_SIZE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const;

/** A file size short enough for the status bar: whole bytes below 1 KB, then
 * binary units with one decimal until the number reaches three digits. */
export function formatStatusBarFileSize(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return '';
	if (bytes < 1024) return `${bytes} B`;
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < FILE_SIZE_UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	// Round first so 99.96 reads as "100", not "100.0".
	const rounded = Math.round(value * 10) / 10;
	return `${rounded >= 100 ? Math.round(value) : rounded.toFixed(1)} ${FILE_SIZE_UNITS[unit]}`;
}

export type StatusBarWorktree = {
	path: string;
	branch: string | null;
	aheadOfMainCount: number | null;
	entries: readonly unknown[];
	isDetached?: boolean;
};

export type StatusBarBranch = {
	name: string;
	uncommittedCount: number;
	aheadCount: number;
};

function isWithin(path: string, root: string): boolean {
	const normalizedRoot = trimTrailingSeparators(root);
	if (normalizedRoot.length === 0) return false;
	if (path === normalizedRoot) return true;
	return path.startsWith(`${normalizedRoot}/`) || path.startsWith(`${normalizedRoot}\\`);
}

/** The worktree whose path is the longest prefix of `cwd`. */
export function findContainingWorktree<T extends StatusBarWorktree>(
	cwd: string,
	worktrees: readonly T[],
): T | null {
	const path = trimTrailingSeparators(cwd);
	let best: T | null = null;
	for (const worktree of worktrees) {
		if (!isWithin(path, worktree.path)) continue;
		if (best === null || worktree.path.length > best.path.length) best = worktree;
	}
	return best;
}

export function statusBarBranch(worktree: StatusBarWorktree | null): StatusBarBranch | null {
	if (worktree === null || worktree.branch === null || worktree.branch.length === 0) return null;
	return {
		name: worktree.branch,
		uncommittedCount: worktree.entries.length,
		aheadCount: Math.max(0, worktree.aheadOfMainCount ?? 0),
	};
}

export type StatusBarLayoutCell = {
	/** Fractions of the layout's bounding box, 0..1. */
	x: number;
	y: number;
	width: number;
	height: number;
	isFocused: boolean;
};

export type StatusBarLayoutRect = {
	left: number;
	top: number;
	width: number;
	height: number;
	isFocused: boolean;
};

/** Normalise group rectangles to the union of all groups, so any split
 * arrangement can be drawn as a miniature. */
export function statusBarLayoutCells(
	rects: readonly StatusBarLayoutRect[],
): StatusBarLayoutCell[] {
	const visible = rects.filter((rect) => rect.width > 0 && rect.height > 0);
	if (visible.length === 0) return [];
	const left = Math.min(...visible.map((rect) => rect.left));
	const top = Math.min(...visible.map((rect) => rect.top));
	const right = Math.max(...visible.map((rect) => rect.left + rect.width));
	const bottom = Math.max(...visible.map((rect) => rect.top + rect.height));
	const width = right - left;
	const height = bottom - top;
	return visible.map((rect) => ({
		x: (rect.left - left) / width,
		y: (rect.top - top) / height,
		width: rect.width / width,
		height: rect.height / height,
		isFocused: rect.isFocused,
	}));
}

export type RemoteIndicatorTone = 'offline' | 'idle' | 'connected';
export type RemoteDeviceKind = 'phone' | 'tablet' | 'computer';

export type RemoteIndicatorState = {
	tone: RemoteIndicatorTone;
	/** Empty when the dot alone says it; the tooltip carries the detail. */
	label: string;
	accessibleLabel: string;
	devices: RemoteDeviceKind[];
};

export const MAX_STATUS_BAR_DEVICE_ICONS = 3;

export function remoteDeviceKind(deviceName: string): RemoteDeviceKind {
	const name = deviceName.toLowerCase();
	if (/\b(ipad|tablet|tab)\b/u.test(name)) return 'tablet';
	if (/\b(iphone|android|phone|pixel|galaxy|mobile)\b/u.test(name)) return 'phone';
	return 'computer';
}

function pluralDevices(count: number): string {
	return count === 1 ? '1 device' : `${count} devices`;
}

/** Red only for the Desktop Local server when it is not exposed; any other
 * server is reachable by definition, so it is grey or blue. */
export function remoteIndicatorState(input: {
	isDesktopLocal: boolean;
	isExposed: boolean;
	connections: readonly { deviceName: string }[];
}): RemoteIndicatorState {
	const count = input.connections.length;
	const exposed = input.isDesktopLocal ? input.isExposed : true;
	const devices = input.connections
		.slice(0, MAX_STATUS_BAR_DEVICE_ICONS)
		.map((connection) => remoteDeviceKind(connection.deviceName));
	if (!exposed) {
		return {
			tone: 'offline',
			label: '',
			accessibleLabel: 'Remote access, not exposed',
			devices: [],
		};
	}
	if (count === 0) {
		return {
			tone: 'idle',
			label: input.isDesktopLocal ? '' : 'No devices',
			accessibleLabel: 'Remote access, exposed, no devices connected',
			devices: [],
		};
	}
	return {
		tone: 'connected',
		label: pluralDevices(count),
		accessibleLabel: `Remote access, exposed, ${pluralDevices(count)} connected`,
		devices,
	};
}
