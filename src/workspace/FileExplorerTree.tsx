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
	type JSX,
	type MouseEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import { ContextMenu, type ContextMenuItem } from '../components/ContextMenu';
import { FileTypeIcon } from '../fileIcons';
import type {
	FileExplorerEntry,
	FileExplorerGitStatus,
} from '../types/terminay';

const DROP_FILE_EXPLORER_PATH_EVENT = 'terminay-drop-file-explorer-path';
const FILE_EXPLORER_DRAG_THRESHOLD = 6;
const DOCKVIEW_TAB_BAR_DROP_TARGET_SELECTOR =
	'.workspace .dv-tabs-and-actions-container';
const DOCKVIEW_TAB_DROP_GHOST_MAX_WIDTH = 180;
const DOCKVIEW_TAB_DROP_GHOST_MIN_WIDTH = 96;

type DockviewTabDropGhost = {
	height: number;
	label: string;
	left: number;
	top: number;
	width: number;
};
function isPointInDockviewTabBar(clientX: number, clientY: number): boolean {
	return Array.from(
		document.querySelectorAll<HTMLElement>(
			DOCKVIEW_TAB_BAR_DROP_TARGET_SELECTOR,
		),
	).some((element) => {
		const rect = element.getBoundingClientRect();
		return (
			clientX >= rect.left &&
			clientX <= rect.right &&
			clientY >= rect.top &&
			clientY <= rect.bottom
		);
	});
}

function getDockviewTabDropGhost(
	clientX: number,
	clientY: number,
	label: string,
): DockviewTabDropGhost | null {
	const tabBars = Array.from(
		document.querySelectorAll<HTMLElement>(
			DOCKVIEW_TAB_BAR_DROP_TARGET_SELECTOR,
		),
	);
	const elementAtPoint = document.elementFromPoint(clientX, clientY);
	const tabBarFromPoint =
		elementAtPoint?.closest<HTMLElement>(
			DOCKVIEW_TAB_BAR_DROP_TARGET_SELECTOR,
		) ?? null;
	const tabBar =
		tabBarFromPoint ??
		tabBars.find((element) => {
			const rect = element.getBoundingClientRect();
			return (
				clientX >= rect.left &&
				clientX <= rect.right &&
				clientY >= rect.top &&
				clientY <= rect.bottom
			);
		}) ??
		tabBars.find((element) => {
			const rect = element.getBoundingClientRect();
			return (
				clientX >= rect.left &&
				clientX <= rect.right &&
				clientY >= rect.top - 12 &&
				clientY <= rect.bottom + 18
			);
		});
	if (!tabBar) {
		return null;
	}

	const tabBarRect = tabBar.getBoundingClientRect();
	const tabRects = Array.from(tabBar.querySelectorAll<HTMLElement>('.dv-tab'))
		.map((tab) => tab.getBoundingClientRect())
		.filter((rect) => rect.width > 0 && rect.height > 0);
	const addTabButtonRect = tabBar
		.querySelector<HTMLElement>('.terminay-add-tab-button')
		?.getBoundingClientRect();
	const rightmostTabEdge = tabRects.reduce(
		(right, rect) => Math.max(right, rect.right),
		tabBarRect.left,
	);
	const width = Math.min(
		DOCKVIEW_TAB_DROP_GHOST_MAX_WIDTH,
		Math.max(DOCKVIEW_TAB_DROP_GHOST_MIN_WIDTH, label.length * 8 + 42),
	);
	const left = addTabButtonRect
		? Math.min(addTabButtonRect.left, tabBarRect.right - width - 8)
		: Math.min(
				Math.max(rightmostTabEdge + 4, tabBarRect.left + 6),
				tabBarRect.right - width - 8,
			);

	return {
		height: addTabButtonRect
			? addTabButtonRect.height
			: Math.max(22, tabBarRect.height - 8),
		label,
		left,
		top: addTabButtonRect ? addTabButtonRect.top : tabBarRect.top + 4,
		width,
	};
}

type FileExplorerTreeProps = {
	directoryChildren: Record<string, FileExplorerEntry[]>;
	directoryErrors: Record<string, string>;
	expandedPaths: Record<string, boolean>;
	gitStatuses: Record<string, FileExplorerGitStatus>;
	loadingPaths: Record<string, boolean>;
	onOpenFile: (filePath: string) => void;
	onOpenFolder: (folderPath: string) => void;
	onToggleDirectory: (dirPath: string) => void;
	onRename: (path: string) => void;
	onDelete: (path: string) => void;
	onNewFile: (dirPath: string) => void;
	onNewFolder: (dirPath: string) => void;
	onOpenTerminal: (path: string) => void;
	onCopyPath: (path: string) => void;
	onCopyRelativePath: (path: string) => void;
	rootPath: string;
};

export function FileExplorerTree({
	directoryChildren,
	directoryErrors,
	expandedPaths,
	gitStatuses,
	loadingPaths,
	onOpenFile,
	onOpenFolder,
	onToggleDirectory,
	onRename,
	onDelete,
	onNewFile,
	onNewFolder,
	onOpenTerminal,
	onCopyPath,
	onCopyRelativePath,
	rootPath,
}: FileExplorerTreeProps) {
	const activeDragRef = useRef(false);
	const pendingDragRef = useRef<{
		name: string;
		path: string;
		isDirectory: boolean;
		pointerId: number;
		startX: number;
		startY: number;
		target: HTMLButtonElement;
	} | null>(null);
	const suppressClickRef = useRef(false);
	const [activeDrag, setActiveDrag] = useState<{
		name: string;
		x: number;
		y: number;
	} | null>(null);
	const [tabDropGhost, setTabDropGhost] = useState<DockviewTabDropGhost | null>(
		null,
	);

	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		path: string;
		isDirectory: boolean;
		isRootBlankSpace: boolean;
	} | null>(null);

	const getDirectoryGitStatus = useCallback(
		(dirPath: string): FileExplorerGitStatus | null => {
			let hasNew = false;

			for (const [entryPath, status] of Object.entries(gitStatuses)) {
				if (
					!entryPath.startsWith(`${dirPath}/`) &&
					!entryPath.startsWith(`${dirPath}\\`)
				) {
					continue;
				}
				if (status === 'modified') {
					return 'modified';
				}
				hasNew = true;
			}

			return hasNew ? 'new' : null;
		},
		[gitStatuses],
	);

	const handleContextMenu = useCallback(
		(
			event: MouseEvent,
			path: string,
			isDirectory: boolean,
			isRootBlankSpace = false,
		) => {
			event.preventDefault();
			event.stopPropagation();
			setContextMenu({
				x: event.clientX,
				y: event.clientY,
				path,
				isDirectory,
				isRootBlankSpace,
			});
		},
		[],
	);

	useEffect(() => {
		const clearPendingDrag = () => {
			const pendingDrag = pendingDragRef.current;
			if (pendingDrag) {
				pendingDrag.target.classList.remove(
					'file-explorer-tree-item--dragging',
				);
				if (pendingDrag.target.hasPointerCapture(pendingDrag.pointerId)) {
					pendingDrag.target.releasePointerCapture(pendingDrag.pointerId);
				}
			}
			pendingDragRef.current = null;
			activeDragRef.current = false;
			setActiveDrag(null);
			setTabDropGhost(null);
		};

		const handlePointerMove = (event: PointerEvent) => {
			const pendingDrag = pendingDragRef.current;
			if (!pendingDrag || event.pointerId !== pendingDrag.pointerId) {
				return;
			}

			const distance = Math.hypot(
				event.clientX - pendingDrag.startX,
				event.clientY - pendingDrag.startY,
			);
			if (distance < FILE_EXPLORER_DRAG_THRESHOLD && !activeDragRef.current) {
				return;
			}

			event.preventDefault();

			if (!activeDragRef.current) {
				pendingDrag.target.classList.add('file-explorer-tree-item--dragging');
			}

			activeDragRef.current = true;
			setActiveDrag({
				name: pendingDrag.name,
				x: event.clientX,
				y: event.clientY,
			});
			setTabDropGhost(
				getDockviewTabDropGhost(event.clientX, event.clientY, pendingDrag.name),
			);
		};

		const handlePointerUp = (event: PointerEvent) => {
			const pendingDrag = pendingDragRef.current;
			if (!pendingDrag || event.pointerId !== pendingDrag.pointerId) {
				return;
			}

			const wasDragging = activeDragRef.current;
			const droppedIsDirectory = pendingDrag.isDirectory;
			const droppedPath = pendingDrag.path;
			clearPendingDrag();

			if (!wasDragging) {
				return;
			}

			suppressClickRef.current = true;
			window.setTimeout(() => {
				suppressClickRef.current = false;
			}, 0);

			const dropTarget = document
				.elementFromPoint(event.clientX, event.clientY)
				?.closest<HTMLElement>('[data-terminay-terminal-session-id]');
			const sessionId = dropTarget?.dataset.terminayTerminalSessionId;
			if (!sessionId) {
				if (isPointInDockviewTabBar(event.clientX, event.clientY)) {
					if (droppedIsDirectory) {
						onOpenFolder(droppedPath);
					} else {
						onOpenFile(droppedPath);
					}
				}
				return;
			}

			window.dispatchEvent(
				new CustomEvent(DROP_FILE_EXPLORER_PATH_EVENT, {
					detail: {
						path: droppedPath,
						sessionId,
					},
				}),
			);
		};

		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
		window.addEventListener('pointercancel', clearPendingDrag);
		window.addEventListener('blur', clearPendingDrag);
		return () => {
			window.removeEventListener('pointermove', handlePointerMove);
			window.removeEventListener('pointerup', handlePointerUp);
			window.removeEventListener('pointercancel', clearPendingDrag);
			window.removeEventListener('blur', clearPendingDrag);
		};
	}, [onOpenFile, onOpenFolder]);

	const renderBranch = useCallback(
		(dirPath: string, depth: number): JSX.Element | null => {
			if (!expandedPaths[dirPath]) {
				return null;
			}

			const entries = directoryChildren[dirPath] ?? [];
			const errorText = directoryErrors[dirPath];
			const isLoading = loadingPaths[dirPath];

			return (
				<div className="file-explorer-tree-children">
					{entries.map((entry) => {
						const isExpanded = !!expandedPaths[entry.path];
						const isDirectory = entry.isDirectory;
						const gitStatus = isDirectory
							? getDirectoryGitStatus(entry.path)
							: (gitStatuses[entry.path] ?? null);

						return (
							<div key={entry.path} className="file-explorer-tree-node">
								<button
									type="button"
									className={[
										'file-explorer-tree-item',
										isDirectory ? 'file-explorer-tree-item--directory' : '',
										gitStatus
											? `file-explorer-tree-item--git-${gitStatus}`
											: '',
									]
										.filter(Boolean)
										.join(' ')}
									style={{ paddingLeft: `${depth * 12 + 8}px` }}
									onClick={() => {
										if (suppressClickRef.current) {
											return;
										}
										if (isDirectory) {
											onToggleDirectory(entry.path);
										}
									}}
									onContextMenu={(e) =>
										handleContextMenu(e, entry.path, isDirectory)
									}
									onDoubleClick={() => {
										if (isDirectory) {
											onOpenFolder(entry.path);
										} else {
											onOpenFile(entry.path);
										}
									}}
									onKeyDown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') {
											e.preventDefault();
											if (isDirectory) {
												onToggleDirectory(entry.path);
											} else if (e.key === 'Enter') {
												onOpenFile(entry.path);
											}
										}
									}}
									title={entry.path}
									onPointerDown={(event) => {
										if (event.button !== 0) {
											return;
										}

										pendingDragRef.current = {
											name: entry.name,
											path: entry.path,
											isDirectory,
											pointerId: event.pointerId,
											startX: event.clientX,
											startY: event.clientY,
											target: event.currentTarget,
										};

										event.currentTarget.setPointerCapture(event.pointerId);
									}}
									onPointerUp={(event) => {
										if (
											event.currentTarget.hasPointerCapture(event.pointerId)
										) {
											event.currentTarget.releasePointerCapture(
												event.pointerId,
											);
										}
									}}
									aria-expanded={isDirectory ? isExpanded : undefined}
								>
									<span
										className={`file-explorer-tree-chevron${isExpanded ? ' file-explorer-tree-chevron--expanded' : ''}`}
										aria-hidden="true"
									>
										{isDirectory ? (
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
										) : null}
									</span>
									<span className="file-explorer-tree-icon" aria-hidden="true">
										{isDirectory ? (
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
										) : entry.isSymbolicLink ? (
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
												<path
													d="M9 14l3-3m0 0h-2.5m2.5 0v2.5"
													strokeWidth="2.5"
												/>
											</svg>
										) : (
											<FileTypeIcon name={entry.name} />
										)}
									</span>
									<span className="file-explorer-tree-name">{entry.name}</span>
								</button>
								{isDirectory ? renderBranch(entry.path, depth + 1) : null}
							</div>
						);
					})}

					{isLoading ? (
						<div
							className="file-explorer-tree-feedback"
							style={{ paddingLeft: `${depth * 12 + 32}px` }}
						>
							Loading...
						</div>
					) : null}
					{errorText ? (
						<div
							className="file-explorer-tree-feedback file-explorer-tree-feedback--error"
							style={{ paddingLeft: `${depth * 12 + 32}px` }}
						>
							{errorText}
						</div>
					) : null}
					{!isLoading && !errorText && entries.length === 0 ? (
						<div
							className="file-explorer-tree-feedback"
							style={{ paddingLeft: `${depth * 12 + 32}px` }}
						>
							Empty folder
						</div>
					) : null}
				</div>
			);
		},
		[
			directoryChildren,
			directoryErrors,
			expandedPaths,
			getDirectoryGitStatus,
			gitStatuses,
			handleContextMenu,
			loadingPaths,
			onOpenFile,
			onOpenFolder,
			onToggleDirectory,
		],
	);

	return (
		<div
			className="file-explorer-tree"
			onContextMenu={(e) => handleContextMenu(e, rootPath, true, true)}
		>
			{renderBranch(rootPath, 0)}
			{activeDrag ? (
				<div
					className="file-explorer-tree-drag-preview"
					style={{
						left: `${activeDrag.x + 14}px`,
						top: `${activeDrag.y + 14}px`,
					}}
				>
					{activeDrag.name}
				</div>
			) : null}
			{tabDropGhost ? (
				<div
					className="file-explorer-tab-drop-ghost"
					style={{
						height: `${tabDropGhost.height}px`,
						left: `${tabDropGhost.left}px`,
						top: `${tabDropGhost.top}px`,
						width: `${tabDropGhost.width}px`,
					}}
				>
					<span className="file-explorer-tab-drop-ghost__label">
						{tabDropGhost.label}
					</span>
				</div>
			) : null}

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
											label: 'Create new file',
											icon: <PlusSquare size={14} />,
											onClick: () => onNewFile(contextMenu.path),
										},
										{
											label: 'Create new folder',
											icon: <FolderPlus size={14} />,
											onClick: () => onNewFolder(contextMenu.path),
										},
										{ separator: true },
									]
								: []),
							...(contextMenu.isRootBlankSpace
								? []
								: [
										{
											label: 'Rename',
											icon: <FileEdit size={14} />,
											onClick: () => onRename(contextMenu.path),
										},
										{
											label: 'Delete',
											icon: <Trash2 size={14} />,
											danger: true,
											onClick: () => onDelete(contextMenu.path),
										},
										{ separator: true },
									]),
							{
								label: 'Copy path',
								icon: <Copy size={14} />,
								onClick: () => onCopyPath(contextMenu.path),
							},
							{
								label: 'Copy relative path',
								icon: <Copy size={14} />,
								onClick: () => onCopyRelativePath(contextMenu.path),
							},
							{ separator: true },
							{
								label: 'Open shell in folder',
								icon: <Terminal size={14} />,
								onClick: () => onOpenTerminal(contextMenu.path),
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
