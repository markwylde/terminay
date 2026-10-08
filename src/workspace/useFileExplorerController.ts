import type {
	FileObservationClient,
	FileViewerClient,
	GitSignInChoice,
	GitWorktreeReference,
	TerminayGitClient,
} from '@terminay/client-core';
import {
	createRefreshSchedule,
	type RefreshSchedule,
} from '@terminay/protocol';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { writeClipboardText } from '../host/nativeActions';
import {
	getPathRelativeToRoot,
	toContainedProjectRelativePath,
} from '../pathUtils';
import { loadServerGitWorkspace } from '../services/git/serverGitWorkspaceAdapter';
import { parseWorktreeProperties } from '../services/git/worktreeProperties';
import type { FileViewerMode } from '../types/fileViewer';
import type {
	FileExplorerEntry,
	FileExplorerGitStatus,
	GitChangeEntry,
	GitWorktreeStatus,
	WorktreePanelStatus,
} from '../types/terminay';
import {
	type CleanWorktreeSweepSkip,
	cleanWorktreeSweepConfirmation,
	cleanWorktreeSweepOutcome,
	cleanWorktreeSweepTargetName,
	isBulkDeletableWorktree,
} from './cleanWorktreeSweep';
import type { ProjectTab } from './projectTabModel';
import { getOrCreateDirectoryLoad } from './directoryLoadCoordinator';
import { isDirectoryEntry } from './fileExplorerEntries';
import {
	createGitPaneSyncLog,
	type GitPaneSyncLog,
	type GitPaneSyncOutcome,
	type GitPaneSyncTrigger,
	isFreshGitPaneSync,
} from './gitPaneSyncLog';

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
	onOperationError: (
		feature: 'Explorer' | 'Git',
		error: unknown,
		source?: 'action' | 'refresh',
	) => string;
	onOperationSucceeded: (feature: 'Explorer' | 'Git') => void;
	onSetError: (message: string | null) => void;
	/**
	 * The project as this explorer shows it: `rootFolder` is the root of the
	 * folder on screen, which for a linked folder is its worktree. Nothing here
	 * changes the project's root; a folder's root is the server's to resolve.
	 */
	project: ProjectTab;
};

function joinPath(dirPath: string, name: string): string {
	return dirPath.endsWith('/') || dirPath.endsWith('\\')
		? `${dirPath}${name}`
		: `${dirPath}/${name}`;
}


function explorerMayLoad(project: ProjectTab): boolean {
	return project.creationStatus !== 'loading';
}

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

export function assertWorktreePulled(result: unknown): void {
	if (
		typeof result === 'object' &&
		result !== null &&
		'applied' in result &&
		result.applied === true &&
		'state' in result &&
		result.state === 'pulled'
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
			: 'The server did not pull the worktree.';
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
	worktreeId?: string,
	fresh = false,
): Promise<GitWorkspaceProjection> {
	if (gitClient === undefined) {
		return {
			referencesByPath: new Map(),
			statuses: {},
			worktrees: GIT_UNAVAILABLE_WORKTREE_PANEL_STATUS,
		};
	}
	return await loadServerGitWorkspace(
		gitClient,
		project.id,
		worktreeId,
		fresh,
	);
}

/**
 * Reconcile one Git workspace refresh. A refresh that survives to publish a
 * projection also repairs the Git feature banner: a transport outage (sleep,
 * a network drop) leaves a `Git is temporarily unavailable` notice behind, and
 * only the next successful refresh proves the server is reachable again.
 */
export async function applyGitWorkspaceRefresh({
	gitClient,
	project,
	isCurrent,
	publish,
	preserveLastProjection,
	onOperationError,
	onOperationSucceeded,
	worktreeId,
	sync,
}: {
	gitClient: TerminayGitClient | undefined;
	project: Pick<ProjectTab, 'id' | 'rootFolder'>;
	isCurrent: () => boolean;
	worktreeId?: string;
	/** What raised this refresh, and where its outcome is recorded. */
	sync?: { readonly trigger: GitPaneSyncTrigger; readonly log: GitPaneSyncLog };
	/** Returns `false` when the projection changed nothing on screen. */
	publish: (projection: GitWorkspaceProjection) => unknown;
	preserveLastProjection: () => void;
	onOperationError: (
		feature: 'Explorer' | 'Git',
		error: unknown,
		source?: 'action' | 'refresh',
	) => string;
	onOperationSucceeded: (feature: 'Explorer' | 'Git') => void;
}): Promise<void> {
	const startedAt = Date.now();
	const fresh = sync !== undefined && isFreshGitPaneSync(sync.trigger);
	const outcome = (
		result: GitPaneSyncOutcome,
		worktrees: number | null,
	): void =>
		sync?.log.record({
			trigger: sync.trigger,
			scoped: worktreeId !== undefined && !fresh,
			outcome: result,
			worktrees,
			durationMs: Date.now() - startedAt,
		});
	try {
		const projection = await loadGitWorkspaceFromServer(
			gitClient,
			project,
			worktreeId,
			fresh,
		);
		const worktrees = projection.worktrees.worktrees.length;
		if (!isCurrent()) {
			outcome('superseded', worktrees);
			return;
		}
		const changed = publish(projection) !== false;
		outcome(changed ? 'applied' : 'unchanged', worktrees);
		onOperationSucceeded('Git');
	} catch (error) {
		if (!isCurrent()) {
			outcome('superseded', null);
			return;
		}
		outcome('failed', null);
		// Preserve the last good projection. If there has not been a successful
		// projection yet, publish a stable empty state instead of leaving the Git
		// sidebar in an indefinite loading state.
		preserveLastProjection();
		onOperationError('Git', error, 'refresh');
	}
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
	onOperationError,
	onOperationSucceeded,
	onSetError,
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
	const [pullingWorktreePaths, setPullingWorktreePaths] = useState<Set<string>>(
		() => new Set(),
	);
	const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});
	const [fileExplorerNameDialog, setFileExplorerNameDialog] =
		useState<FileExplorerNameDialogState | null>(null);
	const referencesRef = useRef<ReadonlyMap<string, GitWorktreeReference>>(
		new Map(),
	);
	const worktreeDeleteQueueRef = useRef(Promise.resolve());
	const gitStatusRefreshScheduleRef = useRef<RefreshSchedule | undefined>(
		undefined,
	);
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
								isDirectory: isDirectoryEntry(entry),
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
						const message = onOperationError('Explorer', error, 'refresh');
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

	const gitPaneSyncLogRef = useRef<GitPaneSyncLog>(createGitPaneSyncLog());
	const shownGitProjectionRef = useRef<string | null>(null);
	const refreshGitStatusesForRoot = useCallback(async (
		rootFolder: string,
		markAsCurrent = false,
		/** Set when exactly one worktree's change raised this refresh, so the
		 *  server can carry the others forward instead of re-measuring them. */
		worktreeId?: string,
		trigger: GitPaneSyncTrigger = 'action',
	) => {
		if (markAsCurrent) latestGitRootRef.current = rootFolder;
		const targetRootFolder = markAsCurrent
			? rootFolder
			: latestGitRootRef.current;
		if (!targetRootFolder) {
			gitRefreshRequestIdRef.current += 1;
			shownGitProjectionRef.current = null;
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
		await applyGitWorkspaceRefresh({
			gitClient,
			project: { id: project.id, rootFolder: targetRootFolder },
			...(worktreeId === undefined ? {} : { worktreeId }),
			sync: { trigger, log: gitPaneSyncLogRef.current },
			isCurrent: () =>
				gitRefreshRequestIdRef.current === requestId &&
				latestGitRootRef.current === targetRootFolder,
			publish: (projection) => {
				const shown = JSON.stringify([
					projection.statuses,
					projection.worktrees,
				]);
				const changed = shownGitProjectionRef.current !== shown;
				shownGitProjectionRef.current = shown;
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
				return changed;
			},
			preserveLastProjection: () => {
				setWorktreePanelStatus(
					(current) => current ?? EMPTY_WORKTREE_PANEL_STATUS,
				);
			},
			onOperationError,
			onOperationSucceeded,
		});
	}, [gitClient, onOperationError, onOperationSucceeded, project.id]);
	const scheduleDirectoryRefresh = useCallback(
		(dirPath: string) => {
			const existing = refreshTimersRef.current.get(dirPath);
			if (existing !== undefined) window.clearTimeout(existing);
			const timer = window.setTimeout(() => {
				refreshTimersRef.current.delete(dirPath);
				if (project.rootFolder) {
					void refreshGitStatusesForRoot(
						project.rootFolder,
						true,
						undefined,
						'directory',
					);
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
			await renameEntryAtPath(oldPath, nextPath, parent);
		},
		[renameEntryAtPath, requestFileExplorerName],
	);

	const handleDelete = useCallback(
		async (path: string) => {
			const name = path.split(/[/\\]/).pop() || '';
			if (!window.confirm(`Are you sure you want to delete "${name}"?`)) return;
			await deleteEntryAtPath(path);
		},
		[deleteEntryAtPath],
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
			await createFileAtPath(path, dirPath);
		},
		[createFileAtPath, requestFileExplorerName],
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
			await createDirectoryAtPath(path, dirPath);
		},
		[createDirectoryAtPath, requestFileExplorerName],
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

	const handleRenameWorktree = useCallback(
		async (worktree: GitWorktreeStatus) => {
			const name = await requestFileExplorerName({
				initialValue: worktree.name,
				label: 'Worktree folder name',
				submitLabel: 'Rename',
				title: 'Rename Worktree',
			});
			if (!name || name === worktree.name) return;
			try {
				const reference = referencesRef.current.get(worktree.path);
				if (gitClient === undefined || reference === undefined) {
					throw new Error('Git worktree controls are unavailable.');
				}
				// The linked folder follows its renamed worktree through the
				// server's own link, and the listing that names the new path
				// arrives as a Git status change. Nothing is repointed from here.
				await gitClient.move(reference, name, worktree.head);
				onSetError(null);
			} catch (error) {
				onOperationError('Git', error);
			}
		},
		[gitClient, onSetError, onOperationError, requestFileExplorerName],
	);
	const handleDeleteWorktree = useCallback(
		async (worktree: GitWorktreeStatus) => {
			if (
				!window.confirm(
					worktree.isPrunable
						? `Delete worktree "${worktree.name}"?\n\n${worktree.path}\n\nIts working tree is already gone. This removes Git's record of it; nothing on disk is deleted.`
						: `Delete worktree "${worktree.name}"?\n\n${worktree.path}\n\nThis permanently removes this worktree folder, including uncommitted and untracked files.`,
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
			setPullingWorktreePaths((current) => new Set(current).add(worktree.path));
			try {
				const reference = referencesRef.current.get(worktree.path);
				if (gitClient === undefined || reference === undefined) {
					throw new Error('Git worktree controls are unavailable.');
				}
				// The client resolves with the server's result, so a pull the
				// server refused has to be raised here or it reads as a success.
				assertWorktreePulled(await gitClient.pull(reference));
				onSetError(null);
			} catch (error) {
				console.error('[terminay] git.worktree.pull failed', error);
				onOperationError('Git', error);
			} finally {
				setPullingWorktreePaths((current) => {
					const next = new Set(current);
					next.delete(worktree.path);
					return next;
				});
				refreshFileExplorerTree();
			}
		},
		[gitClient, onOperationError, onSetError, refreshFileExplorerTree],
	);
	const handleRevealWorktree = useCallback(
		(worktree: GitWorktreeStatus) => {
			const reference = referencesRef.current.get(worktree.path);
			if (gitClient === undefined || reference === undefined) return;
			gitClient.reveal(reference).catch((error: unknown) => {
				console.error('[terminay] git.worktree.reveal failed', error);
				onOperationError('Git', error);
			});
		},
		[gitClient, onOperationError],
	);
	// A folder is shown by id: the server decides which directory it is, so
	// this works for a plain folder and for a project outside any repository.
	const handleRevealFolder = useCallback(
		(folderId: string) => {
			if (gitClient === undefined) return;
			gitClient
				.revealFolder({ projectId: project.id, folderId })
				.catch((error: unknown) => {
					console.error('[terminay] folder reveal failed', error);
					onOperationError('Explorer', error);
				});
		},
		[gitClient, onOperationError, project.id],
	);
	/** Every check of one worktree; a listing carries only the counts. */
	const listedWorktreesRef = useRef(worktreePanelStatus?.worktrees);
	listedWorktreesRef.current = worktreePanelStatus?.worktrees;
	const handleLoadWorktreeChecks = useCallback(
		async (worktreePath: string) => {
			const worktree = listedWorktreesRef.current?.find(
				(candidate) => candidate.path === worktreePath,
			);
			if (worktree === undefined) return undefined;
			if (gitClient === undefined || worktree.worktreeId === undefined)
				return worktree.properties?.checks;
			const result = await gitClient.worktreeProperties({
				projectId: project.id,
				worktreeId: worktree.worktreeId,
			});
			const properties =
				typeof result === 'object' && result !== null && !Array.isArray(result)
					? parseWorktreeProperties(result.properties)
					: undefined;
			return properties?.checks ?? worktree.properties?.checks;
		},
		[gitClient, project.id],
	);
	// The Changes pane lists the worktree of the folder on screen, which is
	// this explorer's own root, so a change is opened as a file of this folder.
	const handleOpenGitEntry = useCallback(
		(entry: GitChangeEntry) => {
			void onOpenFile(
				entry.path,
				entry.state === 'untracked' ? undefined : { initialMode: 'diff' },
			);
		},
		[onOpenFile],
	);

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
			void refreshGitStatusesForRoot(project.rootFolder, true, undefined, 'root');
		}
	}, [
		loadDirectory,
		project.creationStatus,
		project.rootFolder,
		refreshGitStatusesForRoot,
	]);
	useEffect(() => {
		if (gitClient === undefined || !project.rootFolder) return;
		let disposed = false;
		let unsubscribe: (() => void) | undefined;
		// Each refresh spawns Git commands, so its rate is a cost rather than a
		// latency preference. A minimum interval bounds that rate however the
		// events arrive; a trailing debounce did not, and re-fired for every event
		// spaced wider than its delay.
		const pendingWorktreeIds = new Set<string>();
		// An event that names no worktree tells us nothing about what changed, so
		// it forces a full refresh however few named ones accompany it.
		let sawUnattributedChange = false;
		const schedule = createRefreshSchedule({
			run: () => {
				// Exactly one worktree changed during this interval, so the refresh
				// can name it. Several, or none identified, must refresh everything —
				// scoping to one of them would drop the others' changes.
				const scoped =
					!sawUnattributedChange && pendingWorktreeIds.size === 1
						? [...pendingWorktreeIds][0]
						: undefined;
				pendingWorktreeIds.clear();
				sawUnattributedChange = false;
				if (!disposed)
					void refreshGitStatusesForRoot(
						project.rootFolder,
						true,
						scoped,
						'event',
					);
			},
		});
		gitStatusRefreshScheduleRef.current = schedule;
			void gitClient
				.subscribeStatusChanges(
					(event) => {
						if (disposed || event.projectId !== project.id) return;
						if (typeof event.worktreeId === 'string' && event.worktreeId.length > 0)
							pendingWorktreeIds.add(event.worktreeId);
						else sawUnattributedChange = true;
						schedule.request();
					},
					() => {
						if (!disposed)
							void refreshGitStatusesForRoot(
								project.rootFolder,
								true,
								undefined,
								'resync',
							);
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
			schedule.cancel();
			if (gitStatusRefreshScheduleRef.current === schedule)
				gitStatusRefreshScheduleRef.current = undefined;
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
					// The directory was listed while this watch was still being
					// started, and whatever changed in between reached nobody. Read
					// it once more now that the watch is in place: after any listing
					// already under way, which may itself predate the watch.
					const underWay = directoryLoadsRef.current.get(path);
					void (underWay ?? Promise.resolve()).then(() => {
						if (!disposed) void loadDirectory(path);
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
	const cleanWorktreesToDelete = useMemo(() => {
		const busy = new Set([...deletingWorktreePaths, ...pullingWorktreePaths]);
		return (worktreePanelStatus?.worktrees ?? []).filter((worktree) =>
			isBulkDeletableWorktree(worktree, busy),
		);
	}, [deletingWorktreePaths, pullingWorktreePaths, worktreePanelStatus]);
	const handleDeleteCleanWorktrees = useCallback(async () => {
		const targets = cleanWorktreesToDelete;
		if (targets.length === 0) return;
		if (
			!window.confirm(
				cleanWorktreeSweepConfirmation(
					targets.map(cleanWorktreeSweepTargetName),
				),
			)
		)
			return;
		// Marking every target up front shows the whole batch as in flight and
		// takes it out of eligibility, so a second sweep finds nothing to do.
		setDeletingWorktreePaths(
			(current) => new Set([...current, ...targets.map(({ path }) => path)]),
		);
		let deletedCount = 0;
		const skipped: CleanWorktreeSweepSkip[] = [];
		const run = async () => {
			for (const worktree of targets) {
				try {
					const reference = referencesRef.current.get(worktree.path);
					if (
						gitClient === undefined ||
						reference === undefined ||
						worktree.head === null
					) {
						throw new Error('Git worktree controls are unavailable.');
					}
					assertWorktreeRemoved(
						await gitClient.removeClean(reference, worktree.head),
					);
					deletedCount += 1;
				} catch (error) {
					// One refusal never stops the sweep; it is reported at the end.
					console.error('[terminay] git.worktree.remove-clean failed', error);
					skipped.push({
						name: worktree.name,
						reason: error instanceof Error ? error.message : String(error),
					});
				} finally {
					setDeletingWorktreePaths((current) => {
						const next = new Set(current);
						next.delete(worktree.path);
						return next;
					});
				}
			}
			if (deletedCount > 0) onSetError(null);
			void loadDirectory(project.rootFolder);
			if (project.rootFolder) {
				void refreshGitStatusesForRoot(project.rootFolder, true);
			}
		};
		const queued = worktreeDeleteQueueRef.current.then(run, run);
		worktreeDeleteQueueRef.current = queued.then(
			() => undefined,
			() => undefined,
		);
		await queued;
		const outcome = cleanWorktreeSweepOutcome(deletedCount, skipped);
		if (outcome !== null) window.alert(outcome);
	}, [
		cleanWorktreesToDelete,
		gitClient,
		loadDirectory,
		onSetError,
		project.rootFolder,
		refreshGitStatusesForRoot,
	]);

	const handleRespondWorktreeSignIn = useCallback(
		async (choice: GitSignInChoice, token?: string) => {
			const prompt = worktreePanelStatus?.signIn;
			if (gitClient === undefined || prompt === undefined) return;
			await gitClient.signIn({
				projectId: project.id,
				origin: prompt.origin,
				choice,
				...(token === undefined ? {} : { token }),
			});
			if (project.rootFolder)
				await refreshGitStatusesForRoot(project.rootFolder, true);
		},
		[
			gitClient,
			project.id,
			project.rootFolder,
			refreshGitStatusesForRoot,
			worktreePanelStatus?.signIn,
		],
	);

	return {
		cancelFileExplorerNameDialog,
		cleanWorktreeDeleteCount: cleanWorktreesToDelete.length,
		deletingWorktreePaths,
		directoryChildren,
		directoryErrors,
		expandedPaths,
		fileExplorerNameDialog,
		gitStatuses,
		handleCopyPath,
		handleCopyRelativePath,
		handleDelete,
		handleDeleteCleanWorktrees,
		handleDeleteWorktree,
		handleRespondWorktreeSignIn,
		handleNewFile,
		handleNewFolder,
		handleOpenGitEntry,
		handlePullWorktreeFromOrigin,
		handleRename,
		handleRenameWorktree,
		handleLoadWorktreeChecks,
		handleRevealFolder,
		handleRevealWorktree,
		loadDirectory,
		loadingPaths,
		pullingWorktreePaths,
		refreshFileExplorerTree,
		refreshGitStatusesForRoot,
		submitFileExplorerNameDialog,
		toggleDirectory,
		worktreePanelStatus,
	};
}
