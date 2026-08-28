import type {
	FileObservationClient,
	FileViewerClient,
	GitWorktreeReference,
	TerminayGitClient,
} from '@terminay/client-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { writeClipboardText } from '../host/nativeActions';
import {
	getPathRelativeToRoot,
	toContainedProjectRelativePath,
} from '../pathUtils';
import { loadServerGitWorkspace } from '../services/git/serverGitWorkspaceAdapter';
import type { FileViewerMode } from '../types/fileViewer';
import type {
	FileExplorerEntry,
	FileExplorerGitStatus,
	GitChangeEntry,
	GitWorktreeStatus,
	WorktreePanelStatus,
} from '../types/terminay';
import type { ProjectTab } from './projectTabModel';
import { getOrCreateDirectoryLoad } from './directoryLoadCoordinator';
import {
	gitFilesystemActionWorktreeRoot,
	sameFilesystemPath,
} from './gitFilesystemScope';

const WATCH_REFRESH_DELAY_MS = 120;
const EMPTY_WORKTREE_PANEL_STATUS: WorktreePanelStatus = Object.freeze({
	gitAvailable: true,
	repoRoot: null,
	defaultBranch: null,
	worktrees: [],
});
const GIT_UNAVAILABLE_WORKTREE_PANEL_STATUS: WorktreePanelStatus = Object.freeze({
	gitAvailable: false,
	repoRoot: null,
	defaultBranch: null,
	worktrees: [],
});

export type FileExplorerNameDialogOptions = {
	initialValue?: string;
	label: string;
	submitLabel: string;
	title: string;
};

export type FileExplorerNameDialogState = FileExplorerNameDialogOptions & {
	id: number;
	resolve: (value: string | null) => void;
};

type OpenFile = (
	path: string,
	options?: { initialMode?: FileViewerMode },
) => void | Promise<void>;

type Options = {
	fileObservationClient?: FileObservationClient;
	fileViewerClient: FileViewerClient;
	gitClient?: TerminayGitClient;
	isServerFileViewer: boolean;
	onOpenFile: OpenFile;
	onOpenTerminalAt: (path: string, isDirectory?: boolean) => unknown;
	onOperationError: (feature: 'Explorer' | 'Git', error: unknown) => string;
	onOperationSucceeded: (feature: 'Explorer' | 'Git') => void;
	onSetError: (message: string | null) => void;
	onUpdateProject: (projectId: string, updates: Partial<ProjectTab>) => void;
	project: ProjectTab;
};

function joinPath(dirPath: string, name: string): string {
	return dirPath.endsWith('/') || dirPath.endsWith('\\')
		? `${dirPath}${name}`
		: `${dirPath}/${name}`;
}

function parentPath(path: string): string {
	const trimmed = path.replace(/[\\/]+$/, '');
	const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	if (slash <= 0) return slash === 0 ? trimmed.slice(0, 1) : '';
	return trimmed.slice(0, slash);
}

function explorerMayLoad(project: ProjectTab): boolean {
	if (project.creationStatus === 'loading') return false;
	const remote =
		project.projectEnvironmentId !== undefined &&
		project.projectEnvironmentId !== 'terminay:this-server';
	if (!remote) return true;
	return project.hydrating === false;
}

export function openTerminalAtWorktree(
	worktree: GitWorktreeStatus,
	onOpenTerminalAt: (path: string, isDirectory?: boolean) => unknown,
): void {
	void onOpenTerminalAt(worktree.path, true);
}

type PendingGitFilesystemAction =
	| {
			readonly kind: 'open-entry';
			readonly entry: GitChangeEntry;
			readonly worktreeRoot: string;
	  }
	| {
			readonly kind: 'delete';
			readonly path: string;
			readonly worktreeRoot: string;
	  }
	| {
			readonly kind: 'rename';
			readonly oldPath: string;
			readonly nextPath: string;
			readonly parentPath: string;
			readonly worktreeRoot: string;
	  }
	| {
			readonly kind: 'create-file';
			readonly path: string;
			readonly dirPath: string;
			readonly worktreeRoot: string;
	  }
	| {
			readonly kind: 'create-folder';
			readonly path: string;
			readonly dirPath: string;
			readonly worktreeRoot: string;
	  };

export function assertWorktreeRemoved(result: unknown): void {
	if (
		typeof result === 'object' &&
		result !== null &&
		'applied' in result &&
		result.applied === true &&
		'state' in result &&
		result.state === 'removed'
	) {
		return;
	}

	const error =
		typeof result === 'object' &&
		result !== null &&
		'error' in result &&
		typeof result.error === 'object' &&
		result.error !== null &&
		'message' in result.error &&
		typeof result.error.message === 'string'
			? result.error.message
			: 'The server did not remove the worktree.';
	throw new Error(error);
}

function sameGitStatuses(
	left: Record<string, FileExplorerGitStatus>,
	right: Record<string, FileExplorerGitStatus>,
): boolean {
	const leftEntries = Object.entries(left);
	if (leftEntries.length !== Object.keys(right).length) return false;
	return leftEntries.every(([path, status]) => right[path] === status);
}

function sameWorktreePanelStatus(
	left: WorktreePanelStatus | null,
	right: WorktreePanelStatus,
): boolean {
	return left !== null && JSON.stringify(left) === JSON.stringify(right);
}

type GitWorkspaceProjection = {
	referencesByPath: ReadonlyMap<string, GitWorktreeReference>;
	statuses: Record<string, FileExplorerGitStatus>;
	worktrees: WorktreePanelStatus;
};

export async function loadGitWorkspaceFromServer(
	gitClient: TerminayGitClient | undefined,
	project: Pick<ProjectTab, 'id' | 'rootFolder'>,
): Promise<GitWorkspaceProjection> {
	if (gitClient === undefined) {
		return {
			referencesByPath: new Map(),
			statuses: {},
			worktrees: GIT_UNAVAILABLE_WORKTREE_PANEL_STATUS,
		};
	}
	return await loadServerGitWorkspace(gitClient, project.id);
}

export function beginDirectoryLoad(
	versions: Map<string, number>,
	path: string,
): number {
	const version = (versions.get(path) ?? 0) + 1;
	versions.set(path, version);
	return version;
}

export function isCurrentDirectoryLoad(
	versions: ReadonlyMap<string, number>,
	path: string,
	version: number,
): boolean {
	return versions.get(path) === version;
}

export function getWatchResourcePath(path: string, rootFolder: string): string {
	const relativePath = getPathRelativeToRoot(path, rootFolder);
	return relativePath === '.' ? '' : relativePath;
}

export function useFileExplorerController({
	fileObservationClient,
	fileViewerClient,
	gitClient,
	isServerFileViewer,
	onOpenFile,
	onOpenTerminalAt,
	onOperationError,
	onOperationSucceeded,
	onSetError,
	onUpdateProject,
	project,
}: Options) {
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
	const [worktreePanelStatus, setWorktreePanelStatus] =
		useState<WorktreePanelStatus | null>(EMPTY_WORKTREE_PANEL_STATUS);
	const [deletingWorktreePaths, setDeletingWorktreePaths] = useState<
		Set<string>
	>(() => new Set());
	const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});
	const [pendingGitFilesystemAction, setPendingGitFilesystemAction] =
		useState<PendingGitFilesystemAction | null>(null);
	const [fileExplorerNameDialog, setFileExplorerNameDialog] =
		useState<FileExplorerNameDialogState | null>(null);
	const referencesRef = useRef<ReadonlyMap<string, GitWorktreeReference>>(
		new Map(),
	);
	const worktreeDeleteQueueRef = useRef(Promise.resolve());
	const gitStatusRefreshTimerRef = useRef<number | undefined>(undefined);
	const refreshTimersRef = useRef<Map<string, number>>(new Map());
	const unavailableWatchFallbacksRef = useRef<Set<string>>(new Set());
	const loadVersionsRef = useRef<Map<string, number>>(new Map());
	const directoryLoadsRef = useRef<Map<string, Promise<void>>>(new Map());
	const gitRefreshRequestIdRef = useRef(0);
	const latestGitRootRef = useRef(project.rootFolder);
	const dialogRequestIdRef = useRef(0);
	latestGitRootRef.current = project.rootFolder;

	const clientPath = useCallback(
		(path: string) => {
			if (!isServerFileViewer) return path;
			const relative = toContainedProjectRelativePath(path, project.rootFolder);
			if (relative === null) {
				throw new TypeError('file path is outside the project root');
			}
			return relative;
		},
		[isServerFileViewer, project.rootFolder],
	);
	const clientProjectId = isServerFileViewer ? project.id : undefined;
	const queueOwningWorktreeAction = useCallback(
		(
			path: string,
			createAction: (worktreeRoot: string) => PendingGitFilesystemAction,
		): boolean => {
			const worktreeRoot = gitFilesystemActionWorktreeRoot(
				path,
				project.rootFolder,
				worktreePanelStatus?.worktrees,
			);
			if (worktreeRoot === undefined) return false;
			setPendingGitFilesystemAction(createAction(worktreeRoot));
			onUpdateProject(project.id, { rootFolder: worktreeRoot });
			return true;
		},
		[onUpdateProject, project.id, project.rootFolder, worktreePanelStatus],
	);

	const requestFileExplorerName = useCallback(
		(options: FileExplorerNameDialogOptions) =>
			new Promise<string | null>((resolve) => {
				dialogRequestIdRef.current += 1;
				setFileExplorerNameDialog({
					...options,
					id: dialogRequestIdRef.current,
					resolve,
				});
			}),
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

	const loadDirectory = useCallback(
		(dirPath: string): Promise<void> => {
			return getOrCreateDirectoryLoad(
				directoryLoadsRef.current,
				dirPath,
				async () => {
					const requestVersion = beginDirectoryLoad(
						loadVersionsRef.current,
						dirPath,
					);
					setLoadingPaths((current) => ({ ...current, [dirPath]: true }));
					setDirectoryErrors((current) => {
						if (!(dirPath in current)) return current;
						const { [dirPath]: _removed, ...rest } = current;
						return rest;
					});
					try {
						const page = await fileViewerClient.listFolder(
							clientPath(dirPath),
							clientProjectId,
						);
						if (
							!isCurrentDirectoryLoad(
								loadVersionsRef.current,
								dirPath,
								requestVersion,
							)
						)
							return;
						setDirectoryChildren((current) => ({
							...current,
							[dirPath]: page.entries.map((entry) => ({
								isDirectory: entry.kind === 'directory',
								isSymbolicLink: entry.isSymbolicLink,
								mode: entry.mode ?? null,
								modifiedAtMs: entry.mtimeMs ?? null,
								name: entry.name,
								path: isServerFileViewer
									? joinPath(project.rootFolder, entry.relativePath)
									: entry.relativePath,
								size: entry.size,
							})),
						}));
						onOperationSucceeded('Explorer');
					} catch (error) {
						if (
							!isCurrentDirectoryLoad(
								loadVersionsRef.current,
								dirPath,
								requestVersion,
							)
						)
							return;
						const message = onOperationError('Explorer', error);
						setDirectoryErrors((current) => ({
							...current,
							[dirPath]: message,
						}));
					} finally {
						if (
							isCurrentDirectoryLoad(
								loadVersionsRef.current,
								dirPath,
								requestVersion,
							)
						) {
							setLoadingPaths((current) => {
								const { [dirPath]: _removed, ...rest } = current;
								return rest;
							});
						}
					}
				},
			);
		},
		[
			clientPath,
			clientProjectId,
			fileViewerClient,
			isServerFileViewer,
			onOperationError,
			onOperationSucceeded,
			project.rootFolder,
		],
	);

	const refreshGitStatusesForRoot = useCallback(async (
		rootFolder: string,
		markAsCurrent = false,
	) => {
		if (markAsCurrent) latestGitRootRef.current = rootFolder;
		const targetRootFolder = markAsCurrent
			? rootFolder
			: latestGitRootRef.current;
		if (!targetRootFolder) {
			gitRefreshRequestIdRef.current += 1;
			referencesRef.current = new Map();
			setGitStatuses((current) =>
				Object.keys(current).length === 0 ? current : {},
			);
			setWorktreePanelStatus((current) =>
				sameWorktreePanelStatus(current, EMPTY_WORKTREE_PANEL_STATUS)
					? current
					: EMPTY_WORKTREE_PANEL_STATUS,
			);
			return;
		}
		gitRefreshRequestIdRef.current += 1;
		const requestId = gitRefreshRequestIdRef.current;
		try {
			const projection = await loadGitWorkspaceFromServer(gitClient, {
				id: project.id,
				rootFolder: targetRootFolder,
			});
			if (
				gitRefreshRequestIdRef.current !== requestId ||
				latestGitRootRef.current !== targetRootFolder
			) {
				return;
			}
			referencesRef.current = projection.referencesByPath;
			setGitStatuses((current) =>
				sameGitStatuses(current, projection.statuses)
					? current
					: projection.statuses,
			);
			setWorktreePanelStatus((current) =>
				sameWorktreePanelStatus(current, projection.worktrees)
					? current
					: projection.worktrees,
			);
		} catch (error) {
			if (
				gitRefreshRequestIdRef.current !== requestId ||
				latestGitRootRef.current !== targetRootFolder
			)
				return;
			// Preserve the last good projection. If there has not been a successful
			// projection yet, publish a stable empty state instead of leaving the Git
			// sidebar in an indefinite loading state.
			setWorktreePanelStatus((current) => current ?? EMPTY_WORKTREE_PANEL_STATUS);
			onOperationError('Git', error);
		}
	}, [gitClient, onOperationError, project.id]);
	const scheduleDirectoryRefresh = useCallback(
		(dirPath: string) => {
			const existing = refreshTimersRef.current.get(dirPath);
			if (existing !== undefined) window.clearTimeout(existing);
			const timer = window.setTimeout(() => {
				refreshTimersRef.current.delete(dirPath);
				if (project.rootFolder) {
					void refreshGitStatusesForRoot(project.rootFolder, true);
				}
				void loadDirectory(dirPath).then(() => {
					const settleTimer = window.setTimeout(() => {
						refreshTimersRef.current.delete(dirPath);
						void loadDirectory(dirPath);
					}, WATCH_REFRESH_DELAY_MS);
					refreshTimersRef.current.set(dirPath, settleTimer);
				});
			}, WATCH_REFRESH_DELAY_MS);
			refreshTimersRef.current.set(dirPath, timer);
		},
		[loadDirectory, project.rootFolder, refreshGitStatusesForRoot],
	);

	const expandedWatchPaths = useMemo(
		() =>
			Object.entries(expandedPaths)
				.filter(([, expanded]) => expanded)
				.map(([path]) => path)
				.sort(),
		[expandedPaths],
	);

	const refreshFileExplorerTree = useCallback(() => {
		if (!project.rootFolder) return;
		for (const timer of refreshTimersRef.current.values())
			window.clearTimeout(timer);
		refreshTimersRef.current.clear();
		const paths = new Set([
			project.rootFolder,
			...Object.keys(directoryChildren),
		]);
		void Promise.all(Array.from(paths, loadDirectory));
	}, [directoryChildren, loadDirectory, project.rootFolder]);

	const toggleDirectory = useCallback(
		(path: string) => {
			setExpandedPaths((current) => ({ ...current, [path]: !current[path] }));
			if (!(path in directoryChildren)) void loadDirectory(path);
		},
		[directoryChildren, loadDirectory],
	);

	const renameEntryAtPath = useCallback(
		async (oldPath: string, nextPath: string, parent: string) => {
			try {
				await fileViewerClient.renameEntry(
					clientPath(oldPath),
					clientPath(nextPath),
					clientProjectId,
				);
				void loadDirectory(parent || project.rootFolder);
			} catch (error) {
				onOperationError('Explorer', error);
			}
		},
		[
			clientPath,
			clientProjectId,
			fileViewerClient,
			loadDirectory,
			onOperationError,
			project.rootFolder,
		],
	);
	const deleteEntryAtPath = useCallback(
		async (path: string) => {
			const name = path.split(/[/\\]/).pop() || '';
			try {
				await fileViewerClient.deleteEntry(
					clientPath(path),
					true,
					clientProjectId,
				);
				void loadDirectory(
					path.substring(0, path.length - name.length - 1) ||
						project.rootFolder,
				);
			} catch (error) {
				onOperationError('Explorer', error);
			}
		},
		[
			clientPath,
			clientProjectId,
			fileViewerClient,
			loadDirectory,
			onOperationError,
			project.rootFolder,
		],
	);
	const createFileAtPath = useCallback(
		async (path: string, dirPath: string) => {
			try {
				await fileViewerClient.createFile(
					clientPath(path),
					new Uint8Array(),
					clientProjectId,
				);
				void loadDirectory(dirPath);
				void onOpenFile(path, { initialMode: 'text' });
			} catch (error) {
				onOperationError('Explorer', error);
			}
		},
		[
			clientPath,
			clientProjectId,
			fileViewerClient,
			loadDirectory,
			onOpenFile,
			onOperationError,
		],
	);
	const createDirectoryAtPath = useCallback(
		async (path: string, dirPath: string) => {
			try {
				await fileViewerClient.createDirectory(
					clientPath(path),
					clientProjectId,
				);
				void loadDirectory(dirPath);
			} catch (error) {
				onOperationError('Explorer', error);
			}
		},
		[
			clientPath,
			clientProjectId,
			fileViewerClient,
			loadDirectory,
			onOperationError,
		],
	);

	const handleRename = useCallback(
		async (oldPath: string) => {
			const name = oldPath.split(/[/\\]/).pop() || '';
			const next = await requestFileExplorerName({
				initialValue: name,
				label: 'Name',
				submitLabel: 'Rename',
				title: 'Rename',
			});
			if (!next || next === name) return;
			const parent = oldPath.substring(0, oldPath.length - name.length);
			const nextPath = `${parent}${next}`;
			if (
				queueOwningWorktreeAction(oldPath, (worktreeRoot) => ({
					kind: 'rename',
					oldPath,
					nextPath,
					parentPath: parent,
					worktreeRoot,
				}))
			) {
				return;
			}
			await renameEntryAtPath(oldPath, nextPath, parent);
		},
		[queueOwningWorktreeAction, renameEntryAtPath, requestFileExplorerName],
	);

	const handleDelete = useCallback(
		async (path: string) => {
			const name = path.split(/[/\\]/).pop() || '';
			if (!window.confirm(`Are you sure you want to delete "${name}"?`)) return;
			if (
				queueOwningWorktreeAction(path, (worktreeRoot) => ({
					kind: 'delete',
					path,
					worktreeRoot,
				}))
			) {
				return;
			}
			await deleteEntryAtPath(path);
		},
		[deleteEntryAtPath, queueOwningWorktreeAction],
	);

	const handleNewFile = useCallback(
		async (dirPath: string) => {
			const name = await requestFileExplorerName({
				label: 'File name',
				submitLabel: 'Create File',
				title: 'Create New File',
			});
			if (!name) return;
			const path = joinPath(dirPath, name);
			if (
				queueOwningWorktreeAction(dirPath, (worktreeRoot) => ({
					kind: 'create-file',
					path,
					dirPath,
					worktreeRoot,
				}))
			) {
				return;
			}
			await createFileAtPath(path, dirPath);
		},
		[createFileAtPath, queueOwningWorktreeAction, requestFileExplorerName],
	);

	const handleNewFolder = useCallback(
		async (dirPath: string) => {
			const name = await requestFileExplorerName({
				label: 'Folder name',
				submitLabel: 'Create Folder',
				title: 'Create New Folder',
			});
			if (!name) return;
			const path = joinPath(dirPath, name);
			if (
				queueOwningWorktreeAction(dirPath, (worktreeRoot) => ({
					kind: 'create-folder',
					path,
					dirPath,
					worktreeRoot,
				}))
			) {
				return;
			}
			await createDirectoryAtPath(path, dirPath);
		},
		[
			createDirectoryAtPath,
			queueOwningWorktreeAction,
			requestFileExplorerName,
		],
	);

	const handleCopyPath = useCallback((path: string) => {
		void writeClipboardText(path);
	}, []);
	const handleCopyRelativePath = useCallback(
		(path: string) =>
			void writeClipboardText(
				getPathRelativeToRoot(path, project.rootFolder),
			),
		[project.rootFolder],
	);

	const handleSwitchProjectRootToWorktree = useCallback(
		(worktree: GitWorktreeStatus) => {
			onUpdateProject(project.id, { rootFolder: worktree.path });
			setExpandedPaths({ [worktree.path]: true });
			onSetError(null);
		},
		[onSetError, onUpdateProject, project.id],
	);
	const handleRenameWorktree = useCallback(
		async (worktree: GitWorktreeStatus) => {
			const name = await requestFileExplorerName({
				initialValue: worktree.name,
				label: 'Worktree folder name',
				submitLabel: 'Rename',
				title: 'Rename Worktree',
			});
			if (!name || name === worktree.name) return;
			const parent = parentPath(worktree.path);
			const nextPath = joinPath(parent, name);
			try {
				const reference = referencesRef.current.get(worktree.path);
				if (gitClient === undefined || reference === undefined) {
					throw new Error('Git worktree controls are unavailable.');
				}
				await gitClient.move(reference, name, worktree.head);
				if (project.rootFolder === worktree.path) {
					onUpdateProject(project.id, { rootFolder: nextPath });
					setExpandedPaths({ [nextPath]: true });
				}
				void loadDirectory(parent || project.rootFolder);
			} catch (error) {
				onOperationError('Git', error);
			}
		},
		[
			gitClient,
			loadDirectory,
			onSetError,
			onOperationError,
			onUpdateProject,
			project.id,
			project.rootFolder,
			requestFileExplorerName,
		],
	);
	const handleDeleteWorktree = useCallback(
		async (worktree: GitWorktreeStatus) => {
			if (
				!window.confirm(
					`Delete worktree "${worktree.name}"?\n\n${worktree.path}\n\nThis permanently removes this worktree folder, including uncommitted and untracked files.`,
				)
			)
				return;
			setDeletingWorktreePaths((current) =>
				new Set(current).add(worktree.path),
			);
			const run = async () => {
			try {
				const reference = referencesRef.current.get(worktree.path);
				if (gitClient === undefined || reference === undefined) {
					throw new Error('Git worktree controls are unavailable.');
				}
				const result = await gitClient.remove(reference, worktree.head);
				assertWorktreeRemoved(result);
				onSetError(null);
				// Linked worktrees commonly sit beside the project root. Refreshing
				// their parent would turn into a `..` server file request, which is
				// deliberately outside this project's filesystem capability.
				void loadDirectory(project.rootFolder);
			} catch (error) {
				console.error('[terminay] git.worktree.remove failed', error);
				onOperationError('Git', error);
			} finally {
				setDeletingWorktreePaths((current) => {
					const next = new Set(current);
					next.delete(worktree.path);
					return next;
				});
				if (project.rootFolder) {
					void refreshGitStatusesForRoot(project.rootFolder, true);
				}
			}
			};
			const queued = worktreeDeleteQueueRef.current.then(run, run);
			worktreeDeleteQueueRef.current = queued.then(() => undefined, () => undefined);
			await queued;
		},
		[
			gitClient,
			loadDirectory,
			onSetError,
			onOperationError,
			project.rootFolder,
			refreshGitStatusesForRoot,
		],
	);
	const handlePullWorktreeFromOrigin = useCallback(
		async (worktree: GitWorktreeStatus) => {
			try {
				const reference = referencesRef.current.get(worktree.path);
				if (gitClient === undefined || reference === undefined) {
					throw new Error('Git worktree controls are unavailable.');
				}
				await gitClient.pull(reference);
				onSetError(null);
			} catch (error) {
				onOperationError('Git', error);
			} finally {
				refreshFileExplorerTree();
			}
		},
		[gitClient, onOperationError, onSetError, refreshFileExplorerTree],
	);
	const handleRevealWorktree = useCallback(
		(worktree: GitWorktreeStatus) => {
			const reference = referencesRef.current.get(worktree.path);
			if (gitClient !== undefined && reference !== undefined) {
				void gitClient.reveal(reference);
			}
		},
		[gitClient],
	);
	const handleOpenTerminalAtWorktree = useCallback(
		(worktree: GitWorktreeStatus) =>
			openTerminalAtWorktree(worktree, onOpenTerminalAt),
		[onOpenTerminalAt],
	);
	const handleOpenGitEntry = useCallback(
		(entry: GitChangeEntry) => {
			if (
				queueOwningWorktreeAction(entry.path, (worktreeRoot) => ({
					kind: 'open-entry',
					entry,
					worktreeRoot,
				}))
			) {
				return;
			}
			void onOpenFile(
				entry.path,
				entry.state === 'untracked' ? undefined : { initialMode: 'diff' },
			);
		},
		[onOpenFile, queueOwningWorktreeAction],
	);

	useEffect(() => {
		if (
			pendingGitFilesystemAction === null ||
			!sameFilesystemPath(
				project.rootFolder,
				pendingGitFilesystemAction.worktreeRoot,
			)
		) {
			return;
		}
		const action = pendingGitFilesystemAction;
		setPendingGitFilesystemAction(null);
		if (action.kind === 'open-entry') {
			void onOpenFile(
				action.entry.path,
				action.entry.state === 'untracked'
					? undefined
					: { initialMode: 'diff' },
			);
			return;
		}
		if (action.kind === 'delete') {
			void deleteEntryAtPath(action.path);
			return;
		}
		if (action.kind === 'rename') {
			void renameEntryAtPath(
				action.oldPath,
				action.nextPath,
				action.parentPath,
			);
			return;
		}
		if (action.kind === 'create-file') {
			void createFileAtPath(action.path, action.dirPath);
			return;
		}
		void createDirectoryAtPath(action.path, action.dirPath);
	}, [
		createDirectoryAtPath,
		createFileAtPath,
		deleteEntryAtPath,
		onOpenFile,
		pendingGitFilesystemAction,
		project.rootFolder,
		renameEntryAtPath,
	]);

	useEffect(
		() => () => {
			for (const timer of refreshTimersRef.current.values())
				window.clearTimeout(timer);
			refreshTimersRef.current.clear();
			unavailableWatchFallbacksRef.current.clear();
		},
		[],
	);
	useEffect(() => {
		for (const timer of refreshTimersRef.current.values())
			window.clearTimeout(timer);
		refreshTimersRef.current.clear();
		unavailableWatchFallbacksRef.current.clear();
		setDirectoryChildren({});
		setDirectoryErrors({});
		setDeletingWorktreePaths(new Set());
		setExpandedPaths(project.rootFolder ? { [project.rootFolder]: true } : {});
		const explorerReady = explorerMayLoad(project);
		setLoadingPaths(
			project.rootFolder ? { [project.rootFolder]: true } : {},
		);
		if (project.rootFolder && explorerReady) {
			void loadDirectory(project.rootFolder);
			void refreshGitStatusesForRoot(project.rootFolder, true);
		}
	}, [
		loadDirectory,
		project.creationStatus,
		project.hydrating,
		project.projectEnvironmentId,
		project.rootFolder,
		refreshGitStatusesForRoot,
	]);
	useEffect(() => {
		if (gitClient === undefined || !project.rootFolder) return;
		let disposed = false;
		let unsubscribe: (() => void) | undefined;
			void gitClient
				.subscribeStatusChanges(
					(event) => {
						if (disposed || event.projectId !== project.id) return;
						if (gitStatusRefreshTimerRef.current !== undefined) {
							window.clearTimeout(gitStatusRefreshTimerRef.current);
						}
						gitStatusRefreshTimerRef.current = window.setTimeout(() => {
							gitStatusRefreshTimerRef.current = undefined;
							if (!disposed) void refreshGitStatusesForRoot(project.rootFolder, true);
						}, WATCH_REFRESH_DELAY_MS);
					},
					() => {
						if (!disposed)
							void refreshGitStatusesForRoot(project.rootFolder, true);
					},
				)
			.then((disposeSubscription) => {
				if (disposed) {
					disposeSubscription();
					return;
				}
				unsubscribe = disposeSubscription;
			})
			.catch(() => undefined);
		return () => {
			disposed = true;
			if (gitStatusRefreshTimerRef.current !== undefined) {
				window.clearTimeout(gitStatusRefreshTimerRef.current);
				gitStatusRefreshTimerRef.current = undefined;
			}
			unsubscribe?.();
		};
	}, [gitClient, project.id, project.rootFolder, refreshGitStatusesForRoot]);
	useEffect(() => {
		if (!worktreePanelStatus?.repoRoot) return;
		const visible = new Set(
			worktreePanelStatus.worktrees.map(({ path }) => path),
		);
		setDeletingWorktreePaths((current) => {
			const next = new Set(
				Array.from(current).filter((path) => visible.has(path)),
			);
			return next.size === current.size ? current : next;
		});
	}, [worktreePanelStatus]);
	useEffect(() => {
		if (
			!project.rootFolder ||
			!project.isFileExplorerOpen ||
			!fileObservationClient
		)
			return;
		if (expandedWatchPaths.length === 0) return;
		let disposed = false;
		const cleanups: Array<() => void> = [];
		void Promise.all(
			expandedWatchPaths.map(async (path) => {
				try {
					const handle = await fileObservationClient.startWatch(
						project.id,
						getWatchResourcePath(path, project.rootFolder),
					);
					if (disposed) {
						await fileObservationClient.stopWatch(handle.subscriptionId);
						return;
					}
					const unsubscribe = await fileObservationClient.subscribeWatch(
						handle,
						() => scheduleDirectoryRefresh(path),
						() => scheduleDirectoryRefresh(path),
					);
					cleanups.push(() => {
						unsubscribe();
						void fileObservationClient.stopWatch(handle.subscriptionId);
					});
				} catch {
					if (!disposed && !unavailableWatchFallbacksRef.current.has(path)) {
						unavailableWatchFallbacksRef.current.add(path);
						scheduleDirectoryRefresh(path);
					}
				}
			}),
		);
		return () => {
			disposed = true;
			for (const cleanup of cleanups) cleanup();
		};
	}, [
		expandedWatchPaths,
		fileObservationClient,
		loadDirectory,
		project.id,
		project.isFileExplorerOpen,
		project.rootFolder,
		scheduleDirectoryRefresh,
	]);
	const currentGitBranch = useMemo(() => {
		const worktrees = worktreePanelStatus?.worktrees;
		if (!worktrees) return null;
		return (
			worktrees.find(({ isCurrent }) => isCurrent)?.branch ??
			worktrees.find(({ path }) => path === worktreePanelStatus.repoRoot)
				?.branch ??
			null
		);
	}, [worktreePanelStatus]);

	return {
		cancelFileExplorerNameDialog,
		currentGitBranch,
		deletingWorktreePaths,
		directoryChildren,
		directoryErrors,
		expandedPaths,
		fileExplorerNameDialog,
		gitStatuses,
		handleCopyPath,
		handleCopyRelativePath,
		handleDelete,
		handleDeleteWorktree,
		handleNewFile,
		handleNewFolder,
		handleOpenGitEntry,
		handleOpenTerminalAtWorktree,
		handlePullWorktreeFromOrigin,
		handleRename,
		handleRenameWorktree,
		handleRevealWorktree,
		handleSwitchProjectRootToWorktree,
		loadDirectory,
		loadingPaths,
		refreshFileExplorerTree,
		refreshGitStatusesForRoot,
		submitFileExplorerNameDialog,
		toggleDirectory,
		worktreePanelStatus,
	};
}
