import type {
	FileObservationClient,
	FileViewerClient,
	FolderMarkdownTaskFile,
	FolderMarkdownTaskItem,
	FolderMarkdownTaskSection,
} from '@terminay/client-core';
import type { IDockviewPanelProps } from 'dockview';
import { writeClipboardText } from '../../host/nativeActions';
import {
	Copy,
	FileEdit,
	FolderOpen,
	FolderPlus,
	PlusSquare,
	Terminal,
	Trash2,
} from 'lucide-react';
import {
	type CSSProperties,
	type MouseEvent,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { FileTypeIcon } from '../../fileIcons';
import { useTerminalSettings } from '../../hooks/useTerminalSettings';
import { getPathRelativeToRoot } from '../../pathUtils';
import type { FileViewerMode } from '../../types/fileViewer';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import { FileAuthorityUnavailableState } from '../file-viewer/FileAuthorityUnavailableState';
import type { TaskSection } from '../file-viewer/tasks/parseTasks';
import {
	TerminalPanelClientContext,
	type TerminalPanelClientContextValue,
} from '../TerminalPanel';
import {
	type FolderTaskDocument,
	FolderTasksViewer,
} from './FolderTasksViewer';
import type {
	FolderDirectoryNode,
	FolderFileNode,
	FolderNodeStats,
	FolderPanelInstanceParams,
	FolderTreeNode,
	FolderViewMode,
} from './types';
import './folderViewer.css';

const IMAGE_EXTENSIONS = new Set([
	'.avif',
	'.bmp',
	'.gif',
	'.heic',
	'.heif',
	'.jpeg',
	'.jpg',
	'.png',
	'.svg',
	'.tif',
	'.tiff',
	'.webp',
]);

const FOLDER_SIZE_DEADLINE_MS = 5000;
const FOLDER_TASK_SCAN_DEADLINE_MS = 8000;

type FolderSizeEntry =
	| { status: 'pending' }
	| { status: 'done'; size: number }
	| { status: 'timeout' };

type ListSortKey =
	| 'name'
	| 'type'
	| 'size'
	| 'modified'
	| 'created'
	| 'permissions';

type ListSort = {
	direction: 'asc' | 'desc';
	key: ListSortKey;
};

async function observeServerFolderSize(
	client: FileObservationClient,
	projectId: string,
	projectRootPath: string,
	targetPath: string,
	signal: AbortSignal,
	onProgress?: (entryCount: number, size: number) => void,
): Promise<{ entryCount: number; size: number }> {
	const handle = await client.startFolderSize(
		projectId,
		toRelativePath(projectRootPath, targetPath),
	);
	return new Promise((resolve, reject) => {
		let unsubscribe: (() => void) | undefined;
		const finish = (callback: () => void) => {
			signal.removeEventListener('abort', onAbort);
			unsubscribe?.();
			callback();
		};
		const onAbort = () => {
			void client.cancelFolderSize(handle.jobId).catch(() => undefined);
			finish(() =>
				reject(
					new DOMException(
						'Folder size calculation was cancelled.',
						'AbortError',
					),
				),
			);
		};
		signal.addEventListener('abort', onAbort, { once: true });
		void client
			.subscribeFolderSize(
				handle,
				(event) => {
					const entryCount = (event.files ?? 0) + (event.directories ?? 0);
					const size = event.bytes ?? 0;
					onProgress?.(entryCount, size);
					if (event.phase === 'completed')
						finish(() => resolve({ entryCount, size }));
					if (event.phase === 'cancelled')
						finish(() =>
							reject(
								new DOMException(
									'Folder size calculation was cancelled.',
									'AbortError',
								),
							),
						);
					if (event.phase === 'failed')
						finish(() => reject(new Error('Folder size calculation failed.')));
				},
				() =>
					finish(() =>
						reject(
							new Error('Folder size event stream requires resynchronization.'),
						),
					),
			)
			.then(
				(dispose) => {
					unsubscribe = dispose;
					if (signal.aborted) onAbort();
				},
				(error) => finish(() => reject(error)),
			);
	});
}

function getListSortValue(
	node: FolderTreeNode,
	key: ListSortKey,
	folderSizes: Record<string, FolderSizeEntry>,
): string | number | null {
	switch (key) {
		case 'name':
			return node.name;
		case 'type':
			return getMimeLabel(node);
		case 'size': {
			if (node.kind === 'directory') {
				const entry = folderSizes[node.path];
				return entry?.status === 'done' ? entry.size : null;
			}
			return node.stats?.size ?? null;
		}
		case 'modified':
			return node.stats?.modifiedAtMs ?? null;
		case 'created':
			return node.stats?.createdAtMs ?? null;
		case 'permissions':
			return node.stats?.mode ?? null;
	}
}

function compareNames(a: FolderTreeNode, b: FolderTreeNode): number {
	return a.name.localeCompare(b.name, undefined, {
		numeric: true,
		sensitivity: 'base',
	});
}

function sortListNodes(
	nodes: FolderTreeNode[],
	sort: ListSort,
	folderSizes: Record<string, FolderSizeEntry>,
): FolderTreeNode[] {
	const directionFactor = sort.direction === 'asc' ? 1 : -1;

	return [...nodes].sort((a, b) => {
		if (a.kind !== b.kind) {
			return a.kind === 'directory' ? -1 : 1;
		}

		const aValue = getListSortValue(a, sort.key, folderSizes);
		const bValue = getListSortValue(b, sort.key, folderSizes);
		if (aValue === null && bValue === null) {
			return compareNames(a, b);
		}
		if (aValue === null || bValue === null) {
			return aValue === null ? 1 : -1;
		}

		let comparison = 0;
		if (typeof aValue === 'string' && typeof bValue === 'string') {
			comparison = aValue.localeCompare(bValue, undefined, {
				numeric: true,
				sensitivity: 'base',
			});
		} else if (typeof aValue === 'number' && typeof bValue === 'number') {
			comparison = aValue - bValue;
		}

		if (comparison !== 0) {
			return comparison * directionFactor;
		}
		return compareNames(a, b);
	});
}

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
	'.avif': 'image/avif',
	'.bmp': 'image/bmp',
	'.css': 'text/css',
	'.csv': 'text/csv',
	'.gif': 'image/gif',
	'.gz': 'application/gzip',
	'.heic': 'image/heic',
	'.heif': 'image/heif',
	'.htm': 'text/html',
	'.html': 'text/html',
	'.ico': 'image/x-icon',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.jsx': 'text/javascript',
	'.markdown': 'text/markdown',
	'.md': 'text/markdown',
	'.mdown': 'text/markdown',
	'.mkd': 'text/markdown',
	'.mp3': 'audio/mpeg',
	'.mp4': 'video/mp4',
	'.pdf': 'application/pdf',
	'.png': 'image/png',
	'.sh': 'application/x-sh',
	'.svg': 'image/svg+xml',
	'.tar': 'application/x-tar',
	'.tif': 'image/tiff',
	'.tiff': 'image/tiff',
	'.toml': 'application/toml',
	'.ts': 'text/typescript',
	'.tsx': 'text/typescript',
	'.txt': 'text/plain',
	'.wav': 'audio/wav',
	'.webm': 'video/webm',
	'.webp': 'image/webp',
	'.xml': 'application/xml',
	'.yaml': 'application/yaml',
	'.yml': 'application/yaml',
	'.zip': 'application/zip',
};

function getMimeLabel(node: FolderTreeNode): string {
	if (node.kind === 'directory') {
		return node.isSymbolicLink ? 'symlink' : 'folder';
	}
	if (node.extension) {
		return MIME_TYPES_BY_EXTENSION[node.extension] ?? node.extension.slice(1);
	}
	return '—';
}

function formatFileSize(size: number | null | undefined): string {
	if (size === null || size === undefined) {
		return '—';
	}
	if (size < 1024) {
		return `${size} B`;
	}
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = size;
	let unitIndex = -1;
	do {
		value /= 1024;
		unitIndex += 1;
	} while (value >= 1024 && unitIndex < units.length - 1);
	return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatTimestamp(timestampMs: number | null | undefined): string {
	if (timestampMs === null || timestampMs === undefined) {
		return '—';
	}
	const date = new Date(timestampMs);
	if (Number.isNaN(date.getTime())) {
		return '—';
	}
	return date.toLocaleString(undefined, {
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		month: 'short',
		year: 'numeric',
	});
}

function formatPermissions(
	mode: number | null | undefined,
	isDirectory: boolean,
	isSymbolicLink: boolean,
): string {
	if (mode === null || mode === undefined) {
		return '—';
	}
	const typeFlag = isSymbolicLink ? 'l' : isDirectory ? 'd' : '-';
	const bits = 'rwxrwxrwx';
	let permissions = '';
	for (let index = 0; index < 9; index += 1) {
		permissions += (mode >> (8 - index)) & 1 ? bits[index] : '-';
	}
	return `${typeFlag}${permissions}`;
}

const VIEW_MODES: Array<{ mode: FolderViewMode; label: string }> = [
	{ mode: 'tree', label: 'Tree' },
	{ mode: 'tasks', label: 'Tasks' },
	{ mode: 'list', label: 'List' },
	{ mode: 'thumbnail', label: 'Thumbnail' },
	{ mode: 'gallery', label: 'Gallery' },
];

function ChevronIcon() {
	return (
		<svg
			aria-hidden="true"
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="3"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<polyline points="9 18 15 12 9 6" />
		</svg>
	);
}

function FolderIcon() {
	return (
		<svg
			aria-hidden="true"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
		</svg>
	);
}

function SymlinkIcon() {
	return (
		<svg
			aria-hidden="true"
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
			<path d="M9 14l3-3m0 0h-2.5m2.5 0v2.5" strokeWidth="2.5" />
		</svg>
	);
}

function normalizePath(path: string): string {
	if (!path) {
		return path;
	}

	const withForwardSlashes = path.replace(/\\/g, '/');
	if (withForwardSlashes === '/') {
		return withForwardSlashes;
	}

	return withForwardSlashes.endsWith('/')
		? withForwardSlashes.slice(0, -1)
		: withForwardSlashes;
}

function getNameFromPath(path: string): string {
	const normalized = normalizePath(path);
	if (!normalized || normalized === '/') {
		return normalized || 'Folder';
	}

	const segments = normalized.split('/').filter(Boolean);
	return segments[segments.length - 1] ?? normalized;
}

function getParentPath(candidatePath: string): string | null {
	const normalized = normalizePath(candidatePath);
	if (!normalized || normalized === '/') {
		return null;
	}

	const lastSlash = normalized.lastIndexOf('/');
	if (lastSlash < 0) {
		return null;
	}
	if (lastSlash === 0) {
		return '/';
	}

	const parent = normalized.slice(0, lastSlash);
	return /^[a-zA-Z]:$/.test(parent) ? `${parent}/` : parent;
}

function getExtension(name: string): string {
	const dotIndex = name.lastIndexOf('.');
	if (dotIndex <= 0) {
		return '';
	}
	return name.slice(dotIndex).toLowerCase();
}

function toRelativePath(rootPath: string, candidatePath: string): string {
	const normalizedRoot = comparableMacPath(normalizePath(rootPath));
	const normalizedCandidate = comparableMacPath(normalizePath(candidatePath));

	if (normalizedCandidate === normalizedRoot) {
		return '.';
	}

	const prefix = normalizedRoot.endsWith('/')
		? normalizedRoot
		: `${normalizedRoot}/`;
	if (normalizedCandidate.startsWith(prefix)) {
		return normalizedCandidate.slice(prefix.length) || '.';
	}

	return normalizedCandidate;
}

function comparableMacPath(path: string): string {
	return path.startsWith('/private/var/')
		? path.slice('/private'.length)
		: path;
}

function getRelativeDirectory(relativePath: string): string {
	const segments = relativePath.split('/').filter(Boolean);
	if (segments.length <= 1) {
		return '.';
	}
	return segments.slice(0, -1).join('/');
}

function parseIgnoredDirectoryPatterns(value: string): string[] {
	return value
		.split(/[\n,]/)
		.map((entry) => normalizePath(entry.trim()).toLowerCase())
		.filter(Boolean);
}

const MAX_SERVER_TASK_IGNORED_DIRECTORIES = 128;

function serverTaskIgnoredDirectories(patterns: readonly string[]): string[] {
	const seen = new Set<string>();
	for (const pattern of patterns) {
		if (
			pattern.length === 0 ||
			pattern.length > 128 ||
			pattern.includes('/') ||
			pattern.includes('\\') ||
			pattern.includes('\0')
		) {
			continue;
		}
		seen.add(pattern);
		if (seen.size >= MAX_SERVER_TASK_IGNORED_DIRECTORIES) break;
	}
	return [...seen];
}

type FolderTaskScanResult = {
	documents: FolderTaskDocument[];
	errorText: string | null;
	ignoredDirectoryCount: number;
	scannedDirectoryCount: number;
	scannedMarkdownCount: number;
	truncated: boolean;
	watchedDirectories: string[];
};

async function scanFolderTasks(
	rootPath: string,
	projectRootPath: string,
	ignoredPatterns: string[],
	fileViewerClient: FileViewerClient,
	projectId: string,
	signal?: AbortSignal,
): Promise<FolderTaskScanResult> {
	const relativePath = toRelativePath(projectRootPath, rootPath);
	const result = await withDeadline(
		fileViewerClient.getFolderMarkdownTasks(
			relativePath,
			projectId,
			{
				ignoredDirectories: serverTaskIgnoredDirectories(ignoredPatterns),
			},
			{
				deadlineMs: FOLDER_TASK_SCAN_DEADLINE_MS,
				...(signal === undefined ? {} : { signal }),
			},
		),
		FOLDER_TASK_SCAN_DEADLINE_MS,
		`Task scan timed out for ${relativePath}.`,
	);
	const documents = result.files
		.filter((file) => file.stats.total > 0)
		.map((file) => toFolderTaskDocument(rootPath, result.root, file));

	return {
		documents,
		errorText: result.truncated
			? 'Task scan reached a server bound; results are partial.'
			: null,
		ignoredDirectoryCount: 0,
		scannedDirectoryCount: countTaskDirectories(result.files),
		scannedMarkdownCount: result.scannedFiles,
		truncated: result.truncated,
		watchedDirectories: collectTaskWatchDirectories(
			rootPath,
			result.root,
			result.files,
		),
	};
}

function withDeadline<T>(
	promise: Promise<T>,
	deadlineMs: number,
	message: string,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => reject(new Error(message)), deadlineMs);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timeoutId !== undefined) clearTimeout(timeoutId);
	});
}

function toFolderTaskDocument(
	rootPath: string,
	aggregationRoot: string,
	file: FolderMarkdownTaskFile,
): FolderTaskDocument {
	const displayRelativePath = relativePathWithinAggregationRoot(
		aggregationRoot,
		file.relativePath,
	);
	const rootTasks = file.tasks.filter((task) => task.sectionPath.length === 0);
	return {
		name: getNameFromPath(file.relativePath),
		path: joinProjectPath(rootPath, displayRelativePath),
		relativeDirectory: getRelativeDirectory(displayRelativePath),
		relativePath: displayRelativePath,
		tree: {
			root: {
				id: `${file.relativePath}:section-root`,
				title: null,
				level: 0,
				tasks: rootTasks.map(toTaskItem),
				children: file.sections.map(toTaskSection),
			},
			stats: {
				completed: file.stats.completed,
				completedInDiff: 0,
				remaining: file.stats.remaining,
				total: file.stats.total,
			},
		},
	};
}

function toTaskSection(section: FolderMarkdownTaskSection): TaskSection {
	return {
		id: section.id,
		title: section.title,
		level: section.level,
		tasks: section.tasks.map(toTaskItem),
		children: section.children.map(toTaskSection),
	};
}

function toTaskItem(task: FolderMarkdownTaskItem) {
	return {
		id: task.id,
		label: task.label,
		checked: task.checked,
		depth: task.depth,
		lineNumber: task.lineNumber,
		completedInDiff: false,
	};
}

function relativePathWithinAggregationRoot(
	aggregationRoot: string,
	relativePath: string,
): string {
	if (aggregationRoot === '.' || aggregationRoot.length === 0) {
		return relativePath;
	}
	const prefix = `${aggregationRoot}/`;
	return relativePath.startsWith(prefix)
		? relativePath.slice(prefix.length)
		: relativePath;
}

function joinProjectPath(rootPath: string, relativePath: string): string {
	if (relativePath === '.' || relativePath.length === 0) {
		return normalizePath(rootPath);
	}
	return `${normalizePath(rootPath)}/${relativePath}`;
}

function countTaskDirectories(
	files: readonly FolderMarkdownTaskFile[],
): number {
	const directories = new Set<string>(['.']);
	for (const file of files) {
		let directory = getRelativeDirectory(file.relativePath);
		while (directory !== '.') {
			directories.add(directory);
			directory = getRelativeDirectory(directory);
		}
	}
	return directories.size;
}

function collectTaskWatchDirectories(
	rootPath: string,
	aggregationRoot: string,
	files: readonly FolderMarkdownTaskFile[],
): string[] {
	const directories = new Set<string>([normalizePath(rootPath)]);
	for (const file of files) {
		const relativePath = relativePathWithinAggregationRoot(
			aggregationRoot,
			file.relativePath,
		);
		const directory = getRelativeDirectory(relativePath);
		if (directory !== '.') {
			directories.add(joinProjectPath(rootPath, directory));
		}
	}
	return [...directories];
}

function toFileUrl(path: string): string {
	const normalized = path.replace(/\\/g, '/');
	const prefixed = /^[a-zA-Z]:\//.test(normalized)
		? `file:///${normalized}`
		: normalized.startsWith('/')
			? `file://${normalized}`
			: `file://${normalized}`;
	return encodeURI(prefixed);
}

async function listDirectoryNodes(
	rootPath: string,
	targetPath: string,
	fileViewerClient: FileViewerClient,
	projectId: string,
): Promise<FolderTreeNode[]> {
		const page = await fileViewerClient.listFolder(
			toRelativePath(rootPath, targetPath),
			projectId,
		);
		return page.entries.map((entry) => {
			const path = joinProjectPath(rootPath, entry.relativePath);
			const stats: FolderNodeStats = {
				createdAtMs: entry.mtimeMs ?? null,
				mode: entry.mode ?? null,
				modifiedAtMs: entry.mtimeMs ?? null,
				size: entry.size,
			};
			if (entry.kind === 'directory') {
				return {
					kind: 'directory',
					children: [],
					childrenLoaded: false,
					isSymbolicLink: entry.isSymbolicLink,
					name: entry.name,
					path,
					relativePath: toRelativePath(rootPath, path),
					stats,
				} satisfies FolderDirectoryNode;
			}
			const extension = getExtension(entry.name);
			return {
				kind: 'file',
				extension,
				isImage: IMAGE_EXTENSIONS.has(extension),
				name: entry.name,
				path,
				relativePath: toRelativePath(rootPath, path),
				stats,
			} satisfies FolderFileNode;
		});
}

function upsertDirectoryNode(
	root: FolderDirectoryNode,
	targetPath: string,
	updater: (node: FolderDirectoryNode) => FolderDirectoryNode,
): FolderDirectoryNode {
	if (root.path === targetPath) {
		return updater(root);
	}

	let hasChanged = false;
	const nextChildren = root.children.map((child) => {
		if (child.kind !== 'directory') {
			return child;
		}
		const updatedChild = upsertDirectoryNode(child, targetPath, updater);
		if (updatedChild !== child) {
			hasChanged = true;
		}
		return updatedChild;
	});

	if (!hasChanged) {
		return root;
	}

	return {
		...root,
		children: nextChildren,
	};
}

function TreeNode({
	node,
	depth,
	onOpenFile,
	onOpenFolder,
	onExpandDirectory,
	onContextMenu,
}: {
	node: FolderTreeNode;
	depth: number;
	onOpenFile: (path: string) => void;
	onOpenFolder: (path: string) => void;
	onExpandDirectory: (path: string) => void;
	onContextMenu: (
		event: MouseEvent,
		path: string,
		isDirectory: boolean,
	) => void;
}) {
	if (node.kind === 'file') {
		return (
			<button
				type="button"
				className="folder-viewer__tree-file"
				style={{ paddingInlineStart: `${12 + depth * 16}px` }}
				onDoubleClick={() => onOpenFile(node.path)}
				onContextMenu={(e) => onContextMenu(e, node.path, false)}
				title={node.path}
			>
				<span className="folder-viewer__tree-chevron" aria-hidden="true" />
				<span className="folder-viewer__tree-icon" aria-hidden="true">
					<FileTypeIcon name={node.name} />
				</span>
				<span className="folder-viewer__tree-name">{node.name}</span>
				<span className="folder-viewer__tree-path">{node.relativePath}</span>
			</button>
		);
	}

	return (
		<details
			className="folder-viewer__tree-directory"
			onToggle={(event) => {
				if (event.currentTarget.open) {
					onExpandDirectory(node.path);
				}
			}}
		>
			<summary
				className="folder-viewer__tree-summary"
				style={{ paddingInlineStart: `${12 + depth * 16}px` }}
				onDoubleClick={() => onOpenFolder(node.path)}
				onContextMenu={(e) => onContextMenu(e, node.path, true)}
			>
				<span className="folder-viewer__tree-chevron" aria-hidden="true">
					<ChevronIcon />
				</span>
				<span
					className="folder-viewer__tree-icon folder-viewer__tree-icon--directory"
					aria-hidden="true"
				>
					{node.isSymbolicLink ? <SymlinkIcon /> : <FolderIcon />}
				</span>
				<span className="folder-viewer__tree-name">{node.name}</span>
				<span className="folder-viewer__tree-path">{node.relativePath}</span>
			</summary>
			{node.isLoadingChildren ? (
				<div
					className="folder-viewer__tree-warning"
					style={{ paddingInlineStart: `${44 + depth * 16}px` }}
				>
					Loading…
				</div>
			) : null}
			{node.loadError ? (
				<div
					className="folder-viewer__tree-warning"
					style={{ paddingInlineStart: `${44 + depth * 16}px` }}
				>
					{node.loadError}
				</div>
			) : null}
			{node.childrenLoaded && node.children.length === 0 ? (
				<div
					className="folder-viewer__tree-warning"
					style={{ paddingInlineStart: `${44 + depth * 16}px` }}
				>
					Empty folder
				</div>
			) : null}
			{node.children.map((child) => (
				<TreeNode
					key={child.path}
					node={child}
					depth={depth + 1}
					onOpenFile={onOpenFile}
					onOpenFolder={onOpenFolder}
					onExpandDirectory={onExpandDirectory}
					onContextMenu={onContextMenu}
				/>
			))}
		</details>
	);
}

function FileGridCard({
	node,
	mode,
	onOpenFile,
	onOpenFolder,
	onContextMenu,
}: {
	node: FolderTreeNode;
	mode: 'thumbnail' | 'gallery';
	onOpenFile: (path: string) => void;
	onOpenFolder: (path: string) => void;
	onContextMenu: (
		event: MouseEvent,
		path: string,
		isDirectory: boolean,
	) => void;
}) {
	const isDirectory = node.kind === 'directory';
	const previewUrl = !isDirectory && node.isImage ? toFileUrl(node.path) : null;

	return (
		<button
			type="button"
			className={`folder-viewer__card folder-viewer__card--${mode}${isDirectory ? ' folder-viewer__card--directory' : ''}`}
			onDoubleClick={() =>
				isDirectory ? onOpenFolder(node.path) : onOpenFile(node.path)
			}
			onContextMenu={(e) => onContextMenu(e, node.path, isDirectory)}
			title={node.path}
		>
			{previewUrl ? (
				<img
					src={previewUrl}
					alt={node.relativePath}
					loading="lazy"
					className="folder-viewer__card-image"
				/>
			) : (
				<div className="folder-viewer__card-placeholder" aria-hidden="true">
					{isDirectory ? (
						<div
							className="folder-viewer__tree-icon--directory"
							style={{ transform: 'scale(2.5)' }}
						>
							<FolderIcon />
						</div>
					) : (node as FolderFileNode).extension ? (
						(node as FolderFileNode).extension.replace('.', '').toUpperCase()
					) : (
						'FILE'
					)}
				</div>
			)}
			<div className="folder-viewer__card-meta">
				<div className="folder-viewer__card-name">
					<span
						className={`folder-viewer__tree-icon${isDirectory ? ' folder-viewer__tree-icon--directory' : ''}`}
						style={{ transform: 'scale(0.9)' }}
					>
						{isDirectory ? <FolderIcon /> : <FileTypeIcon name={node.name} />}
					</span>
					{node.name}
				</div>
				<div className="folder-viewer__card-path">{node.relativePath}</div>
			</div>
		</button>
	);
}

function FolderSizeCell({
	entry,
	node,
	onRecalculate,
}: {
	entry: FolderSizeEntry | undefined;
	node: FolderDirectoryNode;
	onRecalculate: (node: FolderDirectoryNode) => void;
}) {
	if (entry?.status === 'done') {
		return <>{formatFileSize(entry.size)}</>;
	}

	if (entry?.status === 'pending') {
		return (
			<span
				className="folder-viewer__size-pending"
				title="Calculating folder size"
			>
				…
			</span>
		);
	}

	return (
		<button
			type="button"
			className="folder-viewer__size-retry"
			title="Click to calculate folder size"
			onClick={(event) => {
				event.stopPropagation();
				onRecalculate(node);
			}}
			onDoubleClick={(event) => event.stopPropagation()}
		>
			—
		</button>
	);
}

function dispatchOpenFile(path: string, initialMode?: FileViewerMode) {
	window.dispatchEvent(
		new CustomEvent<{ initialMode?: FileViewerMode; path: string }>(
			'terminay-open-file',
			{
				detail: { initialMode, path },
			},
		),
	);
}

export function FolderPanel(
	props: IDockviewPanelProps<
		FolderPanelInstanceParams & {
			onRename?: (path: string) => void;
			onDelete?: (path: string) => void;
			onNewFile?: (dirPath: string) => void;
			onNewFolder?: (dirPath: string) => void;
			onOpenTerminal?: (path: string) => void;
			onCopyPath?: (path: string) => void;
			onCopyRelativePath?: (path: string) => void;
			projectRootPath?: string;
		}
	>,
) {
	const terminalClientContext = useContext(TerminalPanelClientContext);
	if (
		terminalClientContext?.fileViewerClient === undefined ||
		terminalClientContext.fileObservationClient === undefined ||
		terminalClientContext.projectId.length === 0 ||
		terminalClientContext.projectRoot === undefined
	) {
		return <FileAuthorityUnavailableState feature="Folder viewer" />;
	}
	return (
		<CanonicalFolderPanel
			{...props}
			terminalClientContext={{
				...terminalClientContext,
				fileObservationClient: terminalClientContext.fileObservationClient,
				fileViewerClient: terminalClientContext.fileViewerClient,
				projectRoot: terminalClientContext.projectRoot,
			}}
		/>
	);
}

function CanonicalFolderPanel(
	props: IDockviewPanelProps<
		FolderPanelInstanceParams & {
			onRename?: (path: string) => void;
			onDelete?: (path: string) => void;
			onNewFile?: (dirPath: string) => void;
			onNewFolder?: (dirPath: string) => void;
			onOpenTerminal?: (path: string) => void;
			onCopyPath?: (path: string) => void;
			onCopyRelativePath?: (path: string) => void;
			projectRootPath?: string;
		}
	> & {
		terminalClientContext: TerminalPanelClientContextValue & {
			fileObservationClient: NonNullable<TerminalPanelClientContextValue['fileObservationClient']>;
			fileViewerClient: NonNullable<TerminalPanelClientContextValue['fileViewerClient']>;
			projectRoot: string;
		};
	},
) {
	const { terminalClientContext } = props;
	const {
		folderPath,
		color,
		projectColor,
		onRename,
		onDelete,
		onNewFile,
		onNewFolder,
		onOpenTerminal,
		onCopyPath,
		onCopyRelativePath,
	} = props.params;
	const projectId = terminalClientContext.projectId;
	const projectRootPath = terminalClientContext.projectRoot;
	const fileViewerClient = terminalClientContext.fileViewerClient;
	const { settings } = useTerminalSettings();
	const [treeRoot, setTreeRoot] = useState<FolderDirectoryNode | null>(null);
	const [viewMode, setViewMode] = useState<FolderViewMode>('tree');
	const [isTreeLoading, setIsTreeLoading] = useState(true);
	const [treeErrorText, setTreeErrorText] = useState<string | null>(null);
	const [refreshNonce, setRefreshNonce] = useState(0);
	const [taskScanRefreshNonce, setTaskScanRefreshNonce] = useState(0);
	const [taskDocuments, setTaskDocuments] = useState<FolderTaskDocument[]>([]);
	const [isTaskScanLoading, setIsTaskScanLoading] = useState(false);
	const [taskScanErrorText, setTaskScanErrorText] = useState<string | null>(
		null,
	);
	const [taskWatchedDirectories, setTaskWatchedDirectories] = useState<
		string[]
	>([]);
	const [taskScanStats, setTaskScanStats] = useState({
		ignoredDirectoryCount: 0,
		scannedDirectoryCount: 0,
		scannedMarkdownCount: 0,
	});
	const previousFocusRef = useRef<boolean | null>(null);
	const treeLoadRequestRef = useRef(0);
	const [pathDraft, setPathDraft] = useState<string | null>(null);
	const pathInputRef = useRef<HTMLInputElement | null>(null);

	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		path: string;
		isDirectory: boolean;
	} | null>(null);
	const sizeModalAbortRef = useRef<AbortController | null>(null);

	const [folderSizes, setFolderSizes] = useState<
		Record<string, FolderSizeEntry>
	>({});
	const [listSort, setListSort] = useState<ListSort>({
		direction: 'asc',
		key: 'name',
	});

	const handleToggleListSort = useCallback((key: ListSortKey) => {
		setListSort((current) =>
			current.key === key
				? { direction: current.direction === 'asc' ? 'desc' : 'asc', key }
				: { direction: 'asc', key },
		);
	}, []);

	const sortedListNodes = useMemo(() => {
		if (!treeRoot) {
			return [];
		}
		return sortListNodes(treeRoot.children, listSort, folderSizes);
	}, [folderSizes, listSort, treeRoot]);
	const [sizeModal, setSizeModal] = useState<{
		entryCount: number;
		jobId: string;
		name: string;
		path: string;
		size: number;
	} | null>(null);
	const autoSizeTreeRef = useRef<FolderDirectoryNode | null>(null);

	useEffect(() => {
		if (
			viewMode !== 'list' ||
			!treeRoot ||
			autoSizeTreeRef.current === treeRoot
		) {
			return;
		}
		autoSizeTreeRef.current = treeRoot;

		const directories = treeRoot.children.filter(
			(child): child is FolderDirectoryNode => child.kind === 'directory',
		);
		if (directories.length === 0) {
			return;
		}

		const activeJobIds = new Map<string, string>();
		const activeControllers = new Map<string, AbortController>();
		setFolderSizes(
			Object.fromEntries(
				directories.map((directory) => [
					directory.path,
					{ status: 'pending' as const },
				]),
			),
		);

		for (const directory of directories) {
			const jobId = crypto.randomUUID();
			activeJobIds.set(directory.path, jobId);
			const controller = new AbortController();
			activeControllers.set(directory.path, controller);
			const calculation = observeServerFolderSize(
				terminalClientContext.fileObservationClient,
				projectId,
				projectRootPath,
				directory.path,
				controller.signal,
			).then((result) => ({ cancelled: false, ...result }));
			void calculation
				.then((result) => {
					activeJobIds.delete(directory.path);
					activeControllers.delete(directory.path);
					setFolderSizes((current) => ({
						...current,
						[directory.path]: result.cancelled
							? { status: 'timeout' }
							: { size: result.size, status: 'done' },
					}));
				})
				.catch(() => {
					activeJobIds.delete(directory.path);
					activeControllers.delete(directory.path);
					setFolderSizes((current) => ({
						...current,
						[directory.path]: { status: 'timeout' },
					}));
				});
		}

		const deadlineId = window.setTimeout(() => {
			for (const [path] of activeJobIds) {
				activeControllers.get(path)?.abort();
			}
		}, FOLDER_SIZE_DEADLINE_MS);

		return () => {
			window.clearTimeout(deadlineId);
			for (const [path] of activeJobIds) {
				activeControllers.get(path)?.abort();
			}
		};
	}, [
		projectId,
		projectRootPath,
		terminalClientContext.fileObservationClient,
		treeRoot,
		viewMode,
	]);

	const handleCancelSizeModal = useCallback(() => {
		sizeModalAbortRef.current?.abort();
		sizeModalAbortRef.current = null;
		setSizeModal(null);
	}, []);

	const handleRecalculateFolderSize = useCallback(
		(node: FolderDirectoryNode) => {
			const jobId = crypto.randomUUID();
			setSizeModal({
				entryCount: 0,
				jobId,
				name: node.name,
				path: node.path,
				size: 0,
			});
			const controller = new AbortController();
			sizeModalAbortRef.current = controller;
			const calculation = observeServerFolderSize(
					terminalClientContext.fileObservationClient,
					projectId,
					projectRootPath,
					node.path,
					controller.signal,
					(entryCount, size) => {
						setSizeModal((current) =>
							current?.jobId === jobId
								? { ...current, entryCount, size }
								: current,
						);
					},
				).then((result) => ({ cancelled: false, ...result }));
			void calculation
				.then((result) => {
					if (!result.cancelled) {
						setFolderSizes((current) => ({
							...current,
							[node.path]: { size: result.size, status: 'done' },
						}));
					}
					sizeModalAbortRef.current = null;
					setSizeModal((current) =>
						current?.jobId === jobId ? null : current,
					);
				})
				.catch(() => {
					sizeModalAbortRef.current = null;
					setSizeModal((current) =>
						current?.jobId === jobId ? null : current,
					);
				});
		},
		[
			projectId,
			projectRootPath,
			terminalClientContext.fileObservationClient,
		],
	);

	const handleContextMenu = (
		event: MouseEvent,
		path: string,
		isDirectory: boolean,
	) => {
		event.preventDefault();
		event.stopPropagation();
		setContextMenu({
			x: event.clientX,
			y: event.clientY,
			path,
			isDirectory,
		});
	};

	const folderTitle = useMemo(() => getNameFromPath(folderPath), [folderPath]);
	const ignoredDirectoryPatterns = useMemo(
		() =>
			parseIgnoredDirectoryPatterns(
				settings.fileViewer.folderTaskIgnoredDirectories,
			),
		[settings.fileViewer.folderTaskIgnoredDirectories],
	);
	const folderTaskRefreshIntervalMs =
		Math.max(1, settings.fileViewer.refreshIntervalSeconds) * 1000;

	const summaryText = useMemo(() => {
		if (!treeRoot) {
			return 'Scanning...';
		}
		const files = treeRoot.children.filter((c) => c.kind === 'file').length;
		const folders = treeRoot.children.filter(
			(c) => c.kind === 'directory',
		).length;
		return `${files} files · ${folders} folders`;
	}, [treeRoot]);

	useEffect(() => {
		props.api.setTitle(folderTitle);
	}, [folderTitle, props.api]);

	const isFocused = props.containerApi.activePanel?.id === props.api.id;
	useEffect(() => {
		if (previousFocusRef.current === isFocused) {
			return;
		}
		previousFocusRef.current = isFocused;
		props.api.updateParameters({
			...props.params,
			isFocused,
		});
	}, [isFocused, props]);

	useEffect(() => {
		let isMounted = true;
		// Folder navigation can change while the previous catalog request is
		// still resolving. A refresh nonce alone is not unique across paths, so
		// use a monotonic request id to prevent an older folder response from
		// replacing the newly selected path.
		const requestId = treeLoadRequestRef.current + 1;
		treeLoadRequestRef.current = requestId;
		setIsTreeLoading(true);
		setTreeErrorText(null);
		setTreeRoot(null);

		const rootNode: FolderDirectoryNode = {
			kind: 'directory',
			children: [],
			childrenLoaded: false,
			name: getNameFromPath(folderPath),
			path: folderPath,
			relativePath: '.',
		};

		void listDirectoryNodes(
			projectRootPath ?? folderPath,
			folderPath,
			fileViewerClient,
			projectId,
		)
			.then((children) => {
				if (!isMounted || treeLoadRequestRef.current !== requestId) {
					return;
				}
				setTreeRoot({
					...rootNode,
					children,
					childrenLoaded: true,
				});
			})
			.catch((error) => {
				if (!isMounted || treeLoadRequestRef.current !== requestId) {
					return;
				}
				setTreeRoot(null);
				setTreeErrorText(
					error instanceof Error ? error.message : String(error),
				);
			})
			.finally(() => {
				if (isMounted && treeLoadRequestRef.current === requestId) {
					setIsTreeLoading(false);
				}
			});

		return () => {
			isMounted = false;
		};
	}, [fileViewerClient, folderPath, projectId, projectRootPath, refreshNonce]);

	useEffect(() => {
		if (viewMode !== 'tasks') {
			return;
		}

		let isMounted = true;
		const controller = new AbortController();
		setIsTaskScanLoading(true);
		setTaskScanErrorText(null);

		void scanFolderTasks(
			folderPath,
			projectRootPath ?? folderPath,
			ignoredDirectoryPatterns,
			fileViewerClient,
			projectId,
			controller.signal,
		)
			.then((result) => {
				if (!isMounted) {
					return;
				}
				setTaskDocuments(result.documents);
				setTaskScanErrorText(result.errorText);
				setTaskWatchedDirectories(result.watchedDirectories);
				setTaskScanStats({
					ignoredDirectoryCount: result.ignoredDirectoryCount,
					scannedDirectoryCount: result.scannedDirectoryCount,
					scannedMarkdownCount: result.scannedMarkdownCount,
				});
			})
			.catch((error) => {
				if (!isMounted) {
					return;
				}
				setTaskDocuments([]);
				setTaskWatchedDirectories([]);
				setTaskScanErrorText(
					error instanceof Error ? error.message : String(error),
				);
				setTaskScanStats({
					ignoredDirectoryCount: 0,
					scannedDirectoryCount: 0,
					scannedMarkdownCount: 0,
				});
			})
			.finally(() => {
				if (isMounted) {
					setIsTaskScanLoading(false);
				}
			});

		return () => {
			isMounted = false;
			controller.abort();
		};
	}, [
		fileViewerClient,
		folderPath,
		ignoredDirectoryPatterns,
		projectId,
		projectRootPath,
		taskScanRefreshNonce,
		viewMode,
	]);

	useEffect(() => {
		if (viewMode !== 'tasks' || taskWatchedDirectories.length === 0) {
			return;
		}

		const watchedDirectories = Array.from(new Set(taskWatchedDirectories));
		let refreshTimeoutId: number | null = null;
		let lastRefreshAt = 0;

		const scheduleRefresh = () => {
			if (refreshTimeoutId !== null) {
				return;
			}

			const elapsedSinceLastRefresh = Date.now() - lastRefreshAt;
			const delay =
				elapsedSinceLastRefresh >= folderTaskRefreshIntervalMs
					? 0
					: folderTaskRefreshIntervalMs - elapsedSinceLastRefresh;

			refreshTimeoutId = window.setTimeout(() => {
				refreshTimeoutId = null;
				lastRefreshAt = Date.now();
				setTaskScanRefreshNonce((current) => current + 1);
			}, delay);
		};

		let disposed = false;
		const cleanups: Array<() => void> = [];
		void Promise.all(
			watchedDirectories.map(async (directoryPath) => {
				const handle = await terminalClientContext.fileObservationClient.startWatch(
					projectId,
					toRelativePath(projectRootPath, directoryPath),
				);
				if (disposed) {
					await terminalClientContext.fileObservationClient.stopWatch(handle.subscriptionId);
					return;
				}
				const unsubscribe = await terminalClientContext.fileObservationClient.subscribeWatch(
					handle,
					scheduleRefresh,
					scheduleRefresh,
				);
				cleanups.push(() => {
					unsubscribe();
					void terminalClientContext.fileObservationClient.stopWatch(handle.subscriptionId);
				});
			}),
		).catch(scheduleRefresh);
		return () => {
			disposed = true;
			for (const cleanup of cleanups) cleanup();
			if (refreshTimeoutId !== null) window.clearTimeout(refreshTimeoutId);
		};
	}, [
		folderTaskRefreshIntervalMs,
		projectId,
		projectRootPath,
		taskWatchedDirectories,
		terminalClientContext.fileObservationClient,
		viewMode,
	]);

	const handleExpandDirectory = useCallback(
		(directoryPath: string) => {
			setTreeRoot((currentRoot) => {
				if (!currentRoot) {
					return currentRoot;
				}
				return upsertDirectoryNode(currentRoot, directoryPath, (node) => {
					if (
						node.childrenLoaded ||
						node.isLoadingChildren ||
						node.isSymbolicLink
					) {
						return node;
					}
					return {
						...node,
						isLoadingChildren: true,
						loadError: undefined,
					};
				});
			});

			void listDirectoryNodes(
				projectRootPath ?? folderPath,
				directoryPath,
				fileViewerClient,
				projectId,
			)
				.then((children) => {
					setTreeRoot((currentRoot) => {
						if (!currentRoot) {
							return currentRoot;
						}
						return upsertDirectoryNode(currentRoot, directoryPath, (node) => ({
							...node,
							children,
							childrenLoaded: true,
							isLoadingChildren: false,
							loadError: undefined,
						}));
					});
				})
				.catch((error) => {
					setTreeRoot((currentRoot) => {
						if (!currentRoot) {
							return currentRoot;
						}
						return upsertDirectoryNode(currentRoot, directoryPath, (node) => ({
							...node,
							isLoadingChildren: false,
							loadError: error instanceof Error ? error.message : String(error),
						}));
					});
				});
		},
		[fileViewerClient, folderPath, projectId, projectRootPath],
	);

	const handleOpenFolder = useCallback(
		(path: string) => {
			props.api.updateParameters({
				...props.params,
				folderPath: path,
			});
		},
		[props.api, props.params],
	);

	const parentPath = useMemo(() => getParentPath(folderPath), [folderPath]);

	const isEditingPath = pathDraft !== null;
	useEffect(() => {
		if (isEditingPath) {
			pathInputRef.current?.focus();
			pathInputRef.current?.select();
		}
	}, [isEditingPath]);

	const commitPathDraft = () => {
		if (pathDraft === null) {
			return;
		}
		const trimmed = pathDraft.trim();
		setPathDraft(null);
		if (trimmed && normalizePath(trimmed) !== normalizePath(folderPath)) {
			handleOpenFolder(trimmed);
		}
	};

	const renderBody = () => {
		if (viewMode === 'tasks') {
			return (
				<FolderTasksViewer
					documents={taskDocuments}
					errorText={taskScanErrorText}
					ignoredDirectoryCount={taskScanStats.ignoredDirectoryCount}
					isLoading={isTaskScanLoading}
					onOpenFile={dispatchOpenFile}
					onOpenTerminal={onOpenTerminal}
					projectRootPath={projectRootPath ?? folderPath}
					onRefresh={() => setTaskScanRefreshNonce((current) => current + 1)}
					scannedDirectoryCount={taskScanStats.scannedDirectoryCount}
					scannedMarkdownCount={taskScanStats.scannedMarkdownCount}
				/>
			);
		}

		if (isTreeLoading) {
			return (
				<div className="folder-viewer__state">
					<div className="folder-viewer__state-title">Scanning folder</div>
					<div className="folder-viewer__state-copy">Please wait...</div>
				</div>
			);
		}

		if (treeErrorText) {
			return (
				<div className="folder-viewer__state">
					<div className="folder-viewer__state-title">
						Unable to load folder
					</div>
					<div className="folder-viewer__state-copy">{treeErrorText}</div>
					<button
						type="button"
						className="folder-viewer__action"
						onClick={() => setRefreshNonce((current) => current + 1)}
					>
						Retry
					</button>
				</div>
			);
		}

		const canListWhileEmpty = viewMode === 'list' && parentPath !== null;
		if (!treeRoot || (treeRoot.children.length === 0 && !canListWhileEmpty)) {
			return (
				<div className="folder-viewer__state">
					<div className="folder-viewer__state-title">No files found</div>
					<div className="folder-viewer__state-copy">
						This folder has no files to preview yet.
					</div>
				</div>
			);
		}

		if (viewMode === 'tree') {
			return (
				<div
					className="folder-viewer__tree"
					onContextMenu={(e) => handleContextMenu(e, folderPath, true)}
				>
					{treeRoot.children.map((node) => (
						<TreeNode
							key={node.path}
							node={node}
							depth={0}
							onOpenFile={dispatchOpenFile}
							onOpenFolder={handleOpenFolder}
							onExpandDirectory={handleExpandDirectory}
							onContextMenu={handleContextMenu}
						/>
					))}
				</div>
			);
		}

		const nodes = treeRoot.children;

		if (viewMode === 'list') {
			const sortButton = (
				label: string,
				key: ListSortKey,
				alignRight = false,
			) => (
				<button
					type="button"
					className={`folder-viewer__list-sort${alignRight ? ' folder-viewer__list-sort--right' : ''}`}
					onClick={() => handleToggleListSort(key)}
					title={`Sort by ${label.toLowerCase()}`}
				>
					{label}
					{listSort.key === key ? (
						<span className="folder-viewer__list-sort-arrow" aria-hidden="true">
							{listSort.direction === 'asc' ? '▲' : '▼'}
						</span>
					) : null}
				</button>
			);
			const suppressDoubleClickSelection = (event: MouseEvent) => {
				if (event.detail > 1) {
					event.preventDefault();
				}
			};

			return (
				<div
					className="folder-viewer__list"
					onContextMenu={(e) => handleContextMenu(e, folderPath, true)}
				>
					<div className="folder-viewer__list-row folder-viewer__list-header">
						<div>{sortButton('Name', 'name')}</div>
						<div>{sortButton('Type', 'type')}</div>
						<div className="folder-viewer__list-cell--right">
							{sortButton('Size', 'size', true)}
						</div>
						<div>{sortButton('Date Modified', 'modified')}</div>
						<div>{sortButton('Date Created', 'created')}</div>
						<div>{sortButton('Permissions', 'permissions')}</div>
					</div>
					{parentPath ? (
						<div
							className="folder-viewer__list-row folder-viewer__list-row--up"
							onDoubleClick={() => handleOpenFolder(parentPath)}
							onMouseDown={suppressDoubleClickSelection}
							title={parentPath}
						>
							<div className="folder-viewer__list-name">
								<span
									className="folder-viewer__tree-icon folder-viewer__tree-icon--directory"
									aria-hidden="true"
								>
									<FolderIcon />
								</span>
								..
							</div>
							<div className="folder-viewer__list-cell">folder</div>
							<div className="folder-viewer__list-cell folder-viewer__list-cell--right">
								—
							</div>
							<div className="folder-viewer__list-cell">—</div>
							<div className="folder-viewer__list-cell">—</div>
							<div className="folder-viewer__list-cell folder-viewer__list-cell--mono">
								—
							</div>
						</div>
					) : null}
					{sortedListNodes.map((node) => {
						const isDirectory = node.kind === 'directory';
						const stats = node.stats;
						return (
							<div
								key={node.path}
								className="folder-viewer__list-row"
								onDoubleClick={() =>
									isDirectory
										? handleOpenFolder(node.path)
										: dispatchOpenFile(node.path)
								}
								onMouseDown={suppressDoubleClickSelection}
								onContextMenu={(e) =>
									handleContextMenu(e, node.path, isDirectory)
								}
								title={node.path}
							>
								<div className="folder-viewer__list-name">
									<span
										className={`folder-viewer__tree-icon${isDirectory ? ' folder-viewer__tree-icon--directory' : ''}`}
									>
										{isDirectory ? (
											<FolderIcon />
										) : (
											<FileTypeIcon name={node.name} />
										)}
									</span>
									{node.name}
								</div>
								<div className="folder-viewer__list-cell">
									{getMimeLabel(node)}
								</div>
								<div className="folder-viewer__list-cell folder-viewer__list-cell--right">
									{node.kind === 'directory' ? (
										<FolderSizeCell
											entry={folderSizes[node.path]}
											node={node}
											onRecalculate={handleRecalculateFolderSize}
										/>
									) : (
										formatFileSize(stats?.size)
									)}
								</div>
								<div className="folder-viewer__list-cell">
									{formatTimestamp(stats?.modifiedAtMs)}
								</div>
								<div className="folder-viewer__list-cell">
									{formatTimestamp(stats?.createdAtMs)}
								</div>
								<div className="folder-viewer__list-cell folder-viewer__list-cell--mono">
									{formatPermissions(
										stats?.mode,
										isDirectory,
										isDirectory && node.isSymbolicLink === true,
									)}
								</div>
							</div>
						);
					})}
				</div>
			);
		}

		return (
			<div
				className={`folder-viewer__grid folder-viewer__grid--${viewMode}`}
				onContextMenu={(e) => handleContextMenu(e, folderPath, true)}
			>
				{nodes.map((node) => (
					<FileGridCard
						key={node.path}
						node={node}
						mode={viewMode === 'thumbnail' ? 'thumbnail' : 'gallery'}
						onOpenFile={dispatchOpenFile}
						onOpenFolder={handleOpenFolder}
						onContextMenu={handleContextMenu}
					/>
				))}
			</div>
		);
	};

	return (
		<div
			className="folder-viewer"
			style={
				{ '--tab-color': color ?? projectColor ?? '#717b85' } as CSSProperties
			}
		>
			<div className="folder-viewer__toolbar">
				<div className="folder-viewer__toolbar-left">
					<div className="folder-viewer__title">{folderTitle}</div>
					{isEditingPath ? (
						<input
							ref={pathInputRef}
							className="folder-viewer__path-input"
							value={pathDraft ?? ''}
							onChange={(event) => setPathDraft(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter') {
									event.preventDefault();
									commitPathDraft();
								} else if (event.key === 'Escape') {
									event.preventDefault();
									setPathDraft(null);
								}
							}}
							onBlur={() => setPathDraft(null)}
							spellCheck={false}
							aria-label="Folder path"
						/>
					) : (
						<>
							<button
								type="button"
								className="folder-viewer__meta folder-viewer__path-button"
								title="Click to edit path"
								onClick={() => setPathDraft(folderPath)}
							>
								{folderPath}
							</button>
							<div className="folder-viewer__meta">·</div>
							<div className="folder-viewer__meta">{summaryText}</div>
						</>
					)}
				</div>
				<div className="folder-viewer__toolbar-right">
					<div className="folder-viewer__view-modes">
						{VIEW_MODES.map((mode) => (
							<button
								type="button"
								key={mode.mode}
								className={`folder-viewer__view-button${viewMode === mode.mode ? ' folder-viewer__view-button--active' : ''}`}
								onClick={() => setViewMode(mode.mode)}
							>
								{mode.label}
							</button>
						))}
					</div>
					<button
						type="button"
						className="folder-viewer__action"
						onClick={() => {
							if (viewMode === 'tasks') {
								setTaskScanRefreshNonce((current) => current + 1);
							} else {
								setRefreshNonce((current) => current + 1);
							}
						}}
					>
						Refresh
					</button>
				</div>
			</div>
			<div className="folder-viewer__body">{renderBody()}</div>

			{sizeModal && (
				<div className="project-edit-modal-backdrop">
					<div
						className="project-edit-modal folder-viewer__size-modal"
						role="dialog"
						aria-modal="true"
						aria-label={`Calculating size of ${sizeModal.name}`}
					>
						<div className="folder-viewer__size-modal-title">
							Calculating folder size
						</div>
						<div className="folder-viewer__size-modal-path">
							{sizeModal.path}
						</div>
						<div className="folder-viewer__size-modal-progress">
							<span
								className="folder-viewer__size-modal-spinner"
								aria-hidden="true"
							/>
							{formatFileSize(sizeModal.size)} ·{' '}
							{sizeModal.entryCount.toLocaleString()} items scanned
						</div>
						<div className="project-edit-actions">
							<button type="button" onClick={handleCancelSizeModal}>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			{contextMenu && (
				<ContextMenu
					x={contextMenu.x}
					y={contextMenu.y}
					onClose={() => setContextMenu(null)}
					items={
						[
							...(contextMenu.isDirectory
								? [
										{
											label: 'New File',
											icon: <PlusSquare size={14} />,
											onClick: () => onNewFile?.(contextMenu.path),
										},
										{
											label: 'New Folder',
											icon: <FolderPlus size={14} />,
											onClick: () => onNewFolder?.(contextMenu.path),
										},
										{ separator: true },
									]
								: []),
							{
								label: 'Rename',
								icon: <FileEdit size={14} />,
								onClick: () => onRename?.(contextMenu.path),
							},
							{
								label: 'Delete',
								icon: <Trash2 size={14} />,
								danger: true,
								onClick: () => onDelete?.(contextMenu.path),
							},
							{ separator: true },
							{
								label: 'Copy path',
								icon: <Copy size={14} />,
								onClick: () =>
									onCopyPath
										? onCopyPath(contextMenu.path)
										: void writeClipboardText(
												contextMenu.path,
											),
							},
							{
								label: 'Copy relative path',
								icon: <Copy size={14} />,
								onClick: () =>
									onCopyRelativePath
										? onCopyRelativePath(contextMenu.path)
										: void writeClipboardText(
												getPathRelativeToRoot(
													contextMenu.path,
													projectRootPath ?? folderPath,
												),
											),
							},
							{ separator: true },
							{
								label: 'Open shell in folder',
								icon: <Terminal size={14} />,
								onClick: () => onOpenTerminal?.(contextMenu.path),
							},
							{
								label: 'Reveal in OS',
								icon: <FolderOpen size={14} />,
								onClick: () =>
									void window.terminayRevealHost?.reveal(contextMenu.path),
							},
						].filter(Boolean) as ContextMenuItem[]
					}
				/>
			)}
		</div>
	);
}
