/**
 * The Folders tree's model.
 *
 * One row per folder of a project, holding that folder's terminals. The tree in
 * a project's left column and the peek under a project tab are two renderings
 * of this one model, so they cannot disagree about where a terminal is.
 *
 * It is a pure function of the workspace projection, what is known about each
 * panel, and the Git service's worktree listing. Nothing here decides where a
 * terminal belongs: the server does, and this only reads it.
 */

import type {
	ServerWorkspaceFolder,
	ServerWorkspacePanel,
	ServerWorkspaceProject,
} from '../shared/serverWorkspaceReconciliation.ts';
import type { AgentState } from '../types/agentStatus';

/** What is known about a panel beyond the workspace projection. */
export type FolderTreePanelFacts = {
	status: AgentState;
	title?: string;
};

/** The slice of a listed worktree the tree presents. */
export type FolderTreeWorktree = {
	path: string;
	/** Branch name, or a short detached-HEAD label, or null when unknown. */
	branch: string | null;
	/** True when the worktree is on no branch. */
	isDetached?: boolean;
	head?: string | null;
	pullRequest?: {
		number: number;
		state: string;
		title: string;
		url?: string;
		mergeable?: boolean;
	};
	checks?: { failed: number; pending: number; passed: number; skipped: number };
	/** The work the worktree holds that is nowhere but this machine. */
	change?: FolderTreeChange;
	/** Present when the branch holds commits the default branch lacks. */
	unmerged?: FolderTreeUnmerged;
};

/** Commits whose effect the default branch does not have, pushed or not. A
 * null count is an unmerged branch whose commits were not counted. */
export type FolderTreeUnmerged = { commits: number | null };

/**
 * What a linked folder's row says about its worktree's unpushed work: missing
 * from disk, the size of that work, changed with no measured size, or clean.
 * Clean means nothing uncommitted, nothing untracked, and no unpushed commit.
 */
export type FolderTreeChange =
	| { kind: 'missing' }
	| { kind: 'delta'; additions: number; deletions: number }
	| { kind: 'changed' }
	| { kind: 'clean' };

/** Dirty is work that exists only on this machine, measured or not. A clean
 * checkout, a worktree missing from disk, and one nothing is known about are
 * not. */
export function isChangeDirty(change: FolderTreeChange | undefined): boolean {
	return change?.kind === 'delta' || change?.kind === 'changed';
}

/**
 * What names a linked folder: the branch of its worktree. `suffix` is the
 * worktree's directory, present only when another checkout is on that branch.
 */
export type FolderLabel = { text: string; suffix?: string };

/** What a linked folder's details tooltip says about its worktree. */
export type FolderTreeDetails = {
	branch: string;
	worktree: string;
	location: string;
};

/**
 * The title a rename typed into a terminal's row saves, or null when it saves
 * nothing: a blank name, or the one the terminal already has.
 */
export function terminalRenameTitle(
	current: string,
	typed: string,
): string | null {
	const title = typed.trim();
	return title.length === 0 || title === current ? null : title;
}

export type FolderTreeTerminalRow = {
	panelId: string;
	sessionId: string;
	title: string;
	status: AgentState;
	isActive: boolean;
	/** The worktree this terminal created, when it is not in that folder. */
	createdWorktree?: string;
};

export type FolderTreeFolderRow = {
	id: string;
	/** A linked folder's is its label as plain text. */
	name: string;
	/** Present for a linked folder, which is named by it and has no title. */
	label?: FolderLabel;
	details?: FolderTreeDetails;
	kind: ServerWorkspaceFolder['kind'];
	isSelected: boolean;
	/** The worktree a linked folder stands for. Absent for General and plain. */
	worktreePath?: string;
	/** Shown beneath the name. Absent when the folder has no checkout to name. */
	branch?: string;
	pullRequest?: FolderTreeWorktree['pullRequest'];
	checks?: FolderTreeWorktree['checks'];
	/** The folder's unpushed work. Absent for a plain folder and where nothing
	 * has been measured. */
	change?: FolderTreeChange;
	/** True when the checkout holds work that exists only on this machine. */
	isDirty: boolean;
	/** True while this device is removing the folder's worktree. */
	isDeleting: boolean;
	/** Present when the checkout's branch holds commits the default branch
	 * lacks, pushed or not. */
	unmerged?: FolderTreeUnmerged;
	terminals: readonly FolderTreeTerminalRow[];
	/** True when the folder holds no panel of any kind. */
	isEmpty: boolean;
	/** An unanswered offer to move a terminal into this folder. */
	offer?: { panelId: string; title: string };
};

export type FolderTreeInput = {
	project: Pick<ServerWorkspaceProject, 'id' | 'folderIds' | 'root'>;
	folders: Readonly<Record<string, ServerWorkspaceFolder>>;
	panels: Readonly<Record<string, ServerWorkspacePanel>>;
	selectedFolderId?: string;
	activePanelId?: string;
	panelFacts?: (panelId: string) => FolderTreePanelFacts | undefined;
	/** The repository's worktrees, or undefined when the root is not a
	 * repository or the listing has not arrived. */
	worktrees?: readonly FolderTreeWorktree[];
	/** The worktrees this device is removing and has not heard the end of. */
	deletingWorktreePaths?: ReadonlySet<string>;
};

const DEFAULT_TERMINAL_TITLE = 'Terminal';

export function buildFolderTree(input: FolderTreeInput): FolderTreeFolderRow[] {
	const folders = input.project.folderIds
		.map((folderId) => input.folders[folderId])
		.filter((folder): folder is ServerWorkspaceFolder => folder !== undefined);
	const selectedFolderId = resolveSelectedFolderId(
		input.project,
		input.folders,
		input.selectedFolderId,
	);
	const worktreeByPath = new Map(
		(input.worktrees ?? []).map((worktree) => [worktree.path, worktree]),
	);
	const home = checkoutContaining(input.project.root, input.worktrees);
	// Which worktree each panel created, for the tag on a terminal that is
	// still somewhere else.
	const createdBy = new Map<string, ServerWorkspaceFolder>();
	for (const folder of folders)
		if (folder.createdByPanelId !== undefined && folder.worktree !== undefined)
			createdBy.set(folder.createdByPanelId, folder);
	const titleOf = (panel: ServerWorkspacePanel) =>
		input.panelFacts?.(panel.id)?.title ??
		panel.title ??
		DEFAULT_TERMINAL_TITLE;

	return folders.map((folder) => {
		const worktree =
			folder.worktree === undefined
				? folder.kind === 'general'
					? home
					: undefined
				: worktreeByPath.get(folder.worktree.path);
		const terminals: FolderTreeTerminalRow[] = [];
		for (const panelId of folder.panelIds) {
			const panel = input.panels[panelId];
			if (panel?.type !== 'terminal' || panel.sessionId === undefined) continue;
			const created = createdBy.get(panelId);
			terminals.push({
				panelId,
				sessionId: panel.sessionId,
				title: titleOf(panel),
				status: input.panelFacts?.(panelId)?.status ?? 'idle',
				isActive:
					folder.id === selectedFolderId && panelId === input.activePanelId,
				...(created === undefined || created.id === folder.id
					? {}
					: { createdWorktree: baseName(created.worktree?.path ?? '') }),
			});
		}
		const offered =
			folder.captureOffer === undefined
				? undefined
				: input.panels[folder.captureOffer.panelId];
		const label =
			folder.kind !== 'linked' || folder.worktree === undefined
				? undefined
				: linkedFolderLabel(folder.worktree.path, input.worktrees);
		return {
			id: folder.id,
			name: label === undefined ? folder.name : folderLabelText(label),
			...(label === undefined || folder.worktree === undefined
				? {}
				: {
						label,
						details: {
							branch: detailsBranch(worktree),
							worktree: baseName(folder.worktree.path),
							location: folder.worktree.path,
						},
					}),
			kind: folder.kind,
			isSelected: folder.id === selectedFolderId,
			...(folder.worktree === undefined
				? {}
				: { worktreePath: folder.worktree.path }),
			...(worktree?.branch == null ? {} : { branch: worktree.branch }),
			...(folder.kind !== 'linked' || worktree?.pullRequest === undefined
				? {}
				: { pullRequest: worktree.pullRequest }),
			...(folder.kind !== 'linked' || worktree?.checks === undefined
				? {}
				: { checks: worktree.checks }),
			// General's checkout is measured like any other; a plain folder has
			// no checkout, so `worktree` is undefined for it.
			...(worktree?.change === undefined ? {} : { change: worktree.change }),
			isDirty: isChangeDirty(worktree?.change),
			// Only a linked folder's worktree can be removed.
			isDeleting:
				folder.kind === 'linked' &&
				folder.worktree !== undefined &&
				input.deletingWorktreePaths?.has(folder.worktree.path) === true,
			...(worktree?.unmerged === undefined
				? {}
				: { unmerged: worktree.unmerged }),
			terminals,
			isEmpty: folder.panelIds.length === 0,
			...(offered === undefined
				? {}
				: { offer: { panelId: offered.id, title: titleOf(offered) } }),
		};
	});
}

/**
 * A linked folder's label: its worktree's branch. A worktree on no branch, or
 * one the listing does not hold, is named by its directory. Where another
 * checkout of the repository is on the same branch, which Git allows only when
 * forced, the directory follows the branch so the two can be told apart.
 */
export function linkedFolderLabel(
	worktreePath: string,
	worktrees: readonly FolderTreeWorktree[] | undefined,
): FolderLabel {
	const directory = baseName(worktreePath);
	const worktree = worktrees?.find((listed) => listed.path === worktreePath);
	if (
		worktree === undefined ||
		worktree.isDetached === true ||
		!worktree.branch
	)
		return { text: directory };
	const isShared = (worktrees ?? []).some(
		(other) =>
			other !== worktree &&
			other.isDetached !== true &&
			other.branch === worktree.branch,
	);
	return isShared
		? { text: worktree.branch, suffix: directory }
		: { text: worktree.branch };
}

/** A label where it cannot be drawn in two colours. */
export function folderLabelText(label: FolderLabel): string {
	return label.suffix === undefined
		? label.text
		: `${label.text} (${label.suffix})`;
}

/** What names a folder wherever the workspace names one: a linked folder's
 * label, and any other folder's own name. */
export function folderDisplayName(
	folder: Pick<ServerWorkspaceFolder, 'name' | 'kind' | 'worktree'>,
	worktrees: readonly FolderTreeWorktree[] | undefined,
): string {
	return folder.kind !== 'linked' || folder.worktree === undefined
		? folder.name
		: folderLabelText(linkedFolderLabel(folder.worktree.path, worktrees));
}

function detailsBranch(worktree: FolderTreeWorktree | undefined): string {
	if (worktree === undefined) return 'unknown';
	if (worktree.isDetached === true)
		return worktree.head
			? `detached at ${worktree.head.slice(0, 8)}`
			: 'detached';
	return worktree.branch ?? 'unknown';
}

/** A project's General folder, wherever it is in the project's order. */
export function generalFolderIdOf(
	project: Pick<ServerWorkspaceProject, 'folderIds'>,
	folders: Readonly<Record<string, Pick<ServerWorkspaceFolder, 'kind'>>>,
): string | undefined {
	return project.folderIds.find(
		(folderId) => folders[folderId]?.kind === 'general',
	);
}

/** The folder a device shows for a project: the one it remembers if that still
 * exists, otherwise General. */
export function resolveSelectedFolderId(
	project: Pick<ServerWorkspaceProject, 'folderIds'>,
	folders: Readonly<Record<string, ServerWorkspaceFolder>>,
	remembered: string | undefined,
): string | undefined {
	if (
		remembered !== undefined &&
		project.folderIds.includes(remembered) &&
		folders[remembered] !== undefined
	)
		return remembered;
	return generalFolderIdOf(project, folders);
}

/**
 * The folder order after one folder is moved to a place in it. Any folder may
 * take any place; a place beyond either end is the nearest end.
 */
export function folderOrderAfterMove(
	folderIds: readonly string[],
	folderId: string,
	toIndex: number,
): string[] {
	if (!folderIds.includes(folderId)) return [...folderIds];
	const order = folderIds.filter((id) => id !== folderId);
	order.splice(Math.max(0, Math.min(order.length, toIndex)), 0, folderId);
	return order;
}

/** The folder that holds a panel, for selecting it before the panel is focused. */
export function folderIdOfPanel(
	panels: Readonly<Record<string, ServerWorkspacePanel>>,
	panelId: string,
): string | undefined {
	return panels[panelId]?.folderId;
}

/** The deepest listed checkout that contains the project root: the one General
 * stands for. */
function checkoutContaining(
	root: string,
	worktrees: readonly FolderTreeWorktree[] | undefined,
): FolderTreeWorktree | undefined {
	const normalized = trimSeparators(root);
	return (worktrees ?? [])
		.filter((worktree) => {
			const path = trimSeparators(worktree.path);
			return (
				normalized === path ||
				normalized.startsWith(`${path}/`) ||
				normalized.startsWith(`${path}\\`)
			);
		})
		.sort((left, right) => right.path.length - left.path.length)[0];
}

function trimSeparators(path: string): string {
	return path.length > 1 ? path.replace(/[\\/]+$/, '') : path;
}

function baseName(path: string): string {
	return trimSeparators(path).split(/[\\/]/).at(-1) ?? path;
}
