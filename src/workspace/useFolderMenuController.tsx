import { type ReactNode, useCallback, useRef, useState } from 'react';
import { FolderMenu } from '../components/folders/FolderMenu';
import { FolderPanelsQuestion } from '../components/folders/FolderPanelsQuestion';
import { writeClipboardText } from '../host/nativeActions';
import { getPathRelativeToRoot } from '../pathUtils';
import type { ServerWorkspaceSnapshot } from '../shared/serverWorkspaceReconciliation';
import type { WorkspaceSnapshotStore } from '../shared/WorkspaceSnapshotStore';
import type { GitWorktreeStatus, WorktreePanelStatus } from '../types/terminay';
import {
	deleteFolderAndItsPanels,
	type FolderPanelsAnswer,
	panelsHeldByFolder,
} from './folderDeleteFlow';
import { type FolderMenuActionId, folderMenuEntries } from './folderMenuModel';
import {
	folderDirectory,
	isGitProject,
	worktreeOfFolder,
} from './folderWorktree';
import type { FileExplorerNameDialogState } from './useFileExplorerController';
import type { WorkspaceInventoryEntry } from './workspaceInventory';

/** How long a move or a local close is given to show up before the flow stops. */
const SETTLE_TIMEOUT_MS = 10_000;
/** How long this device is given to draw what the server has already done. */
const LOCAL_SETTLE_TIMEOUT_MS = 3_000;

type Options = {
	project: { id: string; rootFolder: string };
	snapshot: ServerWorkspaceSnapshot | null;
	store: WorkspaceSnapshotStore | undefined;
	/** Every panel of the project, the ones only this device knows included. */
	projectInventory: readonly WorkspaceInventoryEntry[];
	worktreeStatus: WorktreePanelStatus | null;
	deletingWorktreePaths: ReadonlySet<string>;
	pullingWorktreePaths: ReadonlySet<string>;
	/** The worktree actions, each run on the worktree a folder stands for. */
	onCommitAndPush: (
		worktree: GitWorktreeStatus,
		anchor: { x: number; y: number },
	) => void;
	onPullFromOrigin: (worktree: GitWorktreeStatus) => void;
	onRenameWorktree: (worktree: GitWorktreeStatus) => void;
	/** Asks its own question, then removes the worktree. */
	onDeleteWorktree: (worktree: GitWorktreeStatus) => Promise<void>;
	/** Show a folder's directory in the file manager. The server is told the
	 * folder and decides the directory, so this needs no repository. */
	onRevealFolder: (folderId: string) => void;
	/** Create a terminal in a folder, starting in that folder's root. */
	onOpenShell: (folderId: string) => void;
	/** Close a panel as closing its tab does, with every question that asks. */
	onClosePanel: (folderId: string, panelId: string) => Promise<void>;
	onError: (message: string) => void;
};

type PanelsQuestion = {
	folderName: string;
	deletesWorktree: boolean;
	panelCount: number;
	resolve: (answer: FolderPanelsAnswer) => void;
};

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Resolves once `done` is true, checking each frame, or after the timeout. */
function waitUntil(done: () => boolean, timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		const startedAt = performance.now();
		const check = () => {
			if (done()) resolve(true);
			else if (performance.now() - startedAt >= timeoutMs) resolve(false);
			else window.requestAnimationFrame(check);
		};
		check();
	});
}

/**
 * The folder context menu and everything it starts.
 *
 * The worktree actions are handed in; a folder only decides which worktree
 * each is run on. The folder actions, rename and delete, are workspace
 * commands the server commits. Deleting runs through `deleteFolderAndItsPanels`, which is where
 * the order of questions and steps is decided.
 */
export function useFolderMenuController(options: Options) {
	// A delete runs across several server round trips and user answers, so it
	// reads what is true when each step runs, not what was true when it began.
	const latest = useRef(options);
	latest.current = options;

	const [menu, setMenu] = useState<{
		folderId: string;
		x: number;
		y: number;
	} | null>(null);
	const [panelsQuestion, setPanelsQuestion] = useState<PanelsQuestion | null>(
		null,
	);
	const [folderNameDialog, setFolderNameDialog] =
		useState<FileExplorerNameDialogState | null>(null);
	const nameDialogIdRef = useRef(0);

	const openFolderMenu = useCallback(
		(folderId: string, anchor: { x: number; y: number }) =>
			setMenu({ folderId, ...anchor }),
		[],
	);
	const closeFolderMenu = useCallback(() => setMenu(null), []);

	const requestFolderName = useCallback(
		(initialValue: string) =>
			new Promise<string | null>((resolve) => {
				nameDialogIdRef.current += 1;
				setFolderNameDialog({
					id: nameDialogIdRef.current,
					initialValue,
					label: 'Folder name',
					resolve,
					submitLabel: 'Rename',
					title: 'Rename Folder',
				});
			}),
		[],
	);
	const cancelFolderNameDialog = useCallback(() => {
		setFolderNameDialog((current) => {
			current?.resolve(null);
			return null;
		});
	}, []);
	const submitFolderNameDialog = useCallback((value: string) => {
		setFolderNameDialog((current) => {
			current?.resolve(value);
			return null;
		});
	}, []);

	const renameFolder = useCallback(
		async (folderId: string) => {
			const folder = latest.current.snapshot?.folders[folderId];
			if (folder === undefined) return;
			const name = await requestFolderName(folder.name);
			if (!name || name === folder.name) return;
			const { store, onError } = latest.current;
			if (store === undefined) {
				onError('The selected server workspace is not ready.');
				return;
			}
			try {
				// The new name is shown once the server has committed it.
				await store.renameFolder({ folderId, name });
			} catch (error) {
				onError(`Unable to rename the folder: ${messageOf(error)}`);
			}
		},
		[requestFolderName],
	);

	const deleteFolder = useCallback(
		async (folderId: string, worktree: GitWorktreeStatus | undefined) => {
			const starting = latest.current;
			const folder = starting.snapshot?.folders[folderId];
			const store = starting.store;
			if (folder === undefined || folder.kind === 'general') return;
			if (store === undefined) {
				starting.onError('The selected server workspace is not ready.');
				return;
			}
			const generalFolderId =
				starting.snapshot?.projects[starting.project.id]?.folderIds[0];
			const held = () =>
				panelsHeldByFolder(
					folderId,
					store.snapshot?.folders ?? {},
					latest.current.projectInventory,
				);
			const isLocal = (panelId: string) =>
				held().find((panel) => panel.panelId === panelId)?.isLocal === true;
			// What this device shows follows the server by a frame or two. A panel
			// the server no longer places in the folder, but which this device still
			// lists there, has left and is only waiting to be drawn that way; a
			// panel the server still places there was kept, and is not waited for.
			const shownAsLeft = (panelId: string) =>
				waitUntil(() => {
					const panel = held().find(
						(candidate) => candidate.panelId === panelId,
					);
					return panel === undefined || !panel.isLocal;
				}, LOCAL_SETTLE_TIMEOUT_MS);
			const closePanel = async (panelId: string) => {
				const local = isLocal(panelId);
				await latest.current.onClosePanel(folderId, panelId);
				// A panel only this device knows is gone once its workspace says so.
				if (local)
					await waitUntil(
						() => !held().some((panel) => panel.panelId === panelId),
						500,
					);
				else await shownAsLeft(panelId);
			};
			try {
				await deleteFolderAndItsPanels({
					panelIds: () => held().map((panel) => panel.panelId),
					ask: (panelCount) =>
						new Promise<FolderPanelsAnswer>((resolve) =>
							setPanelsQuestion({
								folderName: folder.name,
								deletesWorktree: folder.kind === 'linked',
								panelCount,
								resolve,
							}),
						),
					movePanel: async (panelId) => {
						// The server holds no panel to move for a file opened on this
						// device, and its workspace goes with the folder: it is closed
						// the ordinary way, which saves what it can first.
						if (isLocal(panelId)) {
							await closePanel(panelId);
							return;
						}
						if (generalFolderId === undefined)
							throw new Error('This project has no General folder to move to.');
						await store.movePanelToFolder({ panelId, folderId: generalFolderId });
						const moved = await store.waitForSnapshot(
							(snapshot) => snapshot.panels[panelId]?.folderId !== folderId,
							{ timeoutMs: SETTLE_TIMEOUT_MS },
						);
						if (moved === null)
							throw new Error('Timed out waiting for the panel to move.');
						await shownAsLeft(panelId);
					},
					closePanel,
					remove: async () => {
						if (folder.kind === 'plain') {
							await store.deleteFolder(folderId);
							return;
						}
						// A linked folder goes when its worktree does: the server
						// removes the folder itself once the worktree is gone.
						if (worktree !== undefined)
							await latest.current.onDeleteWorktree(worktree);
					},
				});
			} catch (error) {
				latest.current.onError(
					`Unable to delete ${folder.kind === 'linked' ? 'the worktree' : 'the folder'}: ${messageOf(error)}`,
				);
			}
		},
		[],
	);

	const answerPanelsQuestion = useCallback((answer: FolderPanelsAnswer) => {
		setPanelsQuestion((current) => {
			current?.resolve(answer);
			return null;
		});
	}, []);

	let folderMenuElement: ReactNode = null;
	const folder =
		menu === null ? undefined : options.snapshot?.folders[menu.folderId];
	if (menu !== null && folder !== undefined) {
		const { project, worktreeStatus } = options;
		const gitProject = isGitProject(worktreeStatus);
		// A plain folder stands for no worktree, so it is offered no Git action.
		const worktree =
			folder.kind === 'plain'
				? undefined
				: worktreeOfFolder(folder, project.rootFolder, worktreeStatus);
		const directory = folderDirectory(folder, project.rootFolder, worktreeStatus);
		const anchor = { x: menu.x, y: menu.y };
		const folderId = menu.folderId;
		const run = (action: FolderMenuActionId) => {
			switch (action) {
				case 'commit-and-push':
					if (worktree !== undefined) options.onCommitAndPush(worktree, anchor);
					return;
				case 'pull':
					if (worktree !== undefined) options.onPullFromOrigin(worktree);
					return;
				case 'rename-folder':
					void renameFolder(folderId);
					return;
				case 'rename-worktree':
					if (worktree !== undefined) options.onRenameWorktree(worktree);
					return;
				case 'delete-worktree':
				case 'delete-folder':
					void deleteFolder(folderId, worktree);
					return;
				case 'copy-path':
					void writeClipboardText(directory);
					return;
				case 'copy-relative-path':
					void writeClipboardText(
						getPathRelativeToRoot(
							directory,
							worktreeStatus?.repoRoot ?? project.rootFolder,
						),
					);
					return;
				case 'open-shell':
					options.onOpenShell(folderId);
					return;
				case 'reveal':
					options.onRevealFolder(folderId);
					return;
			}
		};
		folderMenuElement = (
			<FolderMenu
				x={menu.x}
				y={menu.y}
				entries={folderMenuEntries({
					kind: folder.kind,
					isGitProject: gitProject,
					worktree,
					isPulling:
						worktree !== undefined &&
						options.pullingWorktreePaths.has(worktree.path),
					isDeleting:
						worktree !== undefined &&
						options.deletingWorktreePaths.has(worktree.path),
					// The server reveals a folder by id, in or out of a repository.
					canReveal: worktreeStatus?.folderRevealAvailable === true,
				})}
				onAction={run}
				onClose={closeFolderMenu}
			/>
		);
	}

	return {
		cancelFolderNameDialog,
		folderMenuElement: (
			<>
				{folderMenuElement}
				{panelsQuestion === null ? null : (
					<FolderPanelsQuestion
						folderName={panelsQuestion.folderName}
						deletesWorktree={panelsQuestion.deletesWorktree}
						panelCount={panelsQuestion.panelCount}
						onAnswer={answerPanelsQuestion}
					/>
				)}
			</>
		),
		folderNameDialog,
		openFolderMenu,
		submitFolderNameDialog,
	};
}
