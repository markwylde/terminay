import type { Direction, DockviewApi, DockviewReadyEvent } from 'dockview';
import { DockviewReact, getPanelData } from 'dockview';
import { AnimatePresence, motion, Reorder } from 'framer-motion';
import {
	CSSProperties,
	type FormEvent,
	forwardRef,
	type JSX,
	type MouseEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	ChevronDown,
	Eraser,
	FileEdit,
	FolderPlus,
	FolderSync,
	Play,
	PlusSquare,
	Search,
	Settings,
	Sidebar,
	Sparkles,
	Terminal,
	Trash2,
} from 'lucide-react';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import type { FilePanelInstanceParams } from './components/file-viewer';
import { FilePanel, FileTab } from './components/file-viewer';
import type { FolderPanelInstanceParams } from './components/folder-viewer';
import { FolderPanel, FolderTab } from './components/folder-viewer';
import { TerminalPanel } from './components/TerminalPanel';
import type {
	TerminalActivityState,
	TerminalContextReader,
	TerminalPanelParams,
	TerminalTabMacroRun,
	TerminalTabMoveProject,
} from './components/TerminalTab';
import { TerminalTab } from './components/TerminalTab';
import { useMacroSettings } from './hooks/useMacroSettings';
import { useTerminalSettings } from './hooks/useTerminalSettings';
import {
	findCommandForKeyboardEvent,
	getCommandShortcut,
	getCommandShortcutLabel,
} from './keyboardShortcuts';
import { renderMacroTemplate } from './macroSettings';
import {
	TerminalActivityStore,
	type TerminalActivityEvaluation,
} from './terminalActivityStore';
import type { MacroDefinition, MacroFieldValue } from './types/macros';
import type {
	AiTabMetadataTarget,
	AppCommand,
	AppUpdateStatus,
	FileExplorerEntry,
	FileExplorerGitStatus,
	FileSearchResult,
	RemoteAccessStatus,
} from './types/terminay';
import type { FileViewerMode } from './types/fileViewer';
import './App.css';

type SplitDirection = Extract<Direction, 'below' | 'right'>;
type AddTerminalOptions = {
	direction?: SplitDirection;
	groupId?: string;
};

type OpenFileOptions = {
	initialMode?: FileViewerMode;
};

type MacroLauncherGroup = 'Terminal' | 'Workspace' | 'Macros';

type MacroLauncherItem = {
	description: string;
	group: MacroLauncherGroup;
	icon: ReactNode;
	id: string;
	onSelect: () => void;
	searchText: string;
	shortcutLabel?: string;
	title: string;
};

type MacroLauncherGroupedItem = {
	index: number;
	item: MacroLauncherItem;
};

type DockPanelTabAppearance = {
	activityIndicatorsEnabled?: boolean;
	color?: string;
	emoji?: string;
	inheritsProjectColor?: boolean;
	projectColor?: string;
	terminalNote?: string;
};

type ProjectTab = {
	id: string;
	title: string;
	color: string;
	emoji: string;
	fileExplorerWidth: number;
	isFileExplorerOpen: boolean;
	rootFolder: string;
};

type MovedTerminalTab = {
	activityIndicatorsEnabled?: boolean;
	color?: string;
	emoji?: string;
	inheritsProjectColor?: boolean;
	macroRuns?: TerminalTabMacroRun[];
	sessionId: string;
	terminalActivityState?: TerminalActivityState;
	terminalNote?: string;
	title: string;
};

type TerminalActivityOverviewState = Extract<
	TerminalActivityState,
	'recent' | 'unviewed'
>;

type TerminalActivityOverviewItem = {
	color: string;
	emoji: string;
	panelId: string;
	projectEmoji: string;
	projectId: string;
	projectTitle: string;
	sessionId: string;
	state: TerminalActivityOverviewState;
	title: string;
};

type ProjectWorkspaceHandle = {
	acceptMovedTerminal: (terminal: MovedTerminalTab) => void;
	activateTerminal: (panelId: string, sessionId: string) => void;
	executeCommand: (command: AppCommand) => void;
	exportTerminalForMove: (panelId: string) => MovedTerminalTab | null;
	focusActiveTerminal: () => void;
};

type ProjectWorkspaceProps = {
	isActive: boolean;
	isMac: boolean;
	macros: MacroDefinition[];
	onAddProject: () => void;
	onCloseProject: (projectId: string) => void;
	onEditProject: (projectId: string) => Promise<void>;
	onMoveTerminalToProject: (
		sourceProjectId: string,
		panelId: string,
		targetProjectId: string,
	) => void;
	onTerminalActivityOverviewChange: (
		projectId: string,
		items: TerminalActivityOverviewItem[],
	) => void;
	onUpdateProject: (projectId: string, updates: Partial<ProjectTab>) => void;
	popoutUrl: string;
	project: ProjectTab;
	projects: ProjectTab[];
};

const OPEN_TERMINAL_SWITCHER_EVENT = 'terminay-open-terminal-switcher';
const DROP_FILE_EXPLORER_PATH_EVENT = 'terminay-drop-file-explorer-path';
const DEFAULT_FILE_EXPLORER_WIDTH = 280;
const MIN_FILE_EXPLORER_WIDTH = 180;
const MAX_FILE_EXPLORER_WIDTH = 520;
const FILE_EXPLORER_DRAG_THRESHOLD = 6;
const FILE_EXPLORER_WATCH_REFRESH_DELAY_MS = 120;
const FILE_EXPLORER_GIT_STATUS_POLL_INTERVAL_MS = 2500;
const PROJECT_TAB_COLOR_PALETTE_SIZE = 20;

function hueToProjectTabColor(hue: number): string {
	const normalizedHue = ((hue % 360) + 360) % 360 / 360;
	const saturation = 0.65;
	const lightness = 0.6;

	const hue2rgb = (p: number, q: number, t: number) => {
		if (t < 0) {
			t += 1;
		}
		if (t > 1) {
			t -= 1;
		}
		if (t < 1 / 6) {
			return p + (q - p) * 6 * t;
		}
		if (t < 1 / 2) {
			return q;
		}
		if (t < 2 / 3) {
			return p + (q - p) * (2 / 3 - t) * 6;
		}

		return p;
	};

	const q =
		lightness < 0.5
			? lightness * (1 + saturation)
			: lightness + saturation - lightness * saturation;
	const p = 2 * lightness - q;
	const r = hue2rgb(p, q, normalizedHue + 1 / 3);
	const g = hue2rgb(p, q, normalizedHue);
	const b = hue2rgb(p, q, normalizedHue - 1 / 3);

	const toHex = (value: number) => {
		const hex = Math.round(value * 255).toString(16);
		return hex.length === 1 ? `0${hex}` : hex;
	};

	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const DEFAULT_PROJECT_TAB_COLORS = Array.from(
	{ length: PROJECT_TAB_COLOR_PALETTE_SIZE },
	(_, index) =>
		hueToProjectTabColor((360 / PROJECT_TAB_COLOR_PALETTE_SIZE) * index),
) as readonly string[];

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function getRandomProjectTabColor(usedColors: Iterable<string> = []): string {
	const normalizedUsedColors = new Set(
		Array.from(usedColors, (color) => color.trim().toLowerCase()),
	);
	const availableColors = DEFAULT_PROJECT_TAB_COLORS.filter(
		(color) => !normalizedUsedColors.has(color.toLowerCase()),
	);

	if (availableColors.length > 0) {
		const index = Math.floor(Math.random() * availableColors.length);
		return availableColors[index] ?? '#57b7ff';
	}

	return hueToProjectTabColor(Math.floor(Math.random() * 360));
}

function getEffectiveTerminalTabColor(
	params: DockPanelTabAppearance | undefined,
	fallbackProjectColor: string,
): string {
	if (params?.inheritsProjectColor) {
		return params.projectColor ?? fallbackProjectColor;
	}

	return params?.color ?? fallbackProjectColor;
}

function areTerminalActivityIndicatorsEnabled(
	params: DockPanelTabAppearance | undefined,
): boolean {
	return params?.activityIndicatorsEnabled !== false;
}

function createProjectTab(
	index: number,
	homePath: string,
	usedColors: Iterable<string> = [],
): ProjectTab {
	return {
		id: `project-${index}`,
		title: `Project ${index}`,
		color: getRandomProjectTabColor(usedColors),
		emoji: '',
		fileExplorerWidth: DEFAULT_FILE_EXPLORER_WIDTH,
		isFileExplorerOpen: false,
		rootFolder: homePath,
	};
}

function normalizeRootFolderInput(value: string, homePath: string): string {
	const trimmedValue = value.trim();
	if (!trimmedValue) {
		return homePath;
	}

	if (trimmedValue === '~') {
		return homePath;
	}

	if (trimmedValue.startsWith('~/') || trimmedValue.startsWith('~\\')) {
		return `${homePath}${trimmedValue.slice(1)}`;
	}

	return trimmedValue;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCommandSearchScore(
	item: {
		title: string;
		description: string;
		searchText: string;
	},
	query: string,
): number {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return 0;
	}

	const title = item.title.toLowerCase();
	const description = item.description.toLowerCase();
	const searchText = item.searchText.toLowerCase();
	const boundaryQueryPattern = new RegExp(`\\b${escapeRegExp(normalizedQuery)}`);
	const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
	const titleWords = title.split(/[^a-z0-9]+/).filter(Boolean);
	let score = 0;

	if (title === normalizedQuery) {
		score += 1_000;
	}
	if (title.startsWith(normalizedQuery)) {
		score += 700;
	}
	if (boundaryQueryPattern.test(title)) {
		score += 500;
	}
	if (title.includes(normalizedQuery)) {
		score += 300;
	}
	if (
		queryWords.length > 0 &&
		queryWords.every((word) =>
			titleWords.some((titleWord) => titleWord.startsWith(word)),
		)
	) {
		score += 250;
	}
	if (boundaryQueryPattern.test(description)) {
		score += 120;
	}
	if (description.includes(normalizedQuery)) {
		score += 80;
	}
	if (boundaryQueryPattern.test(searchText)) {
		score += 40;
	}
	if (searchText.includes(normalizedQuery)) {
		score += 20;
	}

	return score;
}

function ModalBackdrop({
	children,
	onClose,
}: {
	children: ReactNode;
	onClose: () => void;
}) {
	const pointerStartedOnBackdropRef = useRef(false);

	return (
		<div
			className="project-edit-modal-backdrop"
			onMouseDown={(event) => {
				pointerStartedOnBackdropRef.current = event.target === event.currentTarget;
			}}
			onMouseUp={(event) => {
				const shouldClose =
					pointerStartedOnBackdropRef.current &&
					event.target === event.currentTarget;
				pointerStartedOnBackdropRef.current = false;

				if (shouldClose) {
					onClose();
				}
			}}
		>
			{children}
		</div>
	);
}

function ModalTitlebar({
	title,
	titleId,
	onClose,
	onMouseDown,
}: {
	title: string;
	titleId: string;
	onClose: () => void;
	onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
	return (
		<div className="project-edit-modal-titlebar" onMouseDown={onMouseDown}>
			<h2 id={titleId} className="project-edit-modal-title">
				{title}
			</h2>
			<button
				type="button"
				className="project-edit-modal-close"
				onClick={onClose}
				aria-label={`Close ${title}`}
				title={`Close ${title}`}
			>
				<svg
					aria-hidden="true"
					width="12"
					height="12"
					viewBox="0 0 12 12"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
				>
					<path
						d="M9 3L3 9M3 3L9 9"
						stroke="currentColor"
						strokeWidth="1.8"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</button>
		</div>
	);
}

type MacroFileFieldInputProps = {
	onChange: (value: string) => void;
	placeholder: string;
	rootPath: string;
	value: string;
};

const MacroFileFieldInput = forwardRef<
	HTMLInputElement,
	MacroFileFieldInputProps
>(({ onChange, placeholder, rootPath, value }, ref) => {
	const [suggestions, setSuggestions] = useState<FileSearchResult[]>([]);
	const [highlightedIndex, setHighlightedIndex] = useState(0);
	const [isOpen, setIsOpen] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const requestIdRef = useRef(0);
	const normalizedValue = value.trim();

	useEffect(() => {
		requestIdRef.current += 1;
		const requestId = requestIdRef.current;

		if (!isOpen || normalizedValue.length === 0 || !rootPath.trim()) {
			setSuggestions([]);
			setIsLoading(false);
			return;
		}

		setIsLoading(true);
		const timeoutId = window.setTimeout(() => {
			void window.terminay
				.searchFiles({ rootPath, query: normalizedValue, limit: 60 })
				.then((results) => {
					if (requestIdRef.current !== requestId) {
						return;
					}

					setSuggestions(results);
					setHighlightedIndex(0);
				})
				.catch(() => {
					if (requestIdRef.current === requestId) {
						setSuggestions([]);
					}
				})
				.finally(() => {
					if (requestIdRef.current === requestId) {
						setIsLoading(false);
					}
				});
		}, 120);

		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [isOpen, normalizedValue, rootPath]);

	const commitSuggestion = useCallback(
		(result: FileSearchResult) => {
			onChange(result.relativePath);
			setSuggestions([]);
			setHighlightedIndex(0);
			setIsOpen(result.isDirectory);
		},
		[onChange],
	);

	const handleKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLInputElement>) => {
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				setIsOpen(true);
				setHighlightedIndex((current) =>
					suggestions.length === 0 ? 0 : (current + 1) % suggestions.length,
				);
				return;
			}

			if (event.key === 'ArrowUp') {
				event.preventDefault();
				setIsOpen(true);
				setHighlightedIndex((current) =>
					suggestions.length === 0
						? 0
						: (current - 1 + suggestions.length) % suggestions.length,
				);
				return;
			}

			if (
				(event.key === 'Enter' || event.key === 'Tab') &&
				isOpen &&
				suggestions[highlightedIndex]
			) {
				event.preventDefault();
				commitSuggestion(suggestions[highlightedIndex]);
				return;
			}

			if (event.key === 'Escape' && isOpen) {
				event.stopPropagation();
				setIsOpen(false);
			}
		},
		[commitSuggestion, highlightedIndex, isOpen, suggestions],
	);

	return (
		<div className="macro-file-field">
			<input
				ref={ref}
				type="text"
				value={value}
				placeholder={placeholder || 'Start typing a file path...'}
				onChange={(event) => {
					onChange(event.target.value);
					setIsOpen(true);
				}}
				onFocus={() => setIsOpen(true)}
				onBlur={() => {
					window.setTimeout(() => setIsOpen(false), 100);
				}}
				onKeyDown={handleKeyDown}
				spellCheck={false}
				autoComplete="off"
			/>
			{isOpen && normalizedValue.length > 0 ? (
				<div className="macro-file-field-menu" role="listbox">
					{isLoading ? (
						<div className="macro-file-field-empty">Searching files...</div>
					) : suggestions.length === 0 ? (
						<div className="macro-file-field-empty">No matching files</div>
					) : (
						suggestions.map((result, index) => (
							<button
								key={result.path}
								type="button"
								className={`macro-file-field-option${index === highlightedIndex ? ' macro-file-field-option--active' : ''}`}
								onMouseDown={(event) => event.preventDefault()}
								onMouseEnter={() => setHighlightedIndex(index)}
								onClick={() => commitSuggestion(result)}
								role="option"
								aria-selected={index === highlightedIndex}
							>
								{result.relativePath}
							</button>
						))
					)}
				</div>
			) : null}
		</div>
	);
});

MacroFileFieldInput.displayName = 'MacroFileFieldInput';

function useDraggableModal(isOpen: boolean) {
	const modalRef = useRef<HTMLElement | null>(null);
	const positionRef = useRef({ x: 0, y: 0 });
	const [position, setPosition] = useState({ x: 0, y: 0 });

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		const resetPosition = { x: 0, y: 0 };
		positionRef.current = resetPosition;
		setPosition(resetPosition);
	}, [isOpen]);

	const handleTitlebarPointerDown = useCallback(
		(event: MouseEvent<HTMLDivElement>) => {
			const target = event.target as HTMLElement;
			if (target.closest('button, input, select, textarea, a')) {
				return;
			}

			const modal = modalRef.current;
			if (!modal) {
				return;
			}

			event.preventDefault();

			const startPointerX = event.clientX;
			const startPointerY = event.clientY;
			const startPosition = positionRef.current;

			const handlePointerMove = (moveEvent: globalThis.MouseEvent) => {
				const rect = modal.getBoundingClientRect();
				const centeredLeft = (window.innerWidth - rect.width) / 2;
				const centeredTop = (window.innerHeight - rect.height) / 2;
				const margin = 16;

				const nextX = clamp(
					startPosition.x + (moveEvent.clientX - startPointerX),
					margin - centeredLeft,
					window.innerWidth - margin - rect.width - centeredLeft,
				);
				const nextY = clamp(
					startPosition.y + (moveEvent.clientY - startPointerY),
					margin - centeredTop,
					window.innerHeight - margin - rect.height - centeredTop,
				);
				const nextPosition = { x: nextX, y: nextY };

				positionRef.current = nextPosition;
				setPosition(nextPosition);
			};

			const handlePointerUp = () => {
				window.removeEventListener('mousemove', handlePointerMove);
				window.removeEventListener('mouseup', handlePointerUp);
			};

			window.addEventListener('mousemove', handlePointerMove);
			window.addEventListener('mouseup', handlePointerUp);
		},
		[],
	);

	return {
		handleTitlebarPointerDown,
		modalRef,
		modalStyle: {
			transform:
				position.x === 0 && position.y === 0
					? undefined
					: `translate(${position.x}px, ${position.y}px)`,
		} as CSSProperties,
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
	rootPath: string;
};

function FileExplorerTree({
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
	rootPath,
}: FileExplorerTreeProps) {
	const activeDragRef = useRef(false);
	const pendingDragRef = useRef<{
		name: string;
		path: string;
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
		};

		const handlePointerUp = (event: PointerEvent) => {
			const pendingDrag = pendingDragRef.current;
			if (!pendingDrag || event.pointerId !== pendingDrag.pointerId) {
				return;
			}

			const wasDragging = activeDragRef.current;
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
	}, []);

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
							: gitStatuses[entry.path] ?? null;

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
									onContextMenu={(e) => handleContextMenu(e, entry.path, isDirectory)}
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

			{contextMenu && (
				<ContextMenu
					x={contextMenu.x}
					y={contextMenu.y}
					onClose={() => setContextMenu(null)}
					items={[
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
							label: 'Open terminal here',
							icon: <Terminal size={14} />,
							onClick: () => onOpenTerminal(contextMenu.path),
						},
					].filter(Boolean) as ContextMenuItem[]}
				/>
			)}
		</div>
	);
}

function createAbortError(): Error {
	const error = new Error('Macro execution canceled.');
	error.name = 'AbortError';
	return error;
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) {
		throw createAbortError();
	}
}

function waitForDelay(durationMs: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(createAbortError());
			return;
		}

		const onAbort = () => {
			window.clearTimeout(timeout);
			reject(createAbortError());
		};

		const timeout = window.setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, durationMs);

		signal.addEventListener('abort', onAbort, { once: true });
	});
}

function waitForSessionInactivity(
	sessionId: string,
	durationMs: number,
	signal: AbortSignal,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(createAbortError());
			return;
		}

		let timeout = 0;

		const cleanup = () => {
			window.clearTimeout(timeout);
			dispose();
			signal.removeEventListener('abort', onAbort);
		};

		const finish = () => {
			cleanup();
			resolve();
		};

		const onAbort = () => {
			cleanup();
			reject(createAbortError());
		};

		const restartTimer = () => {
			window.clearTimeout(timeout);
			timeout = window.setTimeout(finish, durationMs);
		};

		const dispose = window.terminay.onTerminalData((message) => {
			if (message.id !== sessionId) {
				return;
			}

			restartTimer();
		});

		signal.addEventListener('abort', onAbort, { once: true });
		restartTimer();
	});
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

function describeMacroStep(step: MacroDefinition['steps'][number]): string {
	switch (step.type) {
		case 'type':
			return `Type: ${step.content.replace(/\s+/g, ' ').trim() || '(empty)'}`.slice(
				0,
				96,
			);
		case 'key':
			return `Press ${step.key}`;
		case 'secret':
			return 'Insert secret';
		case 'wait_time':
			return `Wait ${Math.max(0, Math.round(step.durationMs / 100) / 10)}s`;
		case 'wait_inactivity':
			return `Wait for inactivity ${Math.max(0, Math.round(step.durationMs / 100) / 10)}s`;
		case 'select_line':
			return 'Select current line';
		case 'paste':
			return 'Paste clipboard';
	}
}

type TerminalSwitcherItem = {
	panelId: string;
	sessionId: string;
	title: string;
	emoji: string;
	color: string;
};

type MacroRunController = {
	abortController: AbortController;
	sessionId: string;
};

type FileExplorerNameDialogOptions = {
	description?: string;
	initialValue?: string;
	label: string;
	submitLabel: string;
	title: string;
};

type FileExplorerNameDialogState = FileExplorerNameDialogOptions & {
	id: number;
	resolve: (value: string | null) => void;
};

function FileExplorerNameModal({
	dialog,
	modal,
	onCancel,
	onSubmit,
}: {
	dialog: FileExplorerNameDialogState;
	modal: ReturnType<typeof useDraggableModal>;
	onCancel: () => void;
	onSubmit: (value: string) => void;
}) {
	const [value, setValue] = useState(dialog.initialValue ?? '');
	const inputRef = useRef<HTMLInputElement | null>(null);
	const titleId = `file-explorer-name-modal-title-${dialog.id}`;
	const trimmedValue = value.trim();

	useEffect(() => {
		setValue(dialog.initialValue ?? '');
		window.requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onCancel();
			}
		};

		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [dialog.initialValue, onCancel]);

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!trimmedValue) {
			return;
		}
		onSubmit(trimmedValue);
	};

	return (
		<ModalBackdrop onClose={onCancel}>
			<form
				className="project-edit-modal"
				ref={(element) => {
					modal.modalRef.current = element;
				}}
				style={modal.modalStyle}
				onSubmit={handleSubmit}
				onClick={(event) => event.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
			>
				<ModalTitlebar
					title={dialog.title}
					titleId={titleId}
					onClose={onCancel}
					onMouseDown={modal.handleTitlebarPointerDown}
				/>
				{dialog.description ? (
					<p className="file-explorer-name-modal-description">
						{dialog.description}
					</p>
				) : null}
				<label>
					<span>{dialog.label}</span>
					<input
						ref={inputRef}
						type="text"
						value={value}
						onChange={(event) => setValue(event.target.value)}
						spellCheck={false}
					/>
				</label>
				<div className="project-edit-actions">
					<button type="button" onClick={onCancel}>
						Cancel
					</button>
					<button type="submit" disabled={!trimmedValue}>
						{dialog.submitLabel}
					</button>
				</div>
			</form>
		</ModalBackdrop>
	);
}

function joinFileExplorerPath(dirPath: string, name: string): string {
	if (dirPath.endsWith('/') || dirPath.endsWith('\\')) {
		return `${dirPath}${name}`;
	}

	return `${dirPath}/${name}`;
}

const ProjectWorkspace = forwardRef<
	ProjectWorkspaceHandle,
	ProjectWorkspaceProps
>(({ isActive, isMac, macros, onAddProject, onCloseProject, onEditProject, onMoveTerminalToProject, onTerminalActivityOverviewChange, onUpdateProject, popoutUrl, project, projects }, ref) => {
	const { settings } = useTerminalSettings();
	const dockviewApiRef = useRef<DockviewApi | null>(null);
	const initialTerminalSeededRef = useRef(false);
	const panelSessionMapRef = useRef<Map<string, string>>(new Map());
	const terminalContextReadersRef = useRef<Map<string, TerminalContextReader>>(
		new Map(),
	);
	const aiGenerationInFlightRef = useRef<Set<string>>(new Set());
	const movingTerminalSessionIdsRef = useRef<Set<string>>(new Set());
	const terminalActivityStoreRef = useRef(new TerminalActivityStore());
	const terminalActivityTimersRef = useRef<Map<string, number>>(new Map());
	const fileExplorerRefreshTimersRef = useRef<Map<string, number>>(new Map());
	const evaluateTerminalActivityStateRef = useRef<
		(sessionId: string, now?: number) => void
	>(() => {});
	const focusedSessionIdRef = useRef<string | null>(null);
	const filePathPanelMapRef = useRef<Map<string, string>>(new Map());
	const folderPathPanelMapRef = useRef<Map<string, string>>(new Map());
	const terminalCounterRef = useRef(0);
	const filePanelCounterRef = useRef(0);
	const folderPanelCounterRef = useRef(0);
	const draggingTransferRef = useRef<{
		panelId?: string;
		groupId: string;
	} | null>(null);
	const workspaceRef = useRef<HTMLElement | null>(null);
	const explorerResizeStateRef = useRef<{
		pointerId: number;
		startWidth: number;
		startX: number;
	} | null>(null);
	const [errorText, setErrorText] = useState<string | null>(null);
	const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
	const [directoryChildren, setDirectoryChildren] = useState<
		Record<string, FileExplorerEntry[]>
	>({});
	const [directoryErrors, setDirectoryErrors] = useState<
		Record<string, string>
	>({});
	const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>(
		{},
	);
	const [gitStatuses, setGitStatuses] = useState<
		Record<string, FileExplorerGitStatus>
	>({});
	const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});
	const [runningMacroRunsBySession, setRunningMacroRunsBySession] = useState<
		Record<string, TerminalTabMacroRun[]>
	>({});
	const macroRunControllersRef = useRef<Map<string, MacroRunController>>(
		new Map(),
	);
	const isRefreshingGitStatusesRef = useRef(false);
	const fileExplorerNameDialogRequestIdRef = useRef(0);
	const [fileExplorerNameDialog, setFileExplorerNameDialog] =
		useState<FileExplorerNameDialogState | null>(null);

	const [isDockviewReady, setIsDockviewReady] = useState(false);
	const [isMacroLauncherOpen, setIsMacroLauncherOpen] = useState(false);
	const [macroQuery, setMacroQuery] = useState('');
	const [selectedMacroIndex, setSelectedMacroIndex] = useState(0);
	const [macroToRun, setMacroToRun] = useState<MacroDefinition | null>(null);
	const [macroFieldValues, setMacroFieldValues] = useState<
		Record<string, MacroFieldValue>
	>({});
	const [macroFileSearchRootPath, setMacroFileSearchRootPath] = useState('');
	const macroLauncherInputRef = useRef<HTMLInputElement | null>(null);
	const macroLauncherListRef = useRef<HTMLDivElement | null>(null);
	const macroLauncherItemRefs = useRef(
		new Map<string, HTMLButtonElement | null>(),
	);
	const firstMacroFieldRef = useRef<
		HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null
	>(null);
	const macroParameterModal = useDraggableModal(macroToRun !== null);
	const fileExplorerNameModal = useDraggableModal(
		fileExplorerNameDialog !== null,
	);

	const requestFileExplorerName = useCallback(
		(options: FileExplorerNameDialogOptions) => {
			return new Promise<string | null>((resolve) => {
				fileExplorerNameDialogRequestIdRef.current += 1;
				setFileExplorerNameDialog({
					...options,
					id: fileExplorerNameDialogRequestIdRef.current,
					resolve,
				});
			});
		},
		[],
	);

	const cancelFileExplorerNameDialog = useCallback(() => {
		setFileExplorerNameDialog((current) => {
			current?.resolve(null);
			return null;
		});
	}, []);

	const submitFileExplorerNameDialog = useCallback((value: string) => {
		setFileExplorerNameDialog((current) => {
			current?.resolve(value);
			return null;
		});
	}, []);

	const getProjectsForTerminalMove = useCallback((): TerminalTabMoveProject[] => {
		return projects
			.filter((candidate) => candidate.id !== project.id)
			.map((candidate) => ({
				emoji: candidate.emoji,
				id: candidate.id,
				title: candidate.title,
			}));
	}, [project.id, projects]);

	const getActiveSessionId = useCallback(() => {
		return dockviewApiRef.current?.activePanel?.params?.sessionId ?? null;
	}, []);

	const getPanelForSession = useCallback((sessionId: string) => {
		const api = dockviewApiRef.current;
		if (!api) {
			return null;
		}

		for (const [panelId, panelSessionId] of panelSessionMapRef.current.entries()) {
			if (panelSessionId !== sessionId) {
				continue;
			}

			return api.getPanel(panelId) ?? null;
		}

		return null;
	}, []);

	const getActivityOverviewItems =
		useCallback((): TerminalActivityOverviewItem[] => {
			const api = dockviewApiRef.current;
			if (!api) {
				return [];
			}

			const items: TerminalActivityOverviewItem[] = [];
			for (const group of api.groups) {
				for (const panel of group.panels) {
					const sessionId = panel.params?.sessionId;
					const state = panel.params?.terminalActivityState;
					if (
						!sessionId ||
						!areTerminalActivityIndicatorsEnabled(panel.params) ||
						(state !== 'recent' && state !== 'unviewed')
					) {
						continue;
					}

					items.push({
						color: getEffectiveTerminalTabColor(panel.params, project.color),
						emoji: panel.params?.emoji ?? '',
						panelId: panel.id,
						projectEmoji: project.emoji,
						projectId: project.id,
						projectTitle: project.title,
						sessionId,
						state,
						title: panel.title ?? 'Terminal',
					});
				}
			}

			return items;
		}, [project.color, project.emoji, project.id, project.title]);

	const publishTerminalActivityOverview = useCallback(() => {
		onTerminalActivityOverviewChange(project.id, getActivityOverviewItems());
	}, [getActivityOverviewItems, onTerminalActivityOverviewChange, project.id]);

	const registerTerminalContextReader = useCallback(
		(sessionId: string, reader: TerminalContextReader) => {
			terminalContextReadersRef.current.set(sessionId, reader);

			return () => {
				if (terminalContextReadersRef.current.get(sessionId) === reader) {
					terminalContextReadersRef.current.delete(sessionId);
				}
			};
		},
		[],
	);

	const applyTerminalActivityEvaluation = useCallback(
		(sessionId: string, evaluation: TerminalActivityEvaluation) => {
			const panel = getPanelForSession(sessionId);
			if (!panel) {
				return;
			}

			if (panel.params?.terminalActivityState !== evaluation.state) {
				panel.api.updateParameters({ terminalActivityState: evaluation.state });
			}

			const existingTimer = terminalActivityTimersRef.current.get(sessionId);
			if (existingTimer !== undefined) {
				window.clearTimeout(existingTimer);
				terminalActivityTimersRef.current.delete(sessionId);
			}

			const now = Date.now();
			if (
				evaluation.nextDeadline !== null &&
				evaluation.nextDeadline > now
			) {
				const nextTimer = window.setTimeout(() => {
					terminalActivityTimersRef.current.delete(sessionId);
					evaluateTerminalActivityStateRef.current(sessionId);
				}, Math.max(0, evaluation.nextDeadline - now));

				terminalActivityTimersRef.current.set(sessionId, nextTimer);
			}

			window.requestAnimationFrame(publishTerminalActivityOverview);
		},
		[getPanelForSession, publishTerminalActivityOverview],
	);

	const suppressInitialTerminalActivity = useCallback((sessionId: string) => {
		terminalActivityStoreRef.current.recordInitialSuppression(sessionId);
	}, []);

	const evaluateTerminalActivityState = useCallback(
		(sessionId: string, now = Date.now()) => {
			const panel = getPanelForSession(sessionId);
			if (!panel) {
				return;
			}

			applyTerminalActivityEvaluation(
				sessionId,
				terminalActivityStoreRef.current.evaluate(sessionId, now),
			);
		},
		[applyTerminalActivityEvaluation, getPanelForSession],
	);
	evaluateTerminalActivityStateRef.current = evaluateTerminalActivityState;

	const markTerminalActivityViewed = useCallback(
		(sessionId: string | null) => {
			if (!sessionId) {
				return;
			}

			applyTerminalActivityEvaluation(
				sessionId,
				terminalActivityStoreRef.current.markViewed(sessionId),
			);
		},
		[applyTerminalActivityEvaluation],
	);

	const focusActiveTerminal = useCallback(() => {
		const api = dockviewApiRef.current;
		let terminalPanel =
			api?.activePanel?.params?.sessionId ? api.activePanel : null;

		if (!terminalPanel && focusedSessionIdRef.current) {
			terminalPanel = getPanelForSession(focusedSessionIdRef.current);
		}

		if (!terminalPanel && api) {
			for (const group of api.groups) {
				if (group.activePanel?.params?.sessionId) {
					terminalPanel = group.activePanel;
					break;
				}

				const panel = group.panels.find(
					(candidate) => candidate.params?.sessionId,
				);
				if (panel) {
					terminalPanel = panel;
					break;
				}
			}
		}

		const sessionId = terminalPanel?.params?.sessionId ?? null;
		if (!terminalPanel || !sessionId) {
			return;
		}

		terminalPanel.api.setActive();
		focusedSessionIdRef.current = sessionId;
		setFocusedSessionId(sessionId);
		markTerminalActivityViewed(sessionId);
		window.requestAnimationFrame(() => {
			window.dispatchEvent(
				new CustomEvent('terminay-focus-terminal', {
					detail: { sessionId },
				}),
			);
		});
	}, [getPanelForSession, markTerminalActivityViewed]);

	const activateTerminal = useCallback(
		(panelId: string, sessionId: string) => {
			const panel = dockviewApiRef.current?.getPanel(panelId);
			if (!panel || panel.params?.sessionId !== sessionId) {
				return;
			}

			panel.api.setActive();
			focusedSessionIdRef.current = sessionId;
			setFocusedSessionId(sessionId);
			markTerminalActivityViewed(sessionId);
			setErrorText(null);
			window.requestAnimationFrame(() => {
				window.dispatchEvent(
					new CustomEvent('terminay-focus-terminal', {
						detail: { sessionId },
					}),
				);
			});
		},
		[markTerminalActivityViewed],
	);

	const [terminalSwitcherItems, setTerminalSwitcherItems] = useState<
		TerminalSwitcherItem[]
	>([]);
	const [isTerminalSwitcherOpen, setIsTerminalSwitcherOpen] = useState(false);
	const [terminalSwitcherIndex, setTerminalSwitcherIndex] = useState(0);
	const terminalSwitcherSelectionRef = useRef(0);

	const loadDirectory = useCallback(async (dirPath: string) => {
		setLoadingPaths((current) => ({ ...current, [dirPath]: true }));
		setDirectoryErrors((current) => {
			if (!(dirPath in current)) {
				return current;
			}

			const { [dirPath]: _removed, ...rest } = current;
			return rest;
		});

		try {
			const entries = await window.terminay.listDirectory(dirPath);
			setDirectoryChildren((current) => ({
				...current,
				[dirPath]: entries,
			}));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setDirectoryErrors((current) => ({
				...current,
				[dirPath]: message,
			}));
		} finally {
			setLoadingPaths((current) => {
				const { [dirPath]: _removed, ...rest } = current;
				return rest;
			});
		}
	}, []);

	const refreshGitStatuses = useCallback(async () => {
		if (!project.rootFolder) {
			setGitStatuses({});
			return;
		}

		if (isRefreshingGitStatusesRef.current) {
			return;
		}

		isRefreshingGitStatusesRef.current = true;
		try {
			const nextStatuses = await window.terminay.getFileExplorerGitStatuses(
				project.rootFolder,
			);
			setGitStatuses(nextStatuses.statuses);
		} catch {
			setGitStatuses({});
		} finally {
			isRefreshingGitStatusesRef.current = false;
		}
	}, [project.rootFolder]);

	const scheduleFileExplorerDirectoryRefresh = useCallback(
		(dirPath: string) => {
			const existingTimer = fileExplorerRefreshTimersRef.current.get(dirPath);
			if (existingTimer !== undefined) {
				window.clearTimeout(existingTimer);
			}

			const nextTimer = window.setTimeout(() => {
				fileExplorerRefreshTimersRef.current.delete(dirPath);
				void loadDirectory(dirPath);
				void refreshGitStatuses();
			}, FILE_EXPLORER_WATCH_REFRESH_DELAY_MS);

			fileExplorerRefreshTimersRef.current.set(dirPath, nextTimer);
		},
		[loadDirectory, refreshGitStatuses],
	);

	const toggleDirectory = useCallback(
		(dirPath: string) => {
			const shouldExpand = !expandedPaths[dirPath];
			const shouldLoad =
				shouldExpand &&
				!(dirPath in directoryChildren) &&
				!(dirPath in loadingPaths);

			setExpandedPaths((current) => {
				return {
					...current,
					[dirPath]: !current[dirPath],
				};
			});

			if (shouldLoad) {
				void loadDirectory(dirPath);
			}
		},
		[directoryChildren, expandedPaths, loadDirectory, loadingPaths],
	);

	const updateMacroRun = useCallback(
		(
			sessionId: string,
			runId: string,
			updater: (run: TerminalTabMacroRun) => TerminalTabMacroRun,
		) => {
			setRunningMacroRunsBySession((current) => {
				const existingRuns = current[sessionId];
				if (!existingRuns?.length) {
					return current;
				}

				let changed = false;
				const nextRuns = existingRuns.map((run) => {
					if (run.id !== runId) {
						return run;
					}

					changed = true;
					return updater(run);
				});

				return changed
					? {
							...current,
							[sessionId]: nextRuns,
						}
					: current;
			});
		},
		[],
	);

	const updateMacroRunStatus = useCallback(
		(
			sessionId: string,
			runId: string,
			status: TerminalTabMacroRun['status'],
		) => {
			updateMacroRun(sessionId, runId, (run) => ({
				...run,
				status,
			}));
		},
		[updateMacroRun],
	);

	const updateMacroRunStepStatus = useCallback(
		(
			sessionId: string,
			runId: string,
			stepId: string,
			status: 'pending' | 'running' | 'completed' | 'canceled' | 'failed',
		) => {
			updateMacroRun(sessionId, runId, (run) => ({
				...run,
				steps: run.steps.map((step) =>
					step.id === stepId ? { ...step, status } : step,
				),
			}));
		},
		[updateMacroRun],
	);

	const clearMacroRunsForSession = useCallback((sessionId: string) => {
		setRunningMacroRunsBySession((current) => {
			if (!(sessionId in current)) {
				return current;
			}

			const { [sessionId]: _removed, ...rest } = current;
			return rest;
		});
	}, []);

	const clearFinishedMacroRunsForSession = useCallback((sessionId: string) => {
		setRunningMacroRunsBySession((current) => {
			const existingRuns = current[sessionId];
			if (!existingRuns?.length) {
				return current;
			}

			const nextRuns = existingRuns.filter(
				(run) => run.status === 'running' || run.status === 'canceling',
			);
			if (nextRuns.length === existingRuns.length) {
				return current;
			}

			if (nextRuns.length === 0) {
				const { [sessionId]: _removed, ...rest } = current;
				return rest;
			}

			return {
				...current,
				[sessionId]: nextRuns,
			};
		});
	}, []);

	const clearMacroRunForSession = useCallback(
		(sessionId: string, runId: string) => {
			setRunningMacroRunsBySession((current) => {
				const existingRuns = current[sessionId];
				if (!existingRuns?.length) {
					return current;
				}

				const nextRuns = existingRuns.filter((run) => run.id !== runId);
				if (nextRuns.length === existingRuns.length) {
					return current;
				}

				if (nextRuns.length === 0) {
					const { [sessionId]: _removed, ...rest } = current;
					return rest;
				}

				return {
					...current,
					[sessionId]: nextRuns,
				};
			});
		},
		[],
	);

	const cancelMacroRun = useCallback(
		(runId: string) => {
			const controller = macroRunControllersRef.current.get(runId);
			if (!controller) {
				return;
			}

			updateMacroRunStatus(controller.sessionId, runId, 'canceling');
			controller.abortController.abort();
		},
		[updateMacroRunStatus],
	);

	const cancelMacroRunsForSession = useCallback(
		(sessionId: string) => {
			for (const [
				runId,
				controller,
			] of macroRunControllersRef.current.entries()) {
				if (controller.sessionId !== sessionId) {
					continue;
				}

				updateMacroRunStatus(sessionId, runId, 'canceling');
				controller.abortController.abort();
			}
		},
		[updateMacroRunStatus],
	);

	const getOrderedTerminalSwitcherItems =
		useCallback((): TerminalSwitcherItem[] => {
			const api = dockviewApiRef.current;
			if (!api) {
				return [];
			}

			return api.groups
				.map((group) => {
					const referencePanel = group.activePanel ?? group.panels[0];
					if (!referencePanel) {
						return null;
					}

					try {
						if (referencePanel.api.getWindow() !== window) {
							return null;
						}
					} catch {
						return null;
					}

					const rect = group.element.getBoundingClientRect();
					return {
						group,
						top: rect.top,
						left: rect.left,
					};
				})
				.filter(
					(
						entry,
					): entry is {
						group: DockviewApi['groups'][number];
						top: number;
						left: number;
					} => entry !== null,
				)
				.sort((a, b) => {
					const verticalDistance = Math.abs(a.top - b.top);
					if (verticalDistance > 24) {
						return a.top - b.top;
					}

					return a.left - b.left;
				})
				.flatMap(({ group }) =>
					group.panels.map((panel) => ({
						panelId: panel.id,
						sessionId: panel.params?.sessionId ?? '',
						title: panel.title ?? 'Terminal',
						emoji: panel.params?.emoji ?? '',
						color: panel.params?.color ?? '#4db5ff',
					})),
				)
				.filter((panel) => panel.sessionId.length > 0);
		}, []);

	const closeTerminalSwitcher = useCallback(() => {
		terminalSwitcherSelectionRef.current = 0;
		setIsTerminalSwitcherOpen(false);
		setTerminalSwitcherItems([]);
		setTerminalSwitcherIndex(0);
	}, []);

	const commitTerminalSwitcherSelection = useCallback(() => {
		const api = dockviewApiRef.current;
		const selectedPanel =
			terminalSwitcherItems[terminalSwitcherSelectionRef.current];
		closeTerminalSwitcher();

		if (!api || !selectedPanel) {
			return;
		}

		api.getPanel(selectedPanel.panelId)?.api.setActive();
		setErrorText(null);
		window.requestAnimationFrame(() => {
			window.dispatchEvent(
				new CustomEvent('terminay-focus-terminal', {
					detail: { sessionId: selectedPanel.sessionId },
				}),
			);
		});
	}, [closeTerminalSwitcher, terminalSwitcherItems]);

	const syncPanelFocusState = useCallback(() => {
		const api = dockviewApiRef.current;
		if (!api) {
			return;
		}

		const activePanelId = api.activePanel?.id ?? null;

		for (const group of api.groups) {
			for (const panel of group.panels) {
				panel.api.updateParameters({
					...panel.params,
					isFocused: panel.id === activePanelId,
				});
			}
		}
	}, []);

	const openFile = useCallback(
		async (filePath: string, options?: OpenFileOptions) => {
			const api = dockviewApiRef.current;
			if (!api) {
				return;
			}

			const existingPanelId = filePathPanelMapRef.current.get(filePath);
			if (existingPanelId) {
				const existingPanel = api.getPanel(existingPanelId);
				if (existingPanel) {
					existingPanel.api.setActive();
					syncPanelFocusState();
					return;
				}
			}

			filePanelCounterRef.current += 1;
			const panelId = `file-${filePanelCounterRef.current}`;
			const title = filePath.split(/[/\\]/).pop() || filePath;

			const panel = api.addPanel<FilePanelInstanceParams>({
				component: 'file',
				id: panelId,
				params: {
					color: project.color,
					filePath,
					initialMode: options?.initialMode ?? 'preview',
					inheritsProjectColor: true,
					isFocused: false,
					preferredEngine: 'auto',
					projectColor: project.color,
				},
				position: api.activePanel
					? {
							direction: 'within',
							referenceGroup: api.activePanel.group.id,
						}
					: undefined,
				tabComponent: 'fileTab',
				title,
			});

			filePathPanelMapRef.current.set(filePath, panel.id);
			panel.api.setActive();
			syncPanelFocusState();
		},
		[project.color, syncPanelFocusState],
	);

	const handleRename = useCallback(
		async (oldPath: string) => {
			const fileName = oldPath.split(/[/\\]/).pop() || '';
			const newName = await requestFileExplorerName({
				initialValue: fileName,
				label: 'Name',
				submitLabel: 'Rename',
				title: 'Rename',
			});
			if (!newName || newName === fileName) {
				return;
			}

			const parentDir = oldPath.substring(0, oldPath.length - fileName.length);
			const newPath = `${parentDir}${newName}`;

			try {
				await window.terminay.renameEntry(oldPath, newPath);
				// Refresh parent directory
				void loadDirectory(parentDir || project.rootFolder);
				void refreshGitStatuses();
			} catch (error) {
				setErrorText(`Failed to rename: ${String(error)}`);
			}
		},
		[loadDirectory, project.rootFolder, refreshGitStatuses, requestFileExplorerName],
	);

	const handleDelete = useCallback(
		async (path: string) => {
			const fileName = path.split(/[/\\]/).pop() || '';
			if (!window.confirm(`Are you sure you want to delete "${fileName}"?`)) {
				return;
			}

			try {
				await window.terminay.deleteEntry(path);
				const parentDir = path.substring(0, path.length - fileName.length - 1);
				void loadDirectory(parentDir || project.rootFolder);
				void refreshGitStatuses();
			} catch (error) {
				setErrorText(`Failed to delete: ${String(error)}`);
			}
		},
		[loadDirectory, project.rootFolder, refreshGitStatuses],
	);

	const handleNewFile = useCallback(
		async (dirPath: string) => {
			const fileName = await requestFileExplorerName({
				label: 'File name',
				submitLabel: 'Create File',
				title: 'Create New File',
			});
			if (!fileName) {
				return;
			}

			const filePath = joinFileExplorerPath(dirPath, fileName);
			try {
				await window.terminay.saveFile({
					kind: 'text',
					path: filePath,
					data: '',
				});
				void loadDirectory(dirPath);
				void refreshGitStatuses();
				openFile(filePath, { initialMode: 'text' });
			} catch (error) {
				setErrorText(`Failed to create file: ${String(error)}`);
			}
		},
		[loadDirectory, openFile, refreshGitStatuses, requestFileExplorerName],
	);

	const handleNewFolder = useCallback(
		async (dirPath: string) => {
			const folderName = await requestFileExplorerName({
				label: 'Folder name',
				submitLabel: 'Create Folder',
				title: 'Create New Folder',
			});
			if (!folderName) {
				return;
			}

			const newFolderPath = joinFileExplorerPath(dirPath, folderName);
			try {
				await window.terminay.mkdir(newFolderPath);
				void loadDirectory(dirPath);
				void refreshGitStatuses();
			} catch (error) {
				setErrorText(`Failed to create folder: ${String(error)}`);
			}
		},
		[loadDirectory, refreshGitStatuses, requestFileExplorerName],
	);

	const handleOpenTerminalAt = useCallback(
		async (path: string) => {
			const api = dockviewApiRef.current;
			if (!api) {
				return;
			}

			// If it's a file, get the parent directory
			let cwd = path;
			try {
				const info = await window.terminay.getFileInfo(path);
				if (!info.isDirectory) {
					cwd = path.substring(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
				}
			} catch {
				// ignore
			}

			try {
				const { id: sessionId } = await window.terminay.createTerminal({ cwd });
				suppressInitialTerminalActivity(sessionId);

				terminalCounterRef.current += 1;
				const panelId = `terminal-${terminalCounterRef.current}`;

				const panel = api.addPanel<TerminalPanelParams>({
					id: panelId,
					title: `Terminal ${terminalCounterRef.current}`,
					component: 'terminal',
					tabComponent: 'terminalTab',
					params: {
						activityIndicatorsEnabled: true,
						color: project.color,
						inheritsProjectColor: true,
						isFocused: false,
						macroRuns: [],
						onClearFinishedMacroRuns: () =>
							clearFinishedMacroRunsForSession(sessionId),
						onClearMacroRun: (runId: string) =>
							clearMacroRunForSession(sessionId, runId),
						onCancelMacroRun: cancelMacroRun,
						onMoveToProject: (targetProjectId: string) =>
							onMoveTerminalToProject(project.id, panelId, targetProjectId),
						registerTerminalContextReader,
						onUpdateNote: (terminalNote: string | undefined) =>
							dockviewApiRef.current
								?.getPanel(panelId)
								?.api.updateParameters({ terminalNote }),
						projectColor: project.color,
						projectsForMove: getProjectsForTerminalMove(),
						sessionId,
						terminalActivityState: 'viewed',
					},
				});

				panelSessionMapRef.current.set(panel.id, sessionId);
				window.terminay.updateTerminalRemoteMetadata(sessionId, {
					color: project.color,
					emoji: '',
					inheritsProjectColor: true,
					title: `Terminal ${terminalCounterRef.current}`,
					projectId: project.id,
					projectTitle: project.title,
					projectEmoji: project.emoji,
					projectColor: project.color,
				});
				window.requestAnimationFrame(publishTerminalActivityOverview);
			} catch (error) {
				setErrorText(`Failed to open terminal: ${String(error)}`);
			}
		},
		[
			cancelMacroRun,
			clearFinishedMacroRunsForSession,
			clearMacroRunForSession,
			getProjectsForTerminalMove,
			onMoveTerminalToProject,
			project.emoji,
			project.id,
			project.title,
			project.color,
			publishTerminalActivityOverview,
			registerTerminalContextReader,
			suppressInitialTerminalActivity,
		],
	);

	const openFolder = useCallback(
		(folderPath: string) => {
			const api = dockviewApiRef.current;
			if (!api) {
				return;
			}

			const existingPanelId = folderPathPanelMapRef.current.get(folderPath);
			if (existingPanelId) {
				const existingPanel = api.getPanel(existingPanelId);
				if (existingPanel) {
					existingPanel.api.setActive();
					syncPanelFocusState();
					return;
				}
			}

			folderPanelCounterRef.current += 1;
			const panelId = `folder-${folderPanelCounterRef.current}`;
			const title =
				folderPath.split(/[/\\]/).filter(Boolean).pop() || folderPath;

			const panel = api.addPanel<FolderPanelInstanceParams & {
				onRename?: (path: string) => void;
				onDelete?: (path: string) => void;
				onNewFile?: (dirPath: string) => void;
				onNewFolder?: (dirPath: string) => void;
				onOpenTerminal?: (path: string) => void;
			}>({
				component: 'folder',
				id: panelId,
				params: {
					color: project.color,
					folderPath,
					inheritsProjectColor: true,
					isFocused: false,
					onRename: handleRename,
					onDelete: handleDelete,
					onNewFile: handleNewFile,
					onNewFolder: handleNewFolder,
					onOpenTerminal: handleOpenTerminalAt,
					projectColor: project.color,
				},
				position: api.activePanel
					? {
							direction: 'within',
							referenceGroup: api.activePanel.group.id,
						}
					: undefined,
				tabComponent: 'folderTab',
				title,
			});

			folderPathPanelMapRef.current.set(folderPath, panel.id);
			panel.api.setActive();
			syncPanelFocusState();
		},
		[
			handleDelete,
			handleNewFile,
			handleNewFolder,
			handleOpenTerminalAt,
			handleRename,
			project.color,
			syncPanelFocusState,
		],
	);

	const moveTerminalSwitcherSelection = useCallback(
		(direction: 1 | -1) => {
			const items = terminalSwitcherItems;
			if (items.length <= 1) {
				return;
			}

			const nextIndex =
				(terminalSwitcherSelectionRef.current + direction + items.length) %
				items.length;
			terminalSwitcherSelectionRef.current = nextIndex;
			setTerminalSwitcherIndex(nextIndex);
		},
		[terminalSwitcherItems],
	);

	const openTerminalSwitcher = useCallback(
		(direction: 1 | -1 = 1) => {
			const items = getOrderedTerminalSwitcherItems();
			if (items.length <= 1) {
				return;
			}

			const activePanelId = dockviewApiRef.current?.activePanel?.id;
			const activeIndex = activePanelId
				? items.findIndex((item) => item.panelId === activePanelId)
				: -1;
			const startIndex = activeIndex >= 0 ? activeIndex : 0;
			const nextIndex = (startIndex + direction + items.length) % items.length;

			terminalSwitcherSelectionRef.current = nextIndex;
			setTerminalSwitcherItems(items);
			setTerminalSwitcherIndex(nextIndex);
			setIsTerminalSwitcherOpen(true);
		},
		[getOrderedTerminalSwitcherItems],
	);

	const closeMacroLauncher = useCallback(() => {
		setIsMacroLauncherOpen(false);
		setMacroQuery('');
		setSelectedMacroIndex(0);
		window.requestAnimationFrame(() => {
			focusActiveTerminal();
		});
	}, [focusActiveTerminal]);

	const closeMacroParameterModal = useCallback(() => {
		setMacroToRun(null);
		setMacroFieldValues({});
		setMacroFileSearchRootPath('');
		window.requestAnimationFrame(() => {
			focusActiveTerminal();
		});
	}, [focusActiveTerminal]);

	const setProjectRootFolderToWorkingDirectory = useCallback(async () => {
		const sessionId = getActiveSessionId();
		if (!sessionId) {
			setErrorText(
				'Open a terminal before setting the project root to its working directory.',
			);
			return;
		}

		try {
			const cwd = await window.terminay.getTerminalCwd(sessionId);
			if (!cwd) {
				setErrorText('The active terminal does not have a working directory yet.');
				return;
			}

			const nextRootFolder = cwd.trim();

			if (!nextRootFolder) {
				setErrorText('The active terminal does not have a working directory yet.');
				return;
			}

			onUpdateProject(project.id, { rootFolder: nextRootFolder });
			setErrorText(null);
			setIsMacroLauncherOpen(false);
			setMacroQuery('');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorText(`Unable to set the project root folder: ${message}`);
		}
	}, [getActiveSessionId, onUpdateProject, project.id]);

	const executeMacro = useCallback(
		async (macro: MacroDefinition, values: Record<string, MacroFieldValue>) => {
			const sessionId = getActiveSessionId();
			if (!sessionId) {
				setErrorText('No active terminal is available to receive the macro.');
				return;
			}

			setErrorText(null);
			setMacroToRun(null);
			setMacroFieldValues({});
			setMacroFileSearchRootPath('');
			setIsMacroLauncherOpen(false);
			setMacroQuery('');
			setSelectedMacroIndex(0);

			const runId = `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const abortController = new AbortController();
			const nextRun: TerminalTabMacroRun = {
				id: runId,
				startedAt: Date.now(),
				status: 'running',
				steps: macro.steps.map((step) => ({
					id: step.id,
					status: 'pending',
					title: describeMacroStep(step),
				})),
				title: macro.title,
			};

			macroRunControllersRef.current.set(runId, {
				abortController,
				sessionId,
			});
			setRunningMacroRunsBySession((current) => ({
				...current,
				[sessionId]: [nextRun, ...(current[sessionId] ?? [])],
			}));

			try {
				for (const step of macro.steps) {
					throwIfAborted(abortController.signal);
					updateMacroRunStepStatus(sessionId, runId, step.id, 'running');

					switch (step.type) {
						case 'type': {
							const rendered = renderMacroTemplate(step.content, values);
							window.terminay.writeTerminal(sessionId, rendered);
							break;
						}
						case 'key':
							// In this terminal app, we just write the key name for Enter if it's the only way,
							// but usually we want to send \r for Enter.
							if (step.key === 'Enter') {
								window.terminay.writeTerminal(sessionId, '\r');
							} else if (step.key === 'Tab') {
								window.terminay.writeTerminal(sessionId, '\t');
							} else if (step.key === 'Escape') {
								window.terminay.writeTerminal(sessionId, '\x1b');
							} else if (step.key === 'Backspace') {
								window.terminay.writeTerminal(sessionId, '\x7f');
							} else if (step.key === 'ArrowUp') {
								window.terminay.writeTerminal(sessionId, '\x1b[A');
							} else if (step.key === 'ArrowDown') {
								window.terminay.writeTerminal(sessionId, '\x1b[B');
							}
							break;
						case 'secret':
							try {
								const secretVal = await window.terminay.getDecryptedSecret(
									step.secretId,
								);
								throwIfAborted(abortController.signal);
								window.terminay.writeTerminal(sessionId, secretVal);
							} catch (error) {
								if (isAbortError(error)) {
									throw error;
								}

								console.error('Failed to decrypt secret', error);
							}
							break;
						case 'wait_time':
							await waitForDelay(step.durationMs, abortController.signal);
							break;
						case 'wait_inactivity':
							await waitForSessionInactivity(
								sessionId,
								step.durationMs,
								abortController.signal,
							);
							break;
						case 'select_line':
							// Typical "select line" escape sequence for some terminals, or just a placeholder
							// For now, let's just do nothing or a common one if known.
							break;
						case 'paste':
							try {
								const text = await navigator.clipboard.readText();
								throwIfAborted(abortController.signal);
								window.terminay.writeTerminal(sessionId, text);
							} catch (error) {
								if (isAbortError(error)) {
									throw error;
								}

								console.error('Failed to paste from clipboard', error);
							}
							break;
					}

					updateMacroRunStepStatus(sessionId, runId, step.id, 'completed');
				}

				updateMacroRunStatus(sessionId, runId, 'completed');
				window.requestAnimationFrame(() => {
					focusActiveTerminal();
				});
			} catch (error) {
				if (isAbortError(error)) {
					updateMacroRunStatus(sessionId, runId, 'canceled');
					updateMacroRun(sessionId, runId, (run) => ({
						...run,
						steps: run.steps.map((candidate) =>
							candidate.status === 'running'
								? { ...candidate, status: 'canceled' }
								: candidate,
						),
					}));
				} else {
					updateMacroRunStatus(sessionId, runId, 'failed');
					updateMacroRun(sessionId, runId, (run) => ({
						...run,
						steps: run.steps.map((candidate) =>
							candidate.status === 'running'
								? { ...candidate, status: 'failed' }
								: candidate,
						),
					}));
					const message =
						error instanceof Error ? error.message : String(error);
					setErrorText(message);
				}
			} finally {
				macroRunControllersRef.current.delete(runId);
			}
		},
		[
			focusActiveTerminal,
			getActiveSessionId,
			updateMacroRun,
			updateMacroRunStatus,
			updateMacroRunStepStatus,
		],
	);

	const syncFocusedTerminalTabs = useCallback((sessionId: string | null) => {
		const api = dockviewApiRef.current;
		if (!api) {
			return;
		}

		for (const [
			panelId,
			panelSessionId,
		] of panelSessionMapRef.current.entries()) {
			const panel = api.getPanel(panelId);
			if (!panel) {
				continue;
			}

			const isFocused = panelSessionId === sessionId;
			if (panel.params?.isFocused === isFocused) {
				continue;
			}

			panel.api.updateParameters({ isFocused });
		}
	}, []);

	const syncRunningMacroTabs = useCallback(() => {
		const api = dockviewApiRef.current;
		if (!api) {
			return;
		}

		for (const [
			panelId,
			panelSessionId,
		] of panelSessionMapRef.current.entries()) {
			const panel = api.getPanel(panelId);
			if (!panel) {
				continue;
			}

			panel.api.updateParameters({
				macroRuns: runningMacroRunsBySession[panelSessionId] ?? [],
				onClearFinishedMacroRuns: () =>
					clearFinishedMacroRunsForSession(panelSessionId),
				onClearMacroRun: (runId: string) =>
					clearMacroRunForSession(panelSessionId, runId),
				onCancelMacroRun: cancelMacroRun,
				onMoveToProject: (targetProjectId: string) =>
					onMoveTerminalToProject(project.id, panelId, targetProjectId),
				projectsForMove: getProjectsForTerminalMove(),
			});
		}
	}, [
		cancelMacroRun,
		clearFinishedMacroRunsForSession,
		clearMacroRunForSession,
		getProjectsForTerminalMove,
		onMoveTerminalToProject,
		project.id,
		runningMacroRunsBySession,
	]);

	useEffect(() => {
		const api = dockviewApiRef.current;

		for (const group of api?.groups ?? []) {
			for (const panel of group.panels) {
				const params = panel.params as DockPanelTabAppearance | undefined;
				if (!params || !('inheritsProjectColor' in params)) {
					continue;
				}

				const inheritsProjectColor = params.inheritsProjectColor === true;
				panel.api.updateParameters({
					projectColor: project.color,
					...(inheritsProjectColor ? { color: project.color } : {}),
				});
			}
		}

		for (const [panelId, sessionId] of panelSessionMapRef.current.entries()) {
			const panel = api?.getPanel(panelId);
			const inheritsProjectColor =
				panel?.params?.inheritsProjectColor === true;
			const nextColor = getEffectiveTerminalTabColor(
				panel?.params,
				project.color,
			);

			if (panel) {
				panel.api.updateParameters({
					projectColor: project.color,
					...(inheritsProjectColor ? { color: project.color } : {}),
				});
			}

			window.terminay.updateTerminalRemoteMetadata(sessionId, {
				color: nextColor,
				inheritsProjectColor,
				projectId: project.id,
				projectTitle: project.title,
				projectEmoji: project.emoji,
				projectColor: project.color,
			});
		}
		window.requestAnimationFrame(publishTerminalActivityOverview);
	}, [
		project.id,
		project.title,
		project.emoji,
		project.color,
		publishTerminalActivityOverview,
	]);

	useEffect(() => {
		return () => {
			for (const timerId of fileExplorerRefreshTimersRef.current.values()) {
				window.clearTimeout(timerId);
			}
			fileExplorerRefreshTimersRef.current.clear();
		};
	}, []);

	useEffect(() => {
		for (const timerId of fileExplorerRefreshTimersRef.current.values()) {
			window.clearTimeout(timerId);
		}
		fileExplorerRefreshTimersRef.current.clear();

		setDirectoryChildren({});
		setDirectoryErrors({});
		setGitStatuses({});
		setLoadingPaths({});
		setExpandedPaths(project.rootFolder ? { [project.rootFolder]: true } : {});

		if (project.rootFolder) {
			void loadDirectory(project.rootFolder);
			void refreshGitStatuses();
		}
	}, [loadDirectory, project.rootFolder, refreshGitStatuses]);

	useEffect(() => {
		if (!project.rootFolder || !project.isFileExplorerOpen) {
			return;
		}

		const watchedPaths = Object.entries(expandedPaths)
			.filter(([, isExpanded]) => isExpanded)
			.map(([dirPath]) => dirPath);

		if (watchedPaths.length === 0) {
			return;
		}

		const watchedPathSet = new Set(watchedPaths);
		const unsubscribe = window.terminay.onFileExplorerWatchEvent((event) => {
			if (!watchedPathSet.has(event.path)) {
				return;
			}

			scheduleFileExplorerDirectoryRefresh(event.path);
		});

		for (const dirPath of watchedPaths) {
			void window.terminay.watchDirectory(dirPath);
		}

		return () => {
			unsubscribe();
			for (const dirPath of watchedPaths) {
				void window.terminay.unwatchDirectory(dirPath);
			}
		};
	}, [
		expandedPaths,
		project.isFileExplorerOpen,
		project.rootFolder,
		scheduleFileExplorerDirectoryRefresh,
	]);

	useEffect(() => {
		if (!project.rootFolder || !project.isFileExplorerOpen) {
			return;
		}

		void refreshGitStatuses();

		const intervalId = window.setInterval(() => {
			void refreshGitStatuses();
		}, FILE_EXPLORER_GIT_STATUS_POLL_INTERVAL_MS);

		const handleVisibilityChange = () => {
			if (document.visibilityState === 'visible') {
				void refreshGitStatuses();
			}
		};

		window.addEventListener('focus', refreshGitStatuses);
		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			window.clearInterval(intervalId);
			window.removeEventListener('focus', refreshGitStatuses);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	}, [project.isFileExplorerOpen, project.rootFolder, refreshGitStatuses]);

	useEffect(() => {
		const onPointerMove = (event: PointerEvent) => {
			const resizeState = explorerResizeStateRef.current;
			if (!resizeState || event.pointerId !== resizeState.pointerId) {
				return;
			}

			const nextWidth = clamp(
				resizeState.startWidth + (event.clientX - resizeState.startX),
				MIN_FILE_EXPLORER_WIDTH,
				MAX_FILE_EXPLORER_WIDTH,
			);
			onUpdateProject(project.id, { fileExplorerWidth: nextWidth });
		};

		const onPointerUp = (event: PointerEvent) => {
			const resizeState = explorerResizeStateRef.current;
			if (!resizeState || event.pointerId !== resizeState.pointerId) {
				return;
			}

			explorerResizeStateRef.current = null;
		};

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp);
		window.addEventListener('pointercancel', onPointerUp);
		return () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
			window.removeEventListener('pointercancel', onPointerUp);
		};
	}, [onUpdateProject, project.id]);

	const runMacro = useCallback(
		async (macro: MacroDefinition) => {
			const effectiveFields = macro.fields;
			if (effectiveFields.length === 0) {
				executeMacro(macro, {});
				return;
			}

			let searchRootPath = project.rootFolder;
			const activeSessionId = getActiveSessionId();
			if (activeSessionId) {
				try {
					searchRootPath =
						(await window.terminay.getTerminalCwd(activeSessionId)) ??
						project.rootFolder;
				} catch {
					searchRootPath = project.rootFolder;
				}
			}

			setMacroToRun(macro);
			setMacroFileSearchRootPath(searchRootPath);
			setMacroFieldValues(
				Object.fromEntries(
					effectiveFields.map((field) => [field.name, field.defaultValue]),
				) as Record<string, MacroFieldValue>,
			);
			setIsMacroLauncherOpen(false);
		},
		[executeMacro, getActiveSessionId, project.rootFolder],
	);

	const validateMacroValues = useCallback(
		(macro: MacroDefinition, values: Record<string, MacroFieldValue>) => {
			for (const field of macro.fields) {
				if (!field.required) {
					continue;
				}

				const value = values[field.name];
				const isMissing =
					value === undefined ||
					value === null ||
					(typeof value === 'string' && value.trim().length === 0);

				if (isMissing) {
					setErrorText(
						`"${field.label}" is required before this macro can run.`,
					);
					return false;
				}
			}

			return true;
		},
		[],
	);

	const openTerminalEditWindow = useCallback(async (panelId: string) => {
		const api = dockviewApiRef.current;
		if (!api) {
			return;
		}

		const panel = api.getPanel(panelId);
		if (!panel) {
			return;
		}

		const sessionId = panel.params?.sessionId ?? null;

		try {
			const result = await window.terminay.openTerminalEditWindow({
				activityIndicatorsEnabled: areTerminalActivityIndicatorsEnabled(
					panel.params,
				),
				color: getEffectiveTerminalTabColor(panel.params, project.color),
				emoji: panel.params?.emoji ?? '',
				inheritsProjectColor:
					panel.params?.inheritsProjectColor ?? panel.params?.color === project.color,
				projectColor: project.color,
				title: panel.title ?? 'Tab',
			});
			if (!result) {
				return;
			}

			const nextTitle =
				result.title.trim().length > 0
					? result.title.trim()
					: (panel.title ?? 'Tab');
			const nextEmoji = result.emoji.trim();
			const nextColor = result.color;

			panel.api.setTitle(nextTitle);
			panel.api.updateParameters({
				activityIndicatorsEnabled: result.activityIndicatorsEnabled,
				emoji: nextEmoji,
				color: nextColor,
				inheritsProjectColor: result.inheritsProjectColor,
				projectColor: project.color,
			});

			if (sessionId) {
				window.terminay.updateTerminalRemoteMetadata(sessionId, {
					color: nextColor,
					emoji: nextEmoji,
					inheritsProjectColor: result.inheritsProjectColor,
					title: nextTitle,
					projectId: project.id,
					projectTitle: project.title,
					projectEmoji: project.emoji,
					projectColor: project.color,
				});
			}
			window.requestAnimationFrame(publishTerminalActivityOverview);
		} finally {
			window.requestAnimationFrame(() => {
				if (sessionId) {
					activateTerminal(panelId, sessionId);
					return;
				}

				focusActiveTerminal();
			});
		}
	}, [
		activateTerminal,
		focusActiveTerminal,
		project.color,
		project.id,
		project.title,
		project.emoji,
		publishTerminalActivityOverview,
	]);

	const clearActiveTerminal = useCallback(() => {
		const sessionId = getActiveSessionId();
		if (!sessionId) {
			setErrorText('Open a terminal before clearing it.');
			return;
		}

		setErrorText(null);
		window.dispatchEvent(
			new CustomEvent('terminay-clear-terminal', {
				detail: { sessionId },
			}),
		);
		setIsMacroLauncherOpen(false);
		setMacroQuery('');
	}, [getActiveSessionId]);

	const copyActiveTerminalSelection = useCallback(() => {
		const sessionId = getActiveSessionId();
		if (!sessionId) {
			document.execCommand('copy');
			return;
		}

		window.dispatchEvent(
			new CustomEvent('terminay-copy-terminal', {
				detail: { sessionId },
			}),
		);
	}, [getActiveSessionId]);

	const openActiveTerminalSettings = useCallback(() => {
		const activePanel = dockviewApiRef.current?.activePanel;
		if (!activePanel) {
			setErrorText('Open a tab before editing its settings.');
			return;
		}

		setErrorText(null);
		setIsMacroLauncherOpen(false);
		setMacroQuery('');
		void openTerminalEditWindow(activePanel.id);
	}, [openTerminalEditWindow]);

	const openProjectSettings = useCallback(() => {
		setErrorText(null);
		setIsMacroLauncherOpen(false);
		setMacroQuery('');
		void onEditProject(project.id);
	}, [onEditProject, project.id]);

	const runAiTabMetadata = useCallback(
		async (target: AiTabMetadataTarget) => {
			setIsMacroLauncherOpen(false);
			setMacroQuery('');

			const activePanel = dockviewApiRef.current?.activePanel;
			const sessionId = activePanel?.params?.sessionId;
			if (!activePanel || !sessionId) {
				setErrorText('Open a terminal before generating tab metadata.');
				return;
			}

			const targetSettings = settings.aiTabMetadata[target];
			if (targetSettings.provider === 'disabled') {
				setErrorText(
					`Enable an AI provider for tab ${target === 'title' ? 'titles' : 'notes'} in Settings first.`,
				);
				return;
			}

			const provider = targetSettings.provider;
			const providerLabel = provider === 'codex' ? 'Codex' : 'Claude Code';
			const model = provider === 'codex' ? targetSettings.codexModel : targetSettings.claudeCodeModel;
			if (!model.trim()) {
				setErrorText(`Choose a ${providerLabel} model in Settings before generating tab metadata.`);
				return;
			}

			const inFlightKey = `${sessionId}:${target}`;
			if (aiGenerationInFlightRef.current.has(inFlightKey)) {
				setErrorText(`Already generating a tab ${target} for this terminal.`);
				return;
			}

			const reader = terminalContextReadersRef.current.get(sessionId);
			const terminalContext = reader?.() ?? { recentOutput: '' };
			const previousTitle = activePanel.title ?? 'Terminal';
			aiGenerationInFlightRef.current.add(inFlightKey);
			setErrorText(null);
			if (target === 'title') {
				activePanel.api.setTitle('Generating...');
				activePanel.api.updateParameters({ titleUpdateNonce: Date.now() });
			}

			try {
				const result = await window.terminay.generateAiTabMetadata({
					context: {
						currentTitle: previousTitle,
						existingNote: activePanel.params?.terminalNote,
						projectRoot: project.rootFolder,
						projectTitle: project.title,
						recentOutput: terminalContext.recentOutput,
						sessionId,
					},
					model,
					provider,
					target,
				});
				const text = result.text.trim();
				if (!text) {
					throw new Error(`${providerLabel} returned an empty result.`);
				}

				if (target === 'title') {
					activePanel.api.setTitle(text);
					activePanel.api.updateParameters({ titleUpdateNonce: Date.now() });
					window.terminay.updateTerminalRemoteMetadata(sessionId, {
						color: activePanel.params?.color ?? project.color,
						emoji: activePanel.params?.emoji ?? '',
						inheritsProjectColor: activePanel.params?.inheritsProjectColor,
						title: text,
						projectId: project.id,
						projectTitle: project.title,
						projectEmoji: project.emoji,
						projectColor: project.color,
					});
					window.requestAnimationFrame(publishTerminalActivityOverview);
				} else {
					activePanel.api.updateParameters({ terminalNote: text });
				}

				setErrorText(null);
			} catch (error) {
				if (target === 'title') {
					activePanel.api.setTitle(previousTitle);
					activePanel.api.updateParameters({ titleUpdateNonce: Date.now() });
				}
				const message = error instanceof Error ? error.message : String(error);
				setErrorText(`Unable to generate tab ${target}: ${message}`);
			} finally {
				aiGenerationInFlightRef.current.delete(inFlightKey);
			}
		},
		[
			project.color,
			project.emoji,
			project.id,
			project.rootFolder,
			project.title,
			publishTerminalActivityOverview,
			settings.aiTabMetadata,
		],
	);

	const createProject = useCallback(() => {
		setErrorText(null);
		setIsMacroLauncherOpen(false);
		setMacroQuery('');
		onAddProject();
	}, [onAddProject]);

	const toggleFileExplorerSidebar = useCallback(() => {
		setErrorText(null);
		setIsMacroLauncherOpen(false);
		setMacroQuery('');
		onUpdateProject(project.id, {
			isFileExplorerOpen: !project.isFileExplorerOpen,
		});
	}, [onUpdateProject, project.id, project.isFileExplorerOpen]);

	const addTerminal = useCallback(
		async (options?: AddTerminalOptions) => {
			const api = dockviewApiRef.current;
			if (!api) {
				return;
			}

			try {
				const activeSessionId = api.activePanel?.params?.sessionId;
				const inheritedCwd = activeSessionId
					? await window.terminay.getTerminalCwd(activeSessionId)
					: null;
				const { id: sessionId } = await window.terminay.createTerminal(
					inheritedCwd ? { cwd: inheritedCwd } : undefined,
				);
				suppressInitialTerminalActivity(sessionId);

				terminalCounterRef.current += 1;
				const panelId = `terminal-${terminalCounterRef.current}`;

				const panel = api.addPanel<TerminalPanelParams>({
					id: panelId,
					title: `Terminal ${terminalCounterRef.current}`,
					component: 'terminal',
					tabComponent: 'terminalTab',
					params: {
						activityIndicatorsEnabled: true,
						color: project.color,
						inheritsProjectColor: true,
						isFocused: false,
						macroRuns: [],
						onClearFinishedMacroRuns: () =>
							clearFinishedMacroRunsForSession(sessionId),
						onClearMacroRun: (runId: string) =>
							clearMacroRunForSession(sessionId, runId),
						onCancelMacroRun: cancelMacroRun,
						onMoveToProject: (targetProjectId: string) =>
							onMoveTerminalToProject(project.id, panelId, targetProjectId),
						registerTerminalContextReader,
						onUpdateNote: (terminalNote: string | undefined) =>
							dockviewApiRef.current
								?.getPanel(panelId)
								?.api.updateParameters({ terminalNote }),
						projectColor: project.color,
						projectsForMove: getProjectsForTerminalMove(),
						sessionId,
						terminalActivityState: 'viewed',
					},
					position:
						options?.groupId && api.getGroup(options.groupId)
							? {
									referenceGroup: options.groupId,
									direction: 'within',
								}
							: options?.direction && api.activePanel
								? {
										referencePanel: api.activePanel,
										direction: options.direction,
									}
								: undefined,
				});

				panelSessionMapRef.current.set(panel.id, sessionId);
				window.terminay.updateTerminalRemoteMetadata(sessionId, {
					color: project.color,
					emoji: '',
					inheritsProjectColor: true,
					title: `Terminal ${terminalCounterRef.current}`,
					projectId: project.id,
					projectTitle: project.title,
					projectEmoji: project.emoji,
					projectColor: project.color,
				});
				panel.api.setActive();
				setFocusedSessionId(sessionId);
				setErrorText(null);
				window.requestAnimationFrame(publishTerminalActivityOverview);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setErrorText(message);
			}
		},
		[
			cancelMacroRun,
			clearFinishedMacroRunsForSession,
			clearMacroRunForSession,
			getProjectsForTerminalMove,
			onMoveTerminalToProject,
			project.id,
			project.title,
			project.emoji,
			project.color,
			publishTerminalActivityOverview,
			registerTerminalContextReader,
			suppressInitialTerminalActivity,
		],
	);

	const exportTerminalForMove = useCallback(
		(panelId: string): MovedTerminalTab | null => {
			const api = dockviewApiRef.current;
			const panel = api?.getPanel(panelId);
			const sessionId = panel?.params?.sessionId;
			if (!panel || !sessionId) {
				return null;
			}

			const movedTerminal: MovedTerminalTab = {
				color: panel.params?.color,
				activityIndicatorsEnabled: panel.params?.activityIndicatorsEnabled,
				emoji: panel.params?.emoji,
				inheritsProjectColor: panel.params?.inheritsProjectColor,
				macroRuns: runningMacroRunsBySession[sessionId] ?? [],
				sessionId,
				terminalActivityState: panel.params?.terminalActivityState,
				terminalNote: panel.params?.terminalNote,
				title: panel.title ?? 'Terminal',
			};

			movingTerminalSessionIdsRef.current.add(sessionId);
			panel.api.close();

			return movedTerminal;
		},
		[runningMacroRunsBySession],
	);

	const acceptMovedTerminal = useCallback(
		(movedTerminal: MovedTerminalTab) => {
			const api = dockviewApiRef.current;
			if (!api) {
				return;
			}

			if ([...panelSessionMapRef.current.values()].includes(movedTerminal.sessionId)) {
				return;
			}

			terminalCounterRef.current += 1;
			const panelId = `terminal-${terminalCounterRef.current}`;
			const inheritsProjectColor = movedTerminal.inheritsProjectColor === true;
			const nextColor = inheritsProjectColor
				? project.color
				: (movedTerminal.color ?? project.color);
			const macroRuns = movedTerminal.macroRuns ?? [];

			const panel = api.addPanel<TerminalPanelParams>({
				id: panelId,
				title: movedTerminal.title,
				component: 'terminal',
				tabComponent: 'terminalTab',
				params: {
					activityIndicatorsEnabled:
						movedTerminal.activityIndicatorsEnabled !== false,
					color: nextColor,
					emoji: movedTerminal.emoji ?? '',
					inheritsProjectColor,
					isFocused: false,
					macroRuns,
					onClearFinishedMacroRuns: () =>
						clearFinishedMacroRunsForSession(movedTerminal.sessionId),
					onClearMacroRun: (runId: string) =>
						clearMacroRunForSession(movedTerminal.sessionId, runId),
					onCancelMacroRun: cancelMacroRun,
					onMoveToProject: (targetProjectId: string) =>
						onMoveTerminalToProject(project.id, panelId, targetProjectId),
					registerTerminalContextReader,
					onUpdateNote: (terminalNote: string | undefined) =>
						dockviewApiRef.current
							?.getPanel(panelId)
							?.api.updateParameters({ terminalNote }),
					projectColor: project.color,
					projectsForMove: getProjectsForTerminalMove(),
					sessionId: movedTerminal.sessionId,
					terminalActivityState: movedTerminal.terminalActivityState ?? 'viewed',
					terminalNote: movedTerminal.terminalNote,
				},
			});

			panelSessionMapRef.current.set(panel.id, movedTerminal.sessionId);
			if (macroRuns.length > 0) {
				setRunningMacroRunsBySession((current) => ({
					...current,
					[movedTerminal.sessionId]: macroRuns,
				}));
			}
			window.terminay.updateTerminalRemoteMetadata(movedTerminal.sessionId, {
				color: nextColor,
				emoji: movedTerminal.emoji ?? '',
				inheritsProjectColor,
				title: movedTerminal.title,
				projectId: project.id,
				projectTitle: project.title,
				projectEmoji: project.emoji,
				projectColor: project.color,
			});
			panel.api.setActive();
			setFocusedSessionId(movedTerminal.sessionId);
			setErrorText(null);
			syncPanelFocusState();
			window.requestAnimationFrame(publishTerminalActivityOverview);
		},
		[
			cancelMacroRun,
			clearFinishedMacroRunsForSession,
			clearMacroRunForSession,
			getProjectsForTerminalMove,
			onMoveTerminalToProject,
			project.color,
			project.emoji,
			project.id,
			project.title,
			publishTerminalActivityOverview,
			registerTerminalContextReader,
			syncPanelFocusState,
		],
	);

	const filteredMacros = useMemo(() => {
		const normalizedQuery = macroQuery.trim().toLowerCase();
		const commandItems: MacroLauncherItem[] = [
			{
				group: 'Terminal',
				icon: <Terminal size={18} strokeWidth={2.1} />,
				id: 'create-terminal-tab',
				title: 'Create a new terminal tab',
				description: 'Open a fresh terminal tab in the current project.',
				searchText: `create new terminal tab open fresh terminal ${getCommandShortcut(settings.keyboardShortcuts, 'new-terminal')}`,
				shortcutLabel: getCommandShortcutLabel(
					settings.keyboardShortcuts,
					'new-terminal',
					isMac,
				),
				onSelect: () => {
					setErrorText(null);
					setIsMacroLauncherOpen(false);
					setMacroQuery('');
					void addTerminal({});
				},
			},
			{
				group: 'Workspace',
				icon: <FolderPlus size={18} strokeWidth={2.1} />,
				id: 'create-project',
				title: 'Create a new project',
				description: 'Add a new project tab and switch to it.',
				searchText: `create new project add project tab ${getCommandShortcut(settings.keyboardShortcuts, 'new-project')}`,
				shortcutLabel: getCommandShortcutLabel(
					settings.keyboardShortcuts,
					'new-project',
					isMac,
				),
				onSelect: () => {
					createProject();
				},
			},
			{
				group: 'Terminal',
				icon: <Eraser size={18} strokeWidth={2.1} />,
				id: 'clear-terminal',
				title: 'Clear terminal',
				description: 'Clear the active terminal viewport and scrollback.',
				searchText: `clear terminal scrollback screen reset ${getCommandShortcut(settings.keyboardShortcuts, 'clear-terminal')}`,
				shortcutLabel: getCommandShortcutLabel(
					settings.keyboardShortcuts,
					'clear-terminal',
					isMac,
				),
				onSelect: () => {
					clearActiveTerminal();
				},
			},
			{
				group: 'Terminal',
				icon: <Sparkles size={18} strokeWidth={2.1} />,
				id: 'set-tab-title-with-ai',
				title: 'Set tab title with AI',
				description: 'Generate a concise title for the active terminal tab.',
				searchText: 'set tab title with ai codex rename generate terminal metadata',
				onSelect: () => {
					void runAiTabMetadata('title');
				},
			},
			{
				group: 'Terminal',
				icon: <Sparkles size={18} strokeWidth={2.1} />,
				id: 'set-tab-note-with-ai',
				title: 'Set tab note with AI',
				description: 'Generate a short note for the active terminal tab.',
				searchText: 'set tab note with ai codex generate terminal note metadata',
				onSelect: () => {
					void runAiTabMetadata('note');
				},
			},
			{
				group: 'Terminal',
				icon: <Settings size={18} strokeWidth={2.1} />,
				id: 'edit-tab-settings',
				title: 'Edit tab settings',
				description: 'Open settings for the active tab.',
				searchText: 'edit tab settings rename emoji color file folder terminal',
				onSelect: () => {
					openActiveTerminalSettings();
				},
			},
			{
				group: 'Workspace',
				icon: <Settings size={18} strokeWidth={2.1} />,
				id: 'edit-project-settings',
				title: 'Edit project settings',
				description: 'Open settings for the current project tab.',
				searchText: 'edit project settings project tab root folder emoji color',
				onSelect: () => {
					openProjectSettings();
				},
			},
			{
				group: 'Workspace',
				icon: <Sidebar size={18} strokeWidth={2.1} />,
				id: 'toggle-file-explorer-sidebar',
				title: project.isFileExplorerOpen
					? 'Hide file explorer sidebar'
					: 'Show file explorer sidebar',
				description: project.isFileExplorerOpen
					? 'Hide the file explorer sidebar for this project.'
					: 'Show the file explorer sidebar for this project.',
				searchText:
					'toggle file explorer sidebar show hide explorer sidebar project',
				onSelect: () => {
					toggleFileExplorerSidebar();
				},
			},
			{
				group: 'Workspace',
				icon: <FolderSync size={18} strokeWidth={2.1} />,
				id: 'set-project-root-folder-to-working-directory',
				title: 'Set project root folder to working directory',
				description:
					'Use the active terminal working directory as this project root folder.',
				searchText:
					`set project root folder working directory cwd active terminal root folder ${getCommandShortcut(settings.keyboardShortcuts, 'set-project-root-folder-to-working-directory')}`,
				shortcutLabel: getCommandShortcutLabel(
					settings.keyboardShortcuts,
					'set-project-root-folder-to-working-directory',
					isMac,
				),
				onSelect: () => {
					void setProjectRootFolderToWorkingDirectory();
				},
			},
			...macros.map((macro): MacroLauncherItem => ({
				group: 'Macros',
				icon: <Play size={18} strokeWidth={2.1} />,
				id: macro.id,
				title: macro.title,
				description:
					macro.description ||
					(macro.steps[0]?.type === 'type'
						? macro.steps[0].content
						: 'Multi-step macro'),
				searchText: [
					macro.title,
					macro.description,
					...macro.fields.map((field) => `${field.label} ${field.name}`),
					...macro.steps.map((step) =>
						step.type === 'type' ? step.content : '',
					),
				]
					.join(' ')
					.toLowerCase(),
				shortcutLabel: '',
				onSelect: () => runMacro(macro),
			})),
		];

		if (!normalizedQuery) {
			return commandItems;
		}

		return commandItems
			.map((macro, index) => ({
				macro,
				index,
				score: getCommandSearchScore(macro, normalizedQuery),
			}))
			.filter(({ score }) => score > 0)
			.sort((left, right) => {
				if (right.score !== left.score) {
					return right.score - left.score;
				}

				return left.index - right.index;
			})
			.map(({ macro }) => macro);
	}, [
		addTerminal,
		clearActiveTerminal,
		createProject,
		isMac,
		macroQuery,
		macros,
		openActiveTerminalSettings,
		openProjectSettings,
		project.isFileExplorerOpen,
		runAiTabMetadata,
		runMacro,
		settings.keyboardShortcuts,
		setProjectRootFolderToWorkingDirectory,
		toggleFileExplorerSidebar,
	]);
	const activeMacroId = filteredMacros[selectedMacroIndex]?.id ?? null;
	const macroLauncherGroups = useMemo(() => {
		const groups = new Map<MacroLauncherGroup, MacroLauncherGroupedItem[]>();

		filteredMacros.forEach((item, index) => {
			const groupItems = groups.get(item.group) ?? [];
			groupItems.push({ index, item });
			groups.set(item.group, groupItems);
		});

		return (['Terminal', 'Workspace', 'Macros'] as const)
			.map((group) => ({
				group,
				items: groups.get(group) ?? [],
			}))
			.filter(({ items }) => items.length > 0);
	}, [filteredMacros]);

	const closeActivePanel = useCallback(() => {
		dockviewApiRef.current?.activePanel?.api.close();
	}, []);

	const saveActivePanel = useCallback(async () => {
		const activePanel = dockviewApiRef.current?.activePanel;
		const saveHandler = activePanel?.params?.onSave;
		if (!saveHandler) {
			return;
		}

		try {
			const didSave = await saveHandler();
			if (didSave) {
				void refreshGitStatuses();
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorText(message);
		}
	}, [refreshGitStatuses]);

	const popoutActivePanel = useCallback(async () => {
		const api = dockviewApiRef.current;
		const activePanel = api?.activePanel;

		if (!api || !activePanel) {
			return;
		}

		await api.addPopoutGroup(activePanel, {
			popoutUrl,
		});
	}, [popoutUrl]);

	const executeAppCommand = useCallback(
		(command: AppCommand) => {
			switch (command) {
				case 'new-terminal':
					void addTerminal({});
					break;
				case 'new-project':
					onAddProject();
					break;
				case 'split-horizontal':
					void addTerminal({ direction: 'below' });
					break;
				case 'split-vertical':
					void addTerminal({ direction: 'right' });
					break;
				case 'save-active':
					void saveActivePanel();
					break;
				case 'popout-active':
					void popoutActivePanel();
					break;
				case 'close-active':
					closeActivePanel();
					break;
				case 'clear-terminal':
					clearActiveTerminal();
					break;
				case 'open-command-bar':
					setMacroQuery('');
					setSelectedMacroIndex(0);
					setIsMacroLauncherOpen(true);
					setMacroToRun(null);
					setMacroFieldValues({});
					break;
				case 'set-project-root-folder-to-working-directory':
					void setProjectRootFolderToWorkingDirectory();
					break;
				default:
					break;
			}
		},
		[
			addTerminal,
			clearActiveTerminal,
			closeActivePanel,
			onAddProject,
			popoutActivePanel,
			saveActivePanel,
			setProjectRootFolderToWorkingDirectory,
		],
	);

	useEffect(() => {
		if (!isActive) {
			return;
		}

		const unsubscribeCopyRequest = window.terminay.onTerminalCopyRequested(
			copyActiveTerminalSelection,
		);

		return () => {
			unsubscribeCopyRequest();
		};
	}, [copyActiveTerminalSelection, isActive]);

	useEffect(() => {
		if (!isActive) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) {
				return;
			}

			const command = findCommandForKeyboardEvent(
				event,
				settings.keyboardShortcuts,
				isMac,
			);
			if (!command) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			if (!event.repeat) {
				executeAppCommand(command);
			}
		};

		window.addEventListener('keydown', onKeyDown, true);
		return () => {
			window.removeEventListener('keydown', onKeyDown, true);
		};
	}, [executeAppCommand, isActive, isMac, settings.keyboardShortcuts]);

	useImperativeHandle(
		ref,
		() => ({
			acceptMovedTerminal,
			activateTerminal,
			executeCommand(command: AppCommand) {
				executeAppCommand(command);
			},
			exportTerminalForMove,
			focusActiveTerminal,
		}),
		[
			acceptMovedTerminal,
			activateTerminal,
			executeAppCommand,
			exportTerminalForMove,
			focusActiveTerminal,
		],
	);

	useEffect(() => {
		publishTerminalActivityOverview();
	}, [publishTerminalActivityOverview]);

	useEffect(() => {
		focusedSessionIdRef.current = focusedSessionId;
		for (const sessionId of panelSessionMapRef.current.values()) {
			evaluateTerminalActivityState(sessionId);
		}
	}, [evaluateTerminalActivityState, focusedSessionId]);

	useEffect(() => {
		syncFocusedTerminalTabs(focusedSessionId);
	}, [focusedSessionId, syncFocusedTerminalTabs]);

	useEffect(() => {
		syncRunningMacroTabs();
	}, [syncRunningMacroTabs]);

	const handleReady = useCallback(
		(event: DockviewReadyEvent) => {
			dockviewApiRef.current = event.api;
			initialTerminalSeededRef.current = false;
			setIsDockviewReady(true);

			event.api.onDidRemovePanel((panel) => {
				const sessionId = panelSessionMapRef.current.get(panel.id);
				const closeProjectIfEmpty = () => {
					window.requestAnimationFrame(() => {
						const hasPanels = event.api.groups.some(
							(group) => group.panels.length > 0,
						);
						if (!hasPanels) {
							onCloseProject(project.id);
						}
					});
				};

				if (!sessionId) {
					const fileEntry = [...filePathPanelMapRef.current.entries()].find(
						([, candidatePanelId]) => candidatePanelId === panel.id,
					);
					if (fileEntry) {
						filePathPanelMapRef.current.delete(fileEntry[0]);
					}
					const folderEntry = [...folderPathPanelMapRef.current.entries()].find(
						([, candidatePanelId]) => candidatePanelId === panel.id,
					);
					if (folderEntry) {
						folderPathPanelMapRef.current.delete(folderEntry[0]);
					}
					closeProjectIfEmpty();
					return;
				}

				panelSessionMapRef.current.delete(panel.id);
				const isMovingTerminal =
					movingTerminalSessionIdsRef.current.delete(sessionId);
				const activityTimer = terminalActivityTimersRef.current.get(sessionId);
				if (activityTimer !== undefined) {
					window.clearTimeout(activityTimer);
					terminalActivityTimersRef.current.delete(sessionId);
				}
				terminalActivityStoreRef.current.deleteSession(sessionId);
				clearMacroRunsForSession(sessionId);
				setFocusedSessionId((current) =>
					current === sessionId
						? (event.api.activePanel?.params?.sessionId ?? null)
						: current,
				);
				if (isMovingTerminal) {
					window.requestAnimationFrame(publishTerminalActivityOverview);
					return;
				}
				cancelMacroRunsForSession(sessionId);
				window.terminay.killTerminal(sessionId);
				window.requestAnimationFrame(publishTerminalActivityOverview);
				closeProjectIfEmpty();
			});
			event.api.onDidActivePanelChange(() => {
				const previousFocusedSessionId = focusedSessionIdRef.current;
				const nextFocusedSessionId =
					event.api.activePanel?.params?.sessionId ?? null;
				if (
					previousFocusedSessionId &&
					previousFocusedSessionId !== nextFocusedSessionId
				) {
					markTerminalActivityViewed(previousFocusedSessionId);
				}
				syncPanelFocusState();
			});
		},
		[
			cancelMacroRunsForSession,
			clearMacroRunsForSession,
			markTerminalActivityViewed,
			onCloseProject,
			project.id,
			publishTerminalActivityOverview,
			syncPanelFocusState,
		],
	);

	useEffect(() => {
		if (!isDockviewReady) {
			return;
		}

		const api = dockviewApiRef.current;
		if (!api || initialTerminalSeededRef.current) {
			return;
		}

		const hasPanels = api.groups.some((group) => group.panels.length > 0);
		if (hasPanels) {
			initialTerminalSeededRef.current = true;
			return;
		}

		initialTerminalSeededRef.current = true;
		void addTerminal({});
	}, [addTerminal, isDockviewReady]);

	useEffect(() => {
		const onOpenFileEvent = (event: Event) => {
			const customEvent = event as CustomEvent<{ path?: string }>;
			const filePath = customEvent.detail?.path;
			if (!filePath) {
				return;
			}
			void openFile(filePath);
		};

		window.addEventListener('terminay-open-file', onOpenFileEvent);
		return () => {
			window.removeEventListener('terminay-open-file', onOpenFileEvent);
		};
	}, [openFile]);

	useEffect(() => {
		const onTerminalFocused = (event: Event) => {
			const customEvent = event as CustomEvent<{ sessionId?: string }>;
			const sessionId = customEvent.detail?.sessionId ?? null;
			focusedSessionIdRef.current = sessionId;
			setFocusedSessionId(sessionId);
			markTerminalActivityViewed(sessionId);
		};

		window.addEventListener('terminay-terminal-focused', onTerminalFocused);
		return () => {
			window.removeEventListener('terminay-terminal-focused', onTerminalFocused);
		};
	}, [markTerminalActivityViewed]);

	useEffect(() => {
		return window.terminay.onTerminalData((message) => {
			if (!getPanelForSession(message.id)) {
				return;
			}

			const now = Date.now();
			applyTerminalActivityEvaluation(
				message.id,
				terminalActivityStoreRef.current.recordTerminalActivity(
					message.id,
					now,
				),
			);
		});
	}, [applyTerminalActivityEvaluation, getPanelForSession]);

	useEffect(() => {
		const onTerminalUserInput = (event: Event) => {
			const customEvent = event as CustomEvent<{ sessionId?: string }>;
			const sessionId = customEvent.detail?.sessionId;
			if (!sessionId || !getPanelForSession(sessionId)) {
				return;
			}

			applyTerminalActivityEvaluation(
				sessionId,
				terminalActivityStoreRef.current.recordUserInput(sessionId),
			);
		};

		window.addEventListener('terminay-terminal-user-input', onTerminalUserInput);
		return () => {
			window.removeEventListener('terminay-terminal-user-input', onTerminalUserInput);
		};
	}, [applyTerminalActivityEvaluation, getPanelForSession]);

	useEffect(() => {
		return () => {
			onTerminalActivityOverviewChange(project.id, []);
			for (const timer of terminalActivityTimersRef.current.values()) {
				window.clearTimeout(timer);
			}
			terminalActivityTimersRef.current.clear();
			terminalActivityStoreRef.current.clear();
		};
	}, [onTerminalActivityOverviewChange, project.id]);

	useEffect(() => {
		return window.terminay.onTerminalExit((message) => {
			cancelMacroRunsForSession(message.id);

			if (settings.autoCloseTerminalOnExitZero && message.exitCode === 0) {
				getPanelForSession(message.id)?.api.close();
			}
		});
	}, [
		cancelMacroRunsForSession,
		getPanelForSession,
		settings.autoCloseTerminalOnExitZero,
	]);

	useEffect(() => {
		if (!isActive) {
			return;
		}

		const cleanupByWindow = new Map<Window, () => void>();
		const apiDisposables: Array<{ dispose: () => void }> = [];

		const addTerminalInHeaderSpace = (
			targetWindow: Window,
			target: HTMLElement | null,
			point?: { x: number; y: number },
		) => {
			const api = dockviewApiRef.current;
			if (!api) {
				return;
			}

			let groupElement: HTMLElement | null = target?.closest(
				'.dv-groupview',
			) as HTMLElement | null;

			const emptyHeaderSpace = target?.closest(
				'.dv-void-container',
			) as HTMLElement | null;
			if (emptyHeaderSpace) {
				groupElement = emptyHeaderSpace.closest(
					'.dv-groupview',
				) as HTMLElement | null;
			}

			if (!groupElement && point) {
				const hitElements = targetWindow.document.elementsFromPoint(
					point.x,
					point.y,
				);
				const emptySpaceFromPoint = hitElements.find(
					(element): element is HTMLElement =>
						element instanceof HTMLElement &&
						element.classList.contains('dv-void-container'),
				);

				if (emptySpaceFromPoint) {
					groupElement = emptySpaceFromPoint.closest(
						'.dv-groupview',
					) as HTMLElement | null;
				}
			}

			if (!groupElement && point) {
				const hitElements = targetWindow.document.elementsFromPoint(
					point.x,
					point.y,
				);
				const headerContainer = hitElements.find(
					(element): element is HTMLElement =>
						element instanceof HTMLElement &&
						element.classList.contains('dv-tabs-and-actions-container'),
				);

				if (headerContainer) {
					const headerRect = headerContainer.getBoundingClientRect();
					const inHeader =
						point.x >= headerRect.left &&
						point.x <= headerRect.right &&
						point.y >= headerRect.top &&
						point.y <= headerRect.bottom;

					const tabsContainer = headerContainer.querySelector(
						'.dv-tabs-container',
					) as HTMLElement | null;
					const rightActions = headerContainer.querySelector(
						'.dv-right-actions-container',
					) as HTMLElement | null;

					const inTabs = (() => {
						if (!tabsContainer) {
							return false;
						}

						const tabsRect = tabsContainer.getBoundingClientRect();
						return (
							point.x >= tabsRect.left &&
							point.x <= tabsRect.right &&
							point.y >= tabsRect.top &&
							point.y <= tabsRect.bottom
						);
					})();

					const inRightActions = (() => {
						if (!rightActions) {
							return false;
						}

						const actionsRect = rightActions.getBoundingClientRect();
						return (
							point.x >= actionsRect.left &&
							point.x <= actionsRect.right &&
							point.y >= actionsRect.top &&
							point.y <= actionsRect.bottom
						);
					})();

					if (inHeader && !inTabs && !inRightActions) {
						groupElement = headerContainer.closest(
							'.dv-groupview',
						) as HTMLElement | null;
					}
				}
			}

			if (!groupElement) {
				return;
			}

			const group = api.groups.find((candidate) =>
				candidate.element.contains(groupElement),
			);
			if (!group) {
				return;
			}

			void addTerminal({ groupId: group.id });
		};

		const isEmptyHeaderDoubleClick = (
			targetWindow: Window,
			target: HTMLElement | null,
			point: { x: number; y: number },
		): boolean => {
			if (
				target?.closest('.terminay-add-tab-button') ||
				target?.closest('.dv-tab') ||
				target?.closest('.dv-right-actions-container')
			) {
				return false;
			}

			const hitElements = targetWindow.document.elementsFromPoint(
				point.x,
				point.y,
			);
			if (
				hitElements.some(
					(element) =>
						element instanceof HTMLElement &&
						(element.classList.contains('dv-tab') ||
							element.closest('.dv-tab') ||
							element.classList.contains('dv-right-actions-container') ||
							element.closest('.dv-right-actions-container')),
				)
			) {
				return false;
			}

			return hitElements.some(
				(element) =>
					element instanceof HTMLElement &&
					element.classList.contains('dv-void-container'),
			);
		};

		const ensureHeaderButtons = (targetWindow: Window) => {
			const containers =
				targetWindow.document.querySelectorAll<HTMLElement>(
					'.dv-void-container',
				);

			for (const container of containers) {
				if (container.querySelector('.terminay-add-tab-button')) {
					continue;
				}

				const button = targetWindow.document.createElement('button');
				button.type = 'button';
				button.className = 'terminay-add-tab-button';
				button.setAttribute('aria-label', 'New terminal tab');
				button.title = 'New terminal tab';
				button.innerHTML = `
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 2V10M2 6H10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          `;
				container.appendChild(button);
			}
		};

		const addListenersForWindow = (targetWindow: Window) => {
			if (cleanupByWindow.has(targetWindow)) {
				return;
			}

			ensureHeaderButtons(targetWindow);

			const onClick = (event: PointerEvent) => {
				const target = event.target as HTMLElement | null;
				const addTabButton = target?.closest('.terminay-add-tab-button');

				if (!addTabButton) {
					return;
				}

				event.preventDefault();
				event.stopPropagation();
				addTerminalInHeaderSpace(targetWindow, target, {
					x: event.clientX,
					y: event.clientY,
				});
			};

			const onDblClick = (event: globalThis.MouseEvent) => {
				const target = event.target as HTMLElement | null;
				if (!target?.closest('.dv-void-container')) {
					return;
				}

				const point = {
					x: event.clientX,
					y: event.clientY,
				};
				if (!isEmptyHeaderDoubleClick(targetWindow, target, point)) {
					return;
				}

				addTerminalInHeaderSpace(targetWindow, target, point);
			};

			const onEditTerminal = (event: Event) => {
				const customEvent = event as CustomEvent<{ panelId: string }>;
				if (customEvent.detail?.panelId) {
					void openTerminalEditWindow(customEvent.detail.panelId);
				}
			};

			const onDragStart = () => {
				targetWindow.requestAnimationFrame(() => {
					const data = getPanelData();
					if (!data) {
						return;
					}

					draggingTransferRef.current = {
						panelId: data.panelId ?? undefined,
						groupId: data.groupId,
					};
				});
			};

			const onDragEnd = (event: DragEvent) => {
				const transfer = draggingTransferRef.current;
				draggingTransferRef.current = null;

				if (!transfer) {
					return;
				}

				const droppedOutsideWindow =
					event.clientX <= 0 ||
					event.clientY <= 0 ||
					event.clientX >= targetWindow.innerWidth ||
					event.clientY >= targetWindow.innerHeight;

				if (!droppedOutsideWindow) {
					return;
				}

				const api = dockviewApiRef.current;
				if (!api) {
					return;
				}

				const item = transfer.panelId
					? api.getPanel(transfer.panelId)
					: api.getGroup(transfer.groupId)?.activePanel;
				if (!item) {
					return;
				}

				void api.addPopoutGroup(item, { popoutUrl });
			};

			targetWindow.addEventListener('click', onClick, true);
			targetWindow.addEventListener('dblclick', onDblClick, true);
			targetWindow.addEventListener('terminay-edit-terminal', onEditTerminal);
			targetWindow.addEventListener('dragstart', onDragStart, true);
			targetWindow.addEventListener('dragend', onDragEnd, true);

			cleanupByWindow.set(targetWindow, () => {
				targetWindow.removeEventListener('click', onClick, true);
				targetWindow.removeEventListener('dblclick', onDblClick, true);
				targetWindow.removeEventListener(
					'terminay-edit-terminal',
					onEditTerminal,
				);
				targetWindow.removeEventListener('dragstart', onDragStart, true);
				targetWindow.removeEventListener('dragend', onDragEnd, true);
			});
		};

		const collectDockviewWindows = (): Set<Window> => {
			const result = new Set<Window>([window]);
			const api = dockviewApiRef.current;

			if (!api) {
				return result;
			}

			for (const group of api.groups) {
				const panel = group.activePanel ?? group.panels[0];
				if (!panel) {
					continue;
				}

				try {
					result.add(panel.api.getWindow());
				} catch {
					// Ignore transient windows during popout transitions.
				}
			}

			return result;
		};

		const reconcileWindowListeners = () => {
			const liveWindows = collectDockviewWindows();

			for (const targetWindow of liveWindows) {
				addListenersForWindow(targetWindow);
				ensureHeaderButtons(targetWindow);
			}

			for (const [targetWindow, cleanup] of cleanupByWindow.entries()) {
				if (liveWindows.has(targetWindow)) {
					continue;
				}

				cleanup();
				cleanupByWindow.delete(targetWindow);
			}
		};

		reconcileWindowListeners();

		const api = dockviewApiRef.current;
		if (api) {
			apiDisposables.push(
				api.onDidAddGroup(reconcileWindowListeners),
				api.onDidRemoveGroup(reconcileWindowListeners),
				api.onDidMovePanel(reconcileWindowListeners),
				api.onDidActivePanelChange(reconcileWindowListeners),
			);
		}

		const interval = window.setInterval(reconcileWindowListeners, 500);

		return () => {
			window.clearInterval(interval);
			for (const disposable of apiDisposables) {
				disposable.dispose();
			}
			for (const cleanup of cleanupByWindow.values()) {
				cleanup();
			}
			cleanupByWindow.clear();
		};
	}, [addTerminal, isActive, openTerminalEditWindow, popoutUrl]);

	useEffect(() => {
		if (!isActive) {
			return;
		}

		const api = dockviewApiRef.current;
		const workspace = workspaceRef.current;
		if (!api || !workspace) {
			return;
		}

		const { clientWidth, clientHeight } = workspace;
		if (clientWidth > 0 && clientHeight > 0) {
			api.layout(clientWidth, clientHeight);
		}

		if (isMacroLauncherOpen || macroToRun || isTerminalSwitcherOpen) {
			return;
		}

		const frame = window.requestAnimationFrame(() => {
			focusActiveTerminal();
		});

		return () => {
			window.cancelAnimationFrame(frame);
		};
	}, [
		focusActiveTerminal,
		isActive,
		isMacroLauncherOpen,
		isTerminalSwitcherOpen,
		macroToRun,
	]);

	useEffect(() => {
		if (!isActive) {
			return;
		}

		const sidebarWidth = project.fileExplorerWidth;
		const explorerIsOpen = project.isFileExplorerOpen;
		void sidebarWidth;
		void explorerIsOpen;

		const api = dockviewApiRef.current;
		const workspace = workspaceRef.current;
		if (!api || !workspace) {
			return;
		}

		const { clientWidth, clientHeight } = workspace;
		if (clientWidth > 0 && clientHeight > 0) {
			api.layout(clientWidth, clientHeight);
		}
	}, [isActive, project.fileExplorerWidth, project.isFileExplorerOpen]);

	useEffect(() => {
		if (!isActive || isMacroLauncherOpen || macroToRun) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) {
				return;
			}

			if (
				event.altKey &&
				!event.ctrlKey &&
				!event.metaKey &&
				event.key === 'Tab'
			) {
				const target = event.target;
				if (
					target instanceof HTMLElement &&
					(target.closest('.terminal-panel') ||
						target.closest('.xterm') ||
						target.classList.contains('xterm-helper-textarea'))
				) {
					return;
				}

				event.preventDefault();
				if (event.repeat) {
					return;
				}

				if (isTerminalSwitcherOpen) {
					moveTerminalSwitcherSelection(event.shiftKey ? -1 : 1);
					return;
				}

				openTerminalSwitcher(event.shiftKey ? -1 : 1);
				return;
			}

			if (!isTerminalSwitcherOpen) {
				return;
			}

			if (event.key === 'Escape') {
				event.preventDefault();
				closeTerminalSwitcher();
			}
		};

		const onSwitcherRequest = (event: Event) => {
			const customEvent = event as CustomEvent<{ direction?: 1 | -1 }>;
			const direction = customEvent.detail?.direction === -1 ? -1 : 1;

			if (isTerminalSwitcherOpen) {
				moveTerminalSwitcherSelection(direction);
				return;
			}

			openTerminalSwitcher(direction);
		};

		const onKeyUp = (event: KeyboardEvent) => {
			if (!isTerminalSwitcherOpen) {
				return;
			}

			if (event.key === 'Alt') {
				event.preventDefault();
				commitTerminalSwitcherSelection();
			}
		};

		const onBlur = () => {
			if (isTerminalSwitcherOpen) {
				commitTerminalSwitcherSelection();
			}
		};

		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		window.addEventListener(OPEN_TERMINAL_SWITCHER_EVENT, onSwitcherRequest);
		window.addEventListener('blur', onBlur);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener(
				OPEN_TERMINAL_SWITCHER_EVENT,
				onSwitcherRequest,
			);
			window.removeEventListener('blur', onBlur);
		};
	}, [
		closeTerminalSwitcher,
		commitTerminalSwitcherSelection,
		isActive,
		isMacroLauncherOpen,
		isTerminalSwitcherOpen,
		macroToRun,
		moveTerminalSwitcherSelection,
		openTerminalSwitcher,
	]);

	useEffect(() => {
		if (!isMacroLauncherOpen) {
			return;
		}

		window.requestAnimationFrame(() => {
			macroLauncherInputRef.current?.focus();
			macroLauncherInputRef.current?.select();
		});
	}, [isMacroLauncherOpen]);

	useEffect(() => {
		if (filteredMacros.length === 0) {
			setSelectedMacroIndex(0);
			return;
		}

		setSelectedMacroIndex((current) =>
			Math.min(current, filteredMacros.length - 1),
		);
	}, [filteredMacros.length]);

	useEffect(() => {
		if (!isMacroLauncherOpen) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				closeMacroLauncher();
				return;
			}

			if (event.key === 'ArrowDown') {
				event.preventDefault();
				setSelectedMacroIndex((current) =>
					filteredMacros.length === 0
						? 0
						: (current + 1) % filteredMacros.length,
				);
				return;
			}

			if (event.key === 'ArrowUp') {
				event.preventDefault();
				setSelectedMacroIndex((current) =>
					filteredMacros.length === 0
						? 0
						: (current - 1 + filteredMacros.length) % filteredMacros.length,
				);
				return;
			}

			if (event.key === 'Enter') {
				event.preventDefault();
				const macro = filteredMacros[selectedMacroIndex];
				if (macro) {
					macro.onSelect();
				}
			}
		};

		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [
		closeMacroLauncher,
		filteredMacros,
		isMacroLauncherOpen,
		selectedMacroIndex,
	]);

	useEffect(() => {
		if (!isMacroLauncherOpen) {
			return;
		}

		const list = macroLauncherListRef.current;
		const activeItem = activeMacroId
			? macroLauncherItemRefs.current.get(activeMacroId)
			: null;
		if (!list || !activeItem) {
			return;
		}

		const animationFrameId = window.requestAnimationFrame(() => {
			activeItem.scrollIntoView({
				block: 'nearest',
				inline: 'nearest',
				behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
					? 'auto'
					: 'smooth',
			});
		});

		return () => {
			window.cancelAnimationFrame(animationFrameId);
		};
	}, [activeMacroId, isMacroLauncherOpen]);

	useEffect(() => {
		if (!macroToRun) {
			return;
		}

		window.requestAnimationFrame(() => {
			firstMacroFieldRef.current?.focus();
		});

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				closeMacroParameterModal();
			}
		};

		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [closeMacroParameterModal, macroToRun]);

	return (
		<section
			className={`project-workspace${isActive ? ' project-workspace--active' : ''}${isMac ? ' project-workspace--macos' : ''}`}
		>
			{errorText ? (
				<div className="error-banner">Terminal error: {errorText}</div>
			) : null}

			<div className="project-workspace-body">
				{project.isFileExplorerOpen ? (
					<aside
						className="file-explorer-sidebar"
						style={{ width: `${project.fileExplorerWidth}px` }}
					>
						<div className="file-explorer-sidebar__body">
							<FileExplorerTree
								directoryChildren={directoryChildren}
								directoryErrors={directoryErrors}
								expandedPaths={expandedPaths}
								gitStatuses={gitStatuses}
								loadingPaths={loadingPaths}
								onOpenFile={openFile}
								onOpenFolder={openFolder}
								onToggleDirectory={toggleDirectory}
								onRename={handleRename}
								onDelete={handleDelete}
								onNewFile={handleNewFile}
								onNewFolder={handleNewFolder}
								onOpenTerminal={handleOpenTerminalAt}
								rootPath={project.rootFolder}
							/>
						</div>

						<div
							className="file-explorer-sidebar__resizer"
							onPointerDown={(event) => {
								explorerResizeStateRef.current = {
									pointerId: event.pointerId,
									startWidth: project.fileExplorerWidth,
									startX: event.clientX,
								};
								(event.currentTarget as HTMLDivElement).setPointerCapture(
									event.pointerId,
								);
							}}
						/>
					</aside>
				) : null}

				<main
					ref={(element) => {
						workspaceRef.current = element;
					}}
					className="workspace dockview-theme-dark"
				>
					<DockviewReact
						components={{
							file: FilePanel,
							folder: FolderPanel,
							terminal: TerminalPanel,
						}}
						tabComponents={{
							fileTab: FileTab,
							folderTab: FolderTab,
							terminalTab: TerminalTab,
						}}
						popoutUrl={popoutUrl}
						onReady={handleReady}
						floatingGroupBounds="boundedWithinViewport"
					/>
				</main>
			</div>

			<AnimatePresence>
				{isMacroLauncherOpen && (
					<div className="macro-launcher-overlay" onClick={closeMacroLauncher}>
						<motion.div
							initial={{ opacity: 0, scale: 0.98, y: -20 }}
							animate={{ opacity: 1, scale: 1, y: 0 }}
							exit={{ opacity: 0, scale: 0.98, y: -10 }}
							transition={{ duration: 0.15, ease: 'easeOut' }}
							className="macro-launcher"
							role="dialog"
							aria-modal="true"
							aria-label="Command bar"
							onClick={(e) => e.stopPropagation()}
						>
							<div className="macro-launcher-search-container">
								<div className="macro-launcher-search-icon">
									<Search size={20} strokeWidth={2.5} aria-hidden="true" />
								</div>
								<input
									ref={macroLauncherInputRef}
									type="search"
									className="macro-launcher-input"
									value={macroQuery}
									onChange={(event) => {
										setMacroQuery(event.target.value);
										setSelectedMacroIndex(0);
									}}
									aria-label="Search commands"
									placeholder="Search commands..."
									spellCheck={false}
									autoComplete="off"
								/>
								<div className="macro-launcher-shortcut">
									<span>ESC</span>
								</div>
							</div>

							<div ref={macroLauncherListRef} className="macro-launcher-list">
								{filteredMacros.length === 0 ? (
									<div className="macro-launcher-empty">
										<p>No commands match your search.</p>
									</div>
								) : (
									macroLauncherGroups.map(({ group, items }) => (
										<section className="macro-launcher-group" key={group}>
											<div className="macro-launcher-group-label">{group}</div>
											<div className="macro-launcher-group-items">
												{items.map(({ item: macro, index }) => (
													<button
														key={macro.id}
														type="button"
														ref={(element) => {
															if (element) {
																macroLauncherItemRefs.current.set(
																	macro.id,
																	element,
																);
																return;
															}

															macroLauncherItemRefs.current.delete(macro.id);
														}}
														className={`macro-launcher-item ${index === selectedMacroIndex ? 'macro-launcher-item--active' : ''}`}
														onMouseEnter={() => setSelectedMacroIndex(index)}
														onClick={() => macro.onSelect()}
													>
														<span className="macro-launcher-item-icon">
															{macro.icon}
														</span>
														<div className="macro-launcher-item-content">
															<span className="macro-launcher-item-title">
																{macro.title}
															</span>
															<span className="macro-launcher-item-description">
																{macro.description}
															</span>
														</div>
														<div className="macro-launcher-item-actions">
															{macro.shortcutLabel ? (
																<span className="macro-launcher-command-shortcut">
																	{macro.shortcutLabel}
																</span>
															) : null}
															{index === selectedMacroIndex && (
																<div className="macro-launcher-item-hint">
																	<span>⏎</span>
																</div>
															)}
														</div>
													</button>
												))}
											</div>
										</section>
									))
								)}
							</div>

							<div className="macro-launcher-footer">
								<div className="macro-launcher-footer-hint">
									<span className="macro-launcher-key">↑↓</span> to navigate
								</div>
								<div className="macro-launcher-footer-hint">
									<span className="macro-launcher-key">⏎</span> to run
								</div>
							</div>
						</motion.div>
					</div>
				)}
			</AnimatePresence>

			{isTerminalSwitcherOpen ? (
				<div
					className="terminal-switcher"
					role="dialog"
					aria-modal="true"
					aria-label="Terminal switcher"
				>
					<div className="terminal-switcher-panel">
						<div className="terminal-switcher-header">
							<p className="terminal-switcher-kicker">Alt+Tab</p>
							<span className="terminal-switcher-hint">
								Release Alt to switch
							</span>
						</div>
						<div className="terminal-switcher-list">
							{terminalSwitcherItems.map((item, index) => (
								<button
									key={item.panelId}
									type="button"
									className={`terminal-switcher-item${index === terminalSwitcherIndex ? ' terminal-switcher-item--active' : ''}`}
									onMouseEnter={() => {
										terminalSwitcherSelectionRef.current = index;
										setTerminalSwitcherIndex(index);
									}}
									onClick={() => {
										terminalSwitcherSelectionRef.current = index;
										setTerminalSwitcherIndex(index);
										commitTerminalSwitcherSelection();
									}}
								>
									<span
										className="terminal-switcher-item-preview"
										style={{ '--tab-color': item.color } as CSSProperties}
									>
										<span className="terminal-switcher-item-dot" />
										<span
											className="terminal-switcher-item-emoji"
											aria-hidden="true"
										>
											{item.emoji || '>'}
										</span>
									</span>
									<span className="terminal-switcher-item-title">
										{item.title}
									</span>
								</button>
							))}
						</div>
					</div>
				</div>
			) : null}

			{fileExplorerNameDialog ? (
				<FileExplorerNameModal
					dialog={fileExplorerNameDialog}
					modal={fileExplorerNameModal}
					onCancel={cancelFileExplorerNameDialog}
					onSubmit={submitFileExplorerNameDialog}
				/>
			) : null}

			{macroToRun ? (
				<ModalBackdrop onClose={closeMacroParameterModal}>
					<form
						className="project-edit-modal project-edit-modal--wide macro-parameter-modal"
						ref={(element) => {
							macroParameterModal.modalRef.current = element;
						}}
						style={macroParameterModal.modalStyle}
						onSubmit={(event) => {
							event.preventDefault();
							if (!validateMacroValues(macroToRun, macroFieldValues)) {
								return;
							}
							executeMacro(macroToRun, macroFieldValues);
						}}
						onClick={(event) => event.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-labelledby="macro-parameter-modal-title"
					>
						<ModalTitlebar
							title={macroToRun.title}
							titleId="macro-parameter-modal-title"
							onClose={closeMacroParameterModal}
							onMouseDown={macroParameterModal.handleTitlebarPointerDown}
						/>
						<p className="macro-parameter-description">
							{macroToRun.description ||
								'Fill in the parameters to render the final macro output.'}
						</p>

						{macroToRun.fields.map((field, index) => {
							const value = macroFieldValues[field.name];
							const firstFieldRef =
								index === 0
									? (
											element:
												| HTMLInputElement
												| HTMLTextAreaElement
												| HTMLSelectElement
												| null,
										) => {
											firstMacroFieldRef.current = element;
										}
									: undefined;
							return (
								<div key={field.id} className="macro-parameter-field">
									<span>{field.label}</span>
									{field.type === 'textarea' ? (
										<textarea
											ref={firstFieldRef}
											className="project-edit-textarea"
											value={String(value ?? '')}
											placeholder={field.placeholder}
											onChange={(event) =>
												setMacroFieldValues((current) => ({
													...current,
													[field.name]: event.target.value,
												}))
											}
											rows={4}
										/>
									) : field.type === 'select' ? (
										<select
											ref={firstFieldRef}
											className="project-edit-select"
											value={String(value ?? '')}
											onChange={(event) =>
												setMacroFieldValues((current) => ({
													...current,
													[field.name]: event.target.value,
												}))
											}
										>
											{field.options.map((option) => (
												<option
													key={`${field.id}-${option.value}`}
													value={option.value}
												>
													{option.label}
												</option>
												))}
										</select>
									) : field.type === 'file' ? (
										<MacroFileFieldInput
											ref={firstFieldRef}
											rootPath={macroFileSearchRootPath || project.rootFolder}
											value={String(value ?? '')}
											placeholder={field.placeholder}
											onChange={(nextValue) =>
												setMacroFieldValues((current) => ({
													...current,
													[field.name]: nextValue,
												}))
											}
										/>
									) : field.type === 'checkbox' ? (
										<input
											ref={firstFieldRef}
											type="checkbox"
											checked={Boolean(value)}
											onChange={(event) =>
												setMacroFieldValues((current) => ({
													...current,
													[field.name]: event.target.checked,
												}))
											}
										/>
									) : (
										<input
											ref={firstFieldRef}
											type={field.type === 'number' ? 'number' : 'text'}
											value={String(value ?? '')}
											placeholder={field.placeholder}
											onChange={(event) =>
												setMacroFieldValues((current) => ({
													...current,
													[field.name]:
														field.type === 'number'
															? Number(event.target.value || 0)
															: event.target.value,
												}))
											}
										/>
									)}
								</div>
							);
						})}

						<div className="project-edit-preview project-edit-preview--multiline">
							<pre>
								{renderMacroTemplate(macroToRun.template, macroFieldValues)}
							</pre>
						</div>

						<div className="project-edit-actions">
							<button type="button" onClick={closeMacroParameterModal}>
								Cancel
							</button>
							<button type="submit">Type Macro</button>
						</div>
					</form>
				</ModalBackdrop>
			) : null}

		</section>
	);
});

ProjectWorkspace.displayName = 'ProjectWorkspace';

function App() {
	const isMac = useMemo(() => navigator.userAgent.includes('Mac'), []);
	const popoutUrl = useMemo(
		() => new URL('popout.html', window.location.href).toString(),
		[],
	);
	const { macros } = useMacroSettings();
	const projectCounterRef = useRef(1);
	const workspaceRefs = useRef(
		new Map<string, ProjectWorkspaceHandle | null>(),
	);
	const [homePath, setHomePath] = useState('');

	const [projects, setProjects] = useState<ProjectTab[]>([
		createProjectTab(1, ''),
	]);
	const projectsRef = useRef(projects);
	const [activeProjectId, setActiveProjectId] = useState('project-1');
	const activeProjectIdRef = useRef(activeProjectId);
	const [draggingProjectId, setDraggingProjectId] = useState<string | null>(
		null,
	);
	const [remoteStatus, setRemoteStatus] = useState<RemoteAccessStatus | null>(
		null,
	);
	const [isTogglingRemoteAccess, setIsTogglingRemoteAccess] = useState(false);
	const [isPairingModalOpen, setIsPairingModalOpen] = useState(false);
	const [selectedRemotePairingMode, setSelectedRemotePairingMode] = useState<
		'lan' | 'webrtc'
	>('lan');
	const [isLinkCopied, setIsLinkCopied] = useState(false);
	const pairingModal = useDraggableModal(isPairingModalOpen);
	const remoteMenuRef = useRef<HTMLDivElement | null>(null);
	const [isRemoteMenuOpen, setIsRemoteMenuOpen] = useState(false);
	const [appUpdateStatus, setAppUpdateStatus] = useState<AppUpdateStatus | null>(
		null,
	);
	const activityMenuRef = useRef<HTMLDivElement | null>(null);
	const [isActivityMenuOpen, setIsActivityMenuOpen] = useState(false);
	const [terminalActivityItemsByProject, setTerminalActivityItemsByProject] =
		useState<Record<string, TerminalActivityOverviewItem[]>>({});

	useEffect(() => {
		projectsRef.current = projects;
	}, [projects]);

	useEffect(() => {
		activeProjectIdRef.current = activeProjectId;
	}, [activeProjectId]);

	useEffect(() => {
		let isMounted = true;

		void window.terminay.getHomePath().then((resolvedHomePath) => {
			if (!isMounted) {
				return;
			}

			setHomePath(resolvedHomePath);
			setProjects((current) =>
				current.map((project) =>
					project.rootFolder.trim().length > 0
						? project
						: {
								...project,
								rootFolder: resolvedHomePath,
							},
				),
			);
		});

		return () => {
			isMounted = false;
		};
	}, []);

	const addProject = useCallback(() => {
		projectCounterRef.current += 1;
		const nextProjectId = `project-${projectCounterRef.current}`;

		setProjects((current) => [
			...current,
			createProjectTab(
				projectCounterRef.current,
				homePath,
				current.map((project) => project.color),
			),
		]);
		setActiveProjectId(nextProjectId);
	}, [homePath]);

	const closeProject = useCallback(
		(projectId: string) => {
			const currentProjects = projectsRef.current;
			const index = currentProjects.findIndex(
				(project) => project.id === projectId,
			);
			if (index === -1) {
				return;
			}

			const isLastProject =
				currentProjects.length === 1 && currentProjects[0]?.id === projectId;
			if (isLastProject) {
				void window.terminay.quitApp();
				return;
			}

			const nextProjects = currentProjects.filter(
				(project) => project.id !== projectId,
			);
			projectsRef.current = nextProjects;
			setProjects(nextProjects);

			if (activeProjectIdRef.current === projectId) {
				const fallbackIndex = Math.max(0, index - 1);
				const nextActiveProjectId =
					nextProjects[fallbackIndex]?.id ?? nextProjects[0].id;
				activeProjectIdRef.current = nextActiveProjectId;
				setActiveProjectId(nextActiveProjectId);
			}
		},
		[],
	);

	const onReorder = (newOrder: ProjectTab[]) => {
		setProjects(newOrder);
	};

	const openEditProjectWindow = useCallback(async (projectId: string) => {
		const project = projects.find((candidate) => candidate.id === projectId);
		if (!project) {
			return;
		}

		try {
			const result = await window.terminay.openProjectEditWindow({
				color: project.color,
				emoji: project.emoji,
				rootFolder: project.rootFolder,
				title: project.title,
			});
			if (!result) {
				return;
			}

			const nextTitle =
				result.title.trim().length > 0 ? result.title.trim() : 'Untitled Project';
			const nextEmoji = result.emoji.trim();
			const nextRootFolder = normalizeRootFolderInput(result.rootFolder, homePath);

			setProjects((current) =>
				current.map((candidate) =>
					candidate.id === projectId
						? {
								...candidate,
								title: nextTitle,
								emoji: nextEmoji,
								color: result.color,
								rootFolder: nextRootFolder,
							}
						: candidate,
				),
			);
		} finally {
			window.requestAnimationFrame(() => {
				workspaceRefs.current.get(projectId)?.focusActiveTerminal();
			});
		}
	}, [homePath, projects]);

	const updateProject = useCallback(
		(projectId: string, updates: Partial<ProjectTab>) => {
			setProjects((current) =>
				current.map((project) =>
					project.id === projectId ? { ...project, ...updates } : project,
				),
			);
		},
		[],
	);

	const moveTerminalToProject = useCallback(
		(sourceProjectId: string, panelId: string, targetProjectId: string) => {
			if (sourceProjectId === targetProjectId) {
				return;
			}

			const sourceWorkspace = workspaceRefs.current.get(sourceProjectId);
			const targetWorkspace = workspaceRefs.current.get(targetProjectId);
			if (!sourceWorkspace || !targetWorkspace) {
				return;
			}

			const movedTerminal = sourceWorkspace.exportTerminalForMove(panelId);
			if (!movedTerminal) {
				return;
			}

			setActiveProjectId(targetProjectId);
			window.requestAnimationFrame(() => {
				targetWorkspace.acceptMovedTerminal(movedTerminal);
			});
		},
		[],
	);

	const toggleActiveProjectExplorer = useCallback(() => {
		setProjects((current) =>
			current.map((project) =>
				project.id === activeProjectId
					? {
							...project,
							isFileExplorerOpen: !project.isFileExplorerOpen,
						}
					: project,
			),
		);
	}, [activeProjectId]);

	const executeCommandOnActiveProject = useCallback(
		(command: AppCommand) => {
			workspaceRefs.current.get(activeProjectId)?.executeCommand(command);
		},
		[activeProjectId],
	);

	const updateTerminalActivityOverview = useCallback(
		(projectId: string, items: TerminalActivityOverviewItem[]) => {
			setTerminalActivityItemsByProject((current) => {
				if (items.length === 0) {
					if (!(projectId in current)) {
						return current;
					}

					const { [projectId]: _removed, ...next } = current;
					void _removed;
					return next;
				}

				return {
					...current,
					[projectId]: items,
				};
			});
		},
		[],
	);

	const terminalActivityItems = useMemo(() => {
		const items = projects.flatMap(
			(project) => terminalActivityItemsByProject[project.id] ?? [],
		);

		return items.sort((a, b) => {
			if (a.state !== b.state) {
				return a.state === 'recent' ? -1 : 1;
			}

			const projectComparison = a.projectTitle.localeCompare(b.projectTitle);
			if (projectComparison !== 0) {
				return projectComparison;
			}

			return a.title.localeCompare(b.title);
		});
	}, [projects, terminalActivityItemsByProject]);

	const unviewedTerminalActivityCount = terminalActivityItems.filter(
		(item) => item.state === 'unviewed',
	).length;
	const recentTerminalActivityCount = terminalActivityItems.filter(
		(item) => item.state === 'recent',
	).length;
	const hasTerminalActivityOverview = terminalActivityItems.length > 0;

	const activateTerminalFromOverview = useCallback(
		(item: TerminalActivityOverviewItem) => {
			setIsActivityMenuOpen(false);
			setActiveProjectId(item.projectId);
			window.requestAnimationFrame(() => {
				workspaceRefs.current
					.get(item.projectId)
					?.activateTerminal(item.panelId, item.sessionId);
			});
		},
		[],
	);

	useEffect(() => {
		const unsubscribeCommand = window.terminay.onAppCommand(
			executeCommandOnActiveProject,
		);

		return () => {
			unsubscribeCommand();
		};
	}, [executeCommandOnActiveProject]);

	useEffect(() => {
		let isMounted = true;

		void window.terminay.getRemoteAccessStatus().then((status) => {
			if (isMounted) {
				setRemoteStatus(status);
			}
		});

		const unsubscribe = window.terminay.onRemoteAccessStatusChanged((status) => {
			setRemoteStatus(status);
		});

		return () => {
			isMounted = false;
			unsubscribe();
		};
	}, []);

	useEffect(() => {
		if (remoteStatus?.pairingMode) {
			setSelectedRemotePairingMode(remoteStatus.pairingMode);
		}
	}, [remoteStatus?.pairingMode]);

	useEffect(() => {
		let isMounted = true;

		const refreshUpdateStatus = async (force = false) => {
			const status = await window.terminay.getAppUpdateStatus({ force });
			if (isMounted) {
				setAppUpdateStatus(status);
			}
		};

		void refreshUpdateStatus(true);
		const intervalId = window.setInterval(() => {
			void refreshUpdateStatus(true);
		}, 60 * 60 * 1000);

		return () => {
			isMounted = false;
			window.clearInterval(intervalId);
		};
	}, []);

	const toggleRemoteAccess = useCallback(async () => {
		setIsTogglingRemoteAccess(true);
		try {
			if (remoteStatus?.configurationIssue) {
				await window.terminay.openSettingsWindow({
					sectionId: 'remote-access-host',
				});
				return;
			}

			const nextStatus = await window.terminay.toggleRemoteAccessServer();
			setRemoteStatus(nextStatus);
		} finally {
			setIsTogglingRemoteAccess(false);
		}
	}, [remoteStatus?.configurationIssue]);

	const openPairingQr = useCallback(async (mode: 'lan' | 'webrtc' = selectedRemotePairingMode) => {
		if (remoteStatus?.configurationIssue) {
			await window.terminay.openSettingsWindow({
				sectionId: 'remote-access-host',
			});
			return;
		}

		setSelectedRemotePairingMode(mode);
		let nextStatus = remoteStatus;

		if (!nextStatus?.isRunning) {
			setIsTogglingRemoteAccess(true);
			try {
				nextStatus = await window.terminay.toggleRemoteAccessServer();
				setRemoteStatus(nextStatus);
			} finally {
				setIsTogglingRemoteAccess(false);
			}
		}

		const hasPairingQr =
			mode === 'webrtc'
				? nextStatus?.webRtcPairingQrCodeDataUrl
				: nextStatus?.lanPairingQrCodeDataUrl ?? nextStatus?.pairingQrCodeDataUrl;
		if (hasPairingQr) {
			setIsPairingModalOpen(true);
		}
	}, [remoteStatus, selectedRemotePairingMode]);

	const remoteButtonTone = remoteStatus?.isRunning
		? 'remote-access-button--active'
		: remoteStatus?.configurationIssue || remoteStatus?.errorMessage
			? 'remote-access-button--warning'
			: '';

	const remoteAddresses = remoteStatus?.availableAddresses ?? [];
	const selectedPairingUrl =
		selectedRemotePairingMode === 'webrtc'
			? remoteStatus?.webRtcPairingUrl
			: remoteStatus?.lanPairingUrl ?? remoteStatus?.pairingUrl;
	const selectedPairingQrCodeDataUrl =
		selectedRemotePairingMode === 'webrtc'
			? remoteStatus?.webRtcPairingQrCodeDataUrl
			: remoteStatus?.lanPairingQrCodeDataUrl ?? remoteStatus?.pairingQrCodeDataUrl;
	const selectedPairingExpiresAt =
		selectedRemotePairingMode === 'webrtc'
			? remoteStatus?.webRtcPairingExpiresAt
			: remoteStatus?.lanPairingExpiresAt ?? remoteStatus?.pairingExpiresAt;
	const preferredRemoteAddress = useMemo(() => {
		if (selectedRemotePairingMode === 'webrtc') {
			return remoteStatus?.webRtcPairingUrl ?? null;
		}
		if (!selectedPairingUrl) return remoteAddresses[0] || null;
		try {
			const url = new URL(selectedPairingUrl);
			const origin = url.origin + url.pathname.replace(/\/$/, '');
			return (
				remoteAddresses.find((addr) => addr.startsWith(origin)) ||
				remoteAddresses[0] ||
				null
			);
		} catch {
			return remoteAddresses[0] || null;
		}
	}, [
		remoteStatus?.webRtcPairingUrl,
		remoteAddresses,
		selectedPairingUrl,
		selectedRemotePairingMode,
	]);

	const selectPairingAddress = useCallback(async (address: string) => {
		const nextStatus =
			await window.terminay.setRemoteAccessPairingAddress(address);
		setRemoteStatus(nextStatus);
	}, []);

	useEffect(() => {
		if (!isRemoteMenuOpen) {
			return;
		}

		const onPointerDown = (event: globalThis.MouseEvent) => {
			const container = remoteMenuRef.current;
			if (!container) {
				return;
			}

			const target = event.target as Node;
			if (container.contains(target)) {
				return;
			}

			setIsRemoteMenuOpen(false);
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setIsRemoteMenuOpen(false);
			}
		};

		window.addEventListener('mousedown', onPointerDown);
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('mousedown', onPointerDown);
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [isRemoteMenuOpen]);

	useEffect(() => {
		if (!hasTerminalActivityOverview) {
			setIsActivityMenuOpen(false);
		}
	}, [hasTerminalActivityOverview]);

	useEffect(() => {
		if (!isActivityMenuOpen) {
			return;
		}

		const onPointerDown = (event: globalThis.MouseEvent) => {
			const container = activityMenuRef.current;
			if (!container) {
				return;
			}

			const target = event.target as Node;
			if (container.contains(target)) {
				return;
			}

			setIsActivityMenuOpen(false);
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setIsActivityMenuOpen(false);
			}
		};

		window.addEventListener('mousedown', onPointerDown);
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('mousedown', onPointerDown);
			window.removeEventListener('keydown', onKeyDown);
		};
	}, [isActivityMenuOpen]);

	const activeProject =
		projects.find((project) => project.id === activeProjectId) ?? null;
	const hasAppUpdate =
		appUpdateStatus?.hasUpdate === true &&
		typeof appUpdateStatus.releaseUrl === 'string';
	const updateLabel = appUpdateStatus?.latestVersion
		? `Update Now (${appUpdateStatus.latestVersion})`
		: 'Update Now';

	return (
		<div className={`app-shell${isMac ? ' app-shell--macos' : ''}`}>
			<header className="project-tabbar">
				<div className="project-tab-sidebar-toggle-box">
					<button
						type="button"
						className={`project-tab-sidebar-toggle${activeProject?.isFileExplorerOpen ? ' project-tab-sidebar-toggle--active' : ''}`}
						onClick={toggleActiveProjectExplorer}
						disabled={
							!activeProject || activeProject.rootFolder.trim().length === 0
						}
						aria-label="Toggle file explorer"
						title="Toggle file explorer"
					>
						<svg
							aria-hidden="true"
							width="14"
							height="14"
							viewBox="0 0 14 14"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M2.25 2.25H11.75V11.75H2.25V2.25Z"
								stroke="currentColor"
								strokeWidth="1.4"
							/>
							<path d="M5 2.25V11.75" stroke="currentColor" strokeWidth="1.4" />
						</svg>
					</button>
				</div>
				<Reorder.Group
					axis="x"
					values={projects}
					onReorder={onReorder}
					className="project-tabbar-list"
				>
					<AnimatePresence initial={false}>
						{projects.map((project) => (
							<Reorder.Item
								key={project.id}
								value={project}
								initial={{ opacity: 0, scale: 0.95 }}
								animate={{ opacity: 1, scale: 1 }}
								exit={{ opacity: 0, scale: 0.95 }}
								className={`project-tab${project.id === activeProjectId ? ' project-tab--active' : ''}${project.id === draggingProjectId ? ' project-tab--dragging' : ''}`}
								style={
									{ '--project-color': project.color } as CSSProperties
								}
								onDragStart={() => setDraggingProjectId(project.id)}
								onDragEnd={() => setDraggingProjectId(null)}
								onClick={() => setActiveProjectId(project.id)}
								onDoubleClick={() => void openEditProjectWindow(project.id)}
								whileDrag={{ scale: 1.05, zIndex: 50 }}
								title="Double-click to edit tab"
							>
								<span className="project-tab-main">
									{project.emoji ? (
										<span className="project-tab-emoji" aria-hidden="true">
											{project.emoji}
										</span>
									) : null}
									<span className="project-tab-title">{project.title}</span>
								</span>
								<button
									type="button"
									className="project-tab-close"
									onClick={(event) => {
										event.stopPropagation();
										closeProject(project.id);
									}}
									aria-label={`Close ${project.title}`}
									title={
										projects.length <= 1
											? 'Close tab and exit app'
											: 'Close tab'
									}
								>
									<svg
										aria-hidden="true"
										width="12"
										height="12"
										viewBox="0 0 12 12"
										fill="none"
										xmlns="http://www.w3.org/2000/svg"
									>
										<path
											d="M9 3L3 9M3 3L9 9"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								</button>
							</Reorder.Item>
						))}
					</AnimatePresence>
				</Reorder.Group>
				<div className="project-tab-add-box">
					<button
						type="button"
						className="project-tab-add"
						onClick={addProject}
						aria-label="Add project tab"
						title="Add project tab"
					>
						<svg
							aria-hidden="true"
							width="14"
							height="14"
							viewBox="0 0 12 12"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M6 2V10M2 6H10"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</button>
				</div>
				<div className="header-actions">
					{hasAppUpdate ? (
						<div className="app-update-status">
							<button
								type="button"
								className="app-update-button"
								onClick={() =>
									void window.terminay.openExternal(
										appUpdateStatus.releaseUrl as string,
									)
								}
								title={`Open release page for v${appUpdateStatus?.latestVersion}`}
							>
								<span className="app-update-button__dot" aria-hidden="true" />
								<span className="app-update-button__label">{updateLabel}</span>
							</button>
						</div>
					) : null}
					{hasTerminalActivityOverview ? (
						<div
							ref={activityMenuRef}
							className={`terminal-activity-status${isActivityMenuOpen ? ' terminal-activity-status--open' : ''}`}
						>
							<button
								type="button"
								className="terminal-activity-button"
								onClick={() => {
									setIsRemoteMenuOpen(false);
									setIsActivityMenuOpen((current) => !current);
								}}
								title="Open terminal activity menu"
								aria-label="Open terminal activity menu"
								aria-haspopup="menu"
								aria-expanded={isActivityMenuOpen}
							>
								{unviewedTerminalActivityCount > 0 ? (
									<span className="terminal-activity-pill terminal-activity-pill--unviewed">
										{unviewedTerminalActivityCount}
									</span>
								) : null}
								{recentTerminalActivityCount > 0 ? (
									<span className="terminal-activity-pill terminal-activity-pill--recent">
										{recentTerminalActivityCount}
									</span>
								) : null}
								<ChevronDown
									className="terminal-activity-button__chevron"
									size={12}
									aria-hidden="true"
								/>
							</button>
							{isActivityMenuOpen ? (
								<div
									className="terminal-activity-menu"
									role="menu"
									aria-label="Terminal activity menu"
								>
									<div className="terminal-activity-menu__section-label">
										Terminal Activity
									</div>
									{terminalActivityItems.map((item) => (
										<button
											key={`${item.projectId}:${item.panelId}:${item.sessionId}`}
											type="button"
											className="terminal-activity-menu__item"
											onClick={() => activateTerminalFromOverview(item)}
										>
											<span
												className={`terminal-activity-menu__state terminal-activity-menu__state--${item.state}`}
												aria-hidden="true"
											/>
											<span
												className="terminal-activity-menu__preview"
												style={{ '--tab-color': item.color } as CSSProperties}
											>
												<span className="terminal-activity-menu__dot" />
												<span
													className="terminal-activity-menu__emoji"
													aria-hidden="true"
												>
													{item.emoji || item.projectEmoji || '>'}
												</span>
											</span>
											<span className="terminal-activity-menu__text">
												<span className="terminal-activity-menu__title">
													{item.title}
												</span>
												<span className="terminal-activity-menu__project">
													{item.projectEmoji ? `${item.projectEmoji} ` : ''}
													{item.projectTitle}
												</span>
											</span>
										</button>
									))}
								</div>
							) : null}
						</div>
					) : null}
					<div
						ref={remoteMenuRef}
						className={`remote-access-status${remoteStatus?.isRunning ? ' remote-access-status--active' : ''}${isRemoteMenuOpen ? ' remote-access-status--open' : ''}`}
					>
						<button
							type="button"
							className={`remote-access-button ${remoteButtonTone}`.trim()}
							onClick={() => {
								setIsActivityMenuOpen(false);
								setIsRemoteMenuOpen((current) => !current);
							}}
							title="Open remote access menu"
							aria-label="Open remote access menu"
							aria-haspopup="menu"
							aria-expanded={isRemoteMenuOpen}
						>
							<span className="remote-access-button__label">Remote</span>
							{remoteStatus?.isRunning ? (
								<span
									className="remote-access-button__badge remote-access-button__badge--live"
									aria-hidden="true"
								/>
							) : null}
							{remoteStatus?.configurationIssue || remoteStatus?.errorMessage ? (
								<span
									className="remote-access-button__badge remote-access-button__badge--warning"
									aria-hidden="true"
								>
									!
								</span>
							) : null}
							<ChevronDown
								className="remote-access-button__chevron"
								size={12}
								aria-hidden="true"
							/>
						</button>
						{isRemoteMenuOpen ? (
							<div
								className="remote-access-menu"
								role="menu"
								aria-label="Remote access menu"
							>
							<button
								type="button"
								className="remote-access-menu__item"
								onClick={() => void toggleRemoteAccess()}
								disabled={isTogglingRemoteAccess}
							>
								<span>
									{isTogglingRemoteAccess
										? 'Working...'
										: remoteStatus?.isRunning
											? 'Stop Server'
											: 'Start Server'}
								</span>
								<span className="remote-access-menu__meta">
									{remoteStatus?.isRunning ? 'Live' : 'Offline'}
								</span>
							</button>
							<button
								type="button"
								className="remote-access-menu__item"
								onClick={() =>
									void window.terminay.openSettingsWindow({
										sectionId: 'remote-access-host',
									})
								}
							>
								<span>Remote Access Settings</span>
								<span className="remote-access-menu__meta">Open</span>
							</button>
							<button
								type="button"
								className="remote-access-menu__item"
								onClick={() => void openPairingQr()}
								disabled={isTogglingRemoteAccess}
							>
								<span>
									{remoteStatus?.isRunning
										? 'Show Pairing QR'
										: 'Start Server & Show QR'}
								</span>
								<span className="remote-access-menu__meta">
									{remoteStatus?.isRunning ? 'Scan' : 'Start'}
								</span>
							</button>
							<div className="remote-access-menu__section">
								<div className="remote-access-menu__section-label">
									QR Type
								</div>
								{(['lan', 'webrtc'] as const).map((mode) => (
									<button
										key={mode}
										type="button"
										className={`remote-access-menu__address-btn${selectedRemotePairingMode === mode ? ' remote-access-menu__address-btn--active' : ''}`}
										onClick={() => setSelectedRemotePairingMode(mode)}
									>
										<span className="remote-access-menu__address-text">
											{mode === 'lan' ? 'Local Network' : 'WebRTC Relay'}
										</span>
										{selectedRemotePairingMode === mode && (
											<span
												className="remote-access-menu__address-check"
												aria-hidden="true"
											>
												✓
											</span>
										)}
									</button>
								))}
							</div>
							<div className="remote-access-menu__section">
								<div className="remote-access-menu__section-label">
									Connect To
								</div>
								{selectedRemotePairingMode === 'webrtc' ? (
									<div className="remote-access-menu__empty">
										{remoteStatus?.webRtcPairingUrl ??
											'Start remote access to generate a relay pairing link.'}
									</div>
								) : remoteStatus?.availableAddresses.length ? (
									remoteStatus.availableAddresses.map((address) => (
										<button
											key={address}
											type="button"
											className={`remote-access-menu__address-btn${address === preferredRemoteAddress ? ' remote-access-menu__address-btn--active' : ''}`}
											onClick={() => void selectPairingAddress(address)}
											title={
												address === preferredRemoteAddress
													? `Active: ${address}`
													: `Switch to: ${address}`
											}
										>
											<span className="remote-access-menu__address-text">
												{address}
											</span>
											{address === preferredRemoteAddress && (
												<span
													className="remote-access-menu__address-check"
													aria-hidden="true"
												>
													✓
												</span>
											)}
										</button>
									))
								) : (
									<div className="remote-access-menu__empty">
										No local addresses available yet.
									</div>
								)}
							</div>
							<div className="remote-access-menu__section">
								<div className="remote-access-menu__section-label">
									Active Connections
								</div>
								{remoteStatus?.connections.length ? (
									remoteStatus.connections.map((connection) => (
										<div
											key={connection.connectionId}
											className="remote-access-menu__connection"
										>
											<div className="remote-access-menu__connection-main">
												<span className="remote-access-menu__connection-device">
													{connection.deviceName}
												</span>
												<span className="remote-access-menu__connection-meta">
													{connection.attachedSessionCount}{' '}
													{connection.attachedSessionCount === 1
														? 'session'
														: 'sessions'}
												</span>
											</div>
											<div className="remote-access-menu__connection-id">
												{connection.connectionId}
											</div>
										</div>
									))
								) : (
									<div className="remote-access-menu__empty">
										No active browser connections.
									</div>
								)}
							</div>
							{remoteStatus?.errorMessage ? (
								<div className="remote-access-menu__section">
									<div className="remote-access-menu__section-label">
										Status
									</div>
									<div className="remote-access-menu__empty">
										{remoteStatus.errorMessage}
									</div>
								</div>
							) : null}
							</div>
						) : null}
					</div>
				</div>
			</header>

			<div className="workspace-stack">
				{projects.map((project) => (
					<ProjectWorkspace
						key={project.id}
						ref={(instance) => {
							workspaceRefs.current.set(project.id, instance);
						}}
						isActive={project.id === activeProjectId}
						isMac={isMac}
						macros={macros}
						onAddProject={addProject}
						onCloseProject={closeProject}
						onEditProject={openEditProjectWindow}
						onMoveTerminalToProject={moveTerminalToProject}
						onTerminalActivityOverviewChange={updateTerminalActivityOverview}
						onUpdateProject={updateProject}
						popoutUrl={popoutUrl}
						project={project}
						projects={projects}
					/>
				))}
			</div>

			{isPairingModalOpen ? (
				<ModalBackdrop onClose={() => setIsPairingModalOpen(false)}>
					<div
						className="project-edit-modal project-edit-modal--wide remote-pairing-modal"
						ref={(element) => {
							pairingModal.modalRef.current = element;
						}}
						style={pairingModal.modalStyle}
						onClick={(event) => event.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-labelledby="pair-device-modal-title"
					>
						<ModalTitlebar
							title="Pair Device"
							titleId="pair-device-modal-title"
							onClose={() => setIsPairingModalOpen(false)}
							onMouseDown={pairingModal.handleTitlebarPointerDown}
						/>
						<p className="remote-pairing-modal__copy">
							Scan this QR code from your phone to pair it with this Terminay
							host.
						</p>
						<div className="remote-pairing-modal__additional-list">
							{(['lan', 'webrtc'] as const).map((mode) => (
								<button
									key={mode}
									type="button"
									className={`remote-pairing-modal__address-row-btn${selectedRemotePairingMode === mode ? ' remote-pairing-modal__address-row-btn--active' : ''}`}
									onClick={() => setSelectedRemotePairingMode(mode)}
								>
									<span className="remote-pairing-modal__address-label">
										{mode === 'lan' ? 'Local Network QR' : 'WebRTC Relay QR'}
									</span>
									{selectedRemotePairingMode === mode && (
										<span className="remote-pairing-modal__address-active-badge">
											Selected
										</span>
									)}
								</button>
							))}
						</div>
						{selectedPairingQrCodeDataUrl ? (
							<div className="remote-pairing-modal__content">
								<div className="remote-pairing-modal__qr-section">
									<div className="remote-pairing-modal__qr-card">
										<img
											className="remote-pairing-modal__qr"
											src={selectedPairingQrCodeDataUrl}
											alt="Remote pairing QR code"
										/>
									</div>

									<div className="remote-pairing-modal__primary-link">
										<h3>
											{selectedRemotePairingMode === 'webrtc'
												? 'Open this relay link in your browser'
												: 'Open this address in your browser'}
										</h3>
										<div className="remote-pairing-modal__address-box">
											<div className="remote-pairing-modal__address-text">
												{preferredRemoteAddress || 'No address available yet.'}
											</div>
											{selectedPairingUrl && (
												<button
													type="button"
													className="remote-pairing-modal__copy-btn"
													onClick={() => {
														void navigator.clipboard.writeText(
															selectedPairingUrl,
														);
														setIsLinkCopied(true);
														setTimeout(() => setIsLinkCopied(false), 2000);
													}}
												>
													{isLinkCopied ? 'Copied!' : 'Copy Link'}
												</button>
											)}
										</div>
									</div>
								</div>

								<div className="remote-pairing-modal__footer-details">
									{selectedRemotePairingMode === 'lan' ? (
										<div className="remote-pairing-modal__additional-section">
										<h3>Available Addresses</h3>
										<div className="remote-pairing-modal__additional-list">
											{remoteAddresses.map((address) => (
												<button
													key={address}
													type="button"
													className={`remote-pairing-modal__address-row-btn${address === preferredRemoteAddress ? ' remote-pairing-modal__address-row-btn--active' : ''}`}
													onClick={() => void selectPairingAddress(address)}
													title={`Generate QR for ${address}`}
												>
													<span className="remote-pairing-modal__address-label">
														{address}
													</span>
													{address === preferredRemoteAddress && (
														<span className="remote-pairing-modal__address-active-badge">
															QR Active
														</span>
													)}
												</button>
											))}
										</div>
										</div>
									) : null}

									<div className="remote-pairing-modal__status-info">
										<div className="remote-pairing-modal__tip">
											{selectedRemotePairingMode === 'webrtc'
												? remoteStatus?.webRtcStatusMessage ??
													'WebRTC relay pairing is scaffolded for the host.'
												: 'Best for mobile: Scan the QR code. Use the link for manual entry on desktop.'}
										</div>
										<p className="remote-pairing-modal__expires-text">
											Expires{' '}
											{selectedPairingExpiresAt
												? new Date(
														selectedPairingExpiresAt,
													).toLocaleString()
												: 'soon'}
											.
										</p>
									</div>
								</div>
							</div>
						) : (
							<p className="remote-pairing-modal__copy">
								Start the remote server first to generate a pairing QR code.
							</p>
						)}
						<div className="project-edit-actions">
							<button
								type="button"
								className="project-edit-cancel"
								onClick={() => setIsPairingModalOpen(false)}
							>
								Close
							</button>
						</div>
					</div>
				</ModalBackdrop>
			) : null}

		</div>
	);
}

export default App;
