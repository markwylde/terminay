/**
 * Deleting a folder, or the worktree of a linked folder, that may still hold
 * panels.
 *
 * The server refuses to delete a folder that holds a panel. So the steps run
 * here, in order: ask once what to do with the panels, which is also the only
 * confirmation the delete gets, do it to each one, and delete only once the
 * folder is seen to be empty. Nothing after the question asks anything: a
 * close is already confirmed, and the worktree's removal is too. A panel that
 * stays, because a move was refused or a panel arrived meanwhile, stops the
 * flow with nothing deleted.
 *
 * The steps are handed in, so this file decides the order and nothing else.
 */

export type FolderPanelsAnswer = 'move' | 'close' | 'cancel';

/**
 * What deleting a worktree does on disk, as the delete dialog states it. A
 * prunable worktree's working tree is already gone, so nothing is deleted.
 */
export function worktreeRemovalWarning(worktree: {
	readonly isPrunable?: boolean;
}): string {
	return worktree.isPrunable === true
		? "Its working tree is already gone. This removes Git's record of it; nothing on disk is deleted."
		: 'This permanently removes this worktree folder, including uncommitted, untracked, and unmerged changes.';
}

export type HeldPanel = {
	panelId: string;
	/**
	 * True for a panel only this device knows, such as a file opened here. The
	 * server holds no such panel, so it cannot be moved to another folder.
	 */
	isLocal: boolean;
};

/**
 * Every panel a folder holds: the ones the server places in it, then the ones
 * this device opened in it. The server counts only the first kind when it
 * decides whether a folder is empty, but deleting the folder takes the second
 * kind's workspace away with it, so they are the user's to decide about too.
 */
export function panelsHeldByFolder(
	folderId: string,
	folders: Readonly<Record<string, { readonly panelIds: readonly string[] }>>,
	inventory: readonly { readonly panelId: string; readonly folderId?: string }[],
): HeldPanel[] {
	const canonical = folders[folderId]?.panelIds ?? [];
	const known = new Set(canonical);
	return [
		...canonical.map((panelId) => ({ panelId, isLocal: false })),
		...inventory
			.filter((entry) => entry.folderId === folderId && !known.has(entry.panelId))
			.map((entry) => ({ panelId: entry.panelId, isLocal: true })),
	];
}

export type FolderDeleteOutcome =
	/** The folder was deleted, or its worktree's own removal was started. */
	| 'removed'
	| 'cancelled'
	/** At least one panel is still in the folder, so nothing was deleted. */
	| 'panels-remain';

export type FolderDeleteSteps = {
	/** The panels the folder holds right now. Read again after every step. */
	panelIds: () => readonly string[];
	/**
	 * Asked once, before anything is done: when the folder holds panels, and
	 * always when `alwaysAsk` is set, as it is for a worktree, whose removal
	 * this question confirms. With no panels only Delete or Cancel is wanted,
	 * and an answer of close or move both mean Delete.
	 */
	ask: (panelIds: readonly string[]) => Promise<FolderPanelsAnswer>;
	/** True when deleting removes something the user must confirm, a worktree. */
	alwaysAsk?: boolean;
	/** Move one panel to General, resolving once the move is the projection. */
	movePanel: (panelId: string) => Promise<void>;
	/**
	 * Close one panel as already confirmed, with no close protection, resolving
	 * once it has closed.
	 */
	closePanel: (panelId: string) => Promise<void>;
	/** Delete the empty folder, or remove its worktree, asking nothing. */
	remove: () => Promise<void>;
};

export async function deleteFolderAndItsPanels(
	steps: FolderDeleteSteps,
): Promise<FolderDeleteOutcome> {
	const held = [...steps.panelIds()];
	if (held.length > 0 || steps.alwaysAsk === true) {
		const answer = await steps.ask(held);
		if (answer === 'cancel') return 'cancelled';
		// One at a time, so the first failure stops the rest.
		for (const panelId of held) {
			// A panel that left by itself while the question was open is done.
			if (!steps.panelIds().includes(panelId)) continue;
			if (answer === 'move') await steps.movePanel(panelId);
			else await steps.closePanel(panelId);
		}
		// Anything still here did not go, or arrived after the question. Either
		// way the folder is not empty, and an unasked-about panel is never
		// closed or moved on the strength of an earlier answer.
		if (steps.panelIds().length > 0) return 'panels-remain';
	}
	await steps.remove();
	return 'removed';
}
