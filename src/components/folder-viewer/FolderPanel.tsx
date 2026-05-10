import {
	FileEdit,
	FolderPlus,
	PlusSquare,
	Terminal,
	Trash2,
} from 'lucide-react';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import type { IDockviewPanelProps } from 'dockview';
import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
	FolderDirectoryNode,
	FolderFileNode,
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

const VIEW_MODES: Array<{ mode: FolderViewMode; label: string }> = [
	{ mode: 'tree', label: 'Tree' },
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

function FileIcon() {
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
			<polyline points="13 2 13 9 20 9" />
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

function getExtension(name: string): string {
	const dotIndex = name.lastIndexOf('.');
	if (dotIndex <= 0) {
		return '';
	}
	return name.slice(dotIndex).toLowerCase();
}

function toRelativePath(rootPath: string, candidatePath: string): string {
	const normalizedRoot = normalizePath(rootPath);
	const normalizedCandidate = normalizePath(candidatePath);

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

function sortEntriesByTypeAndName(
	a: { isDirectory: boolean; name: string },
	b: { isDirectory: boolean; name: string },
) {
	if (a.isDirectory !== b.isDirectory) {
		return a.isDirectory ? -1 : 1;
	}
	return a.name.localeCompare(b.name, undefined, {
		sensitivity: 'base',
		numeric: true,
	});
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
): Promise<FolderTreeNode[]> {
	const entries = await window.terminay.listDirectory(targetPath);
	entries.sort(sortEntriesByTypeAndName);

	return entries.map((entry) => {
		const relativePath = toRelativePath(rootPath, entry.path);
		if (entry.isDirectory) {
			const directoryNode: FolderDirectoryNode = {
				kind: 'directory',
				children: [],
				childrenLoaded: false,
				isSymbolicLink: entry.isSymbolicLink,
				name: entry.name,
				path: entry.path,
				relativePath,
			};
			return directoryNode;
		}

		const extension = getExtension(entry.name);
		const fileNode: FolderFileNode = {
			kind: 'file',
			extension,
			isImage: IMAGE_EXTENSIONS.has(extension),
			name: entry.name,
			path: entry.path,
			relativePath,
		};
		return fileNode;
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
	onContextMenu: (event: MouseEvent, path: string, isDirectory: boolean) => void;
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
					<FileIcon />
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
	onContextMenu: (event: MouseEvent, path: string, isDirectory: boolean) => void;
}) {
	const isDirectory = node.kind === 'directory';
	const previewUrl =
		!isDirectory && node.isImage ? toFileUrl(node.path) : null;

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
						{isDirectory ? <FolderIcon /> : <FileIcon />}
					</span>
					{node.name}
				</div>
				<div className="folder-viewer__card-path">{node.relativePath}</div>
			</div>
		</button>
	);
}

function dispatchOpenFile(path: string) {
	window.dispatchEvent(
		new CustomEvent<{ path: string }>('terminay-open-file', {
			detail: { path },
		}),
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
		}
	>,
) {
	const {
		folderPath,
		onRename,
		onDelete,
		onNewFile,
		onNewFolder,
		onOpenTerminal,
	} = props.params;
	const [treeRoot, setTreeRoot] = useState<FolderDirectoryNode | null>(null);
	const [viewMode, setViewMode] = useState<FolderViewMode>('tree');
	const [isTreeLoading, setIsTreeLoading] = useState(true);
	const [treeErrorText, setTreeErrorText] = useState<string | null>(null);
	const [refreshNonce, setRefreshNonce] = useState(0);
	const previousFocusRef = useRef<boolean | null>(null);
	const treeLoadRequestRef = useRef(0);

	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		path: string;
		isDirectory: boolean;
	} | null>(null);

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

	const summaryText = useMemo(() => {
		if (!treeRoot) {
			return 'Scanning...';
		}
		const files = treeRoot.children.filter((c) => c.kind === 'file').length;
		const folders = treeRoot.children.filter((c) => c.kind === 'directory').length;
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
		const requestId = refreshNonce;
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

		void listDirectoryNodes(folderPath, folderPath)
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
				setTreeErrorText(error instanceof Error ? error.message : String(error));
			})
			.finally(() => {
				if (isMounted && treeLoadRequestRef.current === requestId) {
					setIsTreeLoading(false);
				}
			});

		return () => {
			isMounted = false;
		};
	}, [folderPath, refreshNonce]);

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

			void listDirectoryNodes(folderPath, directoryPath)
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
		[folderPath],
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

	const renderBody = () => {
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
					<div className="folder-viewer__state-title">Unable to load folder</div>
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

		if (!treeRoot || treeRoot.children.length === 0) {
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
			return (
				<div
					className="folder-viewer__list"
					onContextMenu={(e) => handleContextMenu(e, folderPath, true)}
				>
					{nodes.map((node) => (
						<button
							type="button"
							key={node.path}
							className="folder-viewer__list-row"
							onDoubleClick={() =>
								node.kind === 'directory'
									? handleOpenFolder(node.path)
									: dispatchOpenFile(node.path)
							}
							onContextMenu={(e) => handleContextMenu(e, node.path, node.kind === 'directory')}
							title={node.path}
						>
							<div className="folder-viewer__list-name">
								<span
									className={`folder-viewer__tree-icon${node.kind === 'directory' ? ' folder-viewer__tree-icon--directory' : ''}`}
								>
									{node.kind === 'directory' ? <FolderIcon /> : <FileIcon />}
								</span>
								{node.name}
							</div>
							<div className="folder-viewer__list-path">
								{node.relativePath}
							</div>
						</button>
					))}
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
		<div className="folder-viewer">
			<div className="folder-viewer__toolbar">
				<div className="folder-viewer__toolbar-left">
					<div className="folder-viewer__title">{folderTitle}</div>
					<div className="folder-viewer__meta">{folderPath}</div>
					<div className="folder-viewer__meta">·</div>
					<div className="folder-viewer__meta">{summaryText}</div>
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
						onClick={() => setRefreshNonce((current) => current + 1)}
					>
						Refresh
					</button>
				</div>
			</div>
			<div className="folder-viewer__body">{renderBody()}</div>

			{contextMenu && (
				<ContextMenu
					x={contextMenu.x}
					y={contextMenu.y}
					onClose={() => setContextMenu(null)}
					items={[
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
							label: 'Open terminal here',
							icon: <Terminal size={14} />,
							onClick: () => onOpenTerminal?.(contextMenu.path),
						},
					].filter(Boolean) as ContextMenuItem[]}
				/>
			)}
		</div>
	);
}
