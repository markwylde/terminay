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
	branch: string | null;
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
	name: string;
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
		return {
			id: folder.id,
			name: folder.name,
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
	return project.folderIds[0];
}

/**
 * The folder order after one folder is moved to a place in it. General is
 * first and stays first: it is never the folder moved, and nothing is placed
 * above it. The server holds the same rule and is the one that enforces it.
 */
export function folderOrderAfterMove(
	folderIds: readonly string[],
	folderId: string,
	toIndex: number,
): string[] {
	const from = folderIds.indexOf(folderId);
	if (from <= 0) return [...folderIds];
	const order = folderIds.filter((id) => id !== folderId);
	order.splice(Math.max(1, Math.min(order.length, toIndex)), 0, folderId);
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
