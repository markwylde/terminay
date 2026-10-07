/**
 * Deleting a folder, or the worktree of a linked folder, that may still hold
 * panels.
 *
 * The server refuses to delete a folder that holds a panel, and closing a
 * terminal with a running process or a file with unsaved work is a question
 * the user answers one panel at a time. So the steps run here, in order: ask
 * what to do with the panels, do it to each one, and delete only once the
 * folder is seen to be empty. A panel that stays, because a close was declined
 * or a move was refused, stops the flow with nothing deleted.
 *
 * The steps are handed in, so this file decides the order and nothing else.
 */

export type FolderPanelsAnswer = 'move' | 'close' | 'cancel';

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
	/** Asked only when the folder holds panels. */
	ask: (panelCount: number) => Promise<FolderPanelsAnswer>;
	/** Move one panel to General, resolving once the move is the projection. */
	movePanel: (panelId: string) => Promise<void>;
	/**
	 * Close one panel through the ordinary close path, resolving once it has
	 * closed or the user has kept it. Declining is not an error.
	 */
	closePanel: (panelId: string) => Promise<void>;
	/**
	 * Delete the empty folder, or start the worktree's removal, which asks its
	 * own question.
	 */
	remove: () => Promise<void>;
};

export async function deleteFolderAndItsPanels(
	steps: FolderDeleteSteps,
): Promise<FolderDeleteOutcome> {
	const held = [...steps.panelIds()];
	if (held.length > 0) {
		const answer = await steps.ask(held.length);
		if (answer === 'cancel') return 'cancelled';
		// One at a time: each close may put a question to the user.
		for (const panelId of held) {
			// A panel that left by itself while the question was open is done.
			if (!steps.panelIds().includes(panelId)) continue;
			if (answer === 'move') await steps.movePanel(panelId);
			else await steps.closePanel(panelId);
		}
		// Anything still here was kept on purpose, or arrived meanwhile. Either
		// way the folder is not empty, and an unasked-about panel is never
		// closed or moved on the strength of an earlier answer.
		if (steps.panelIds().length > 0) return 'panels-remain';
	}
	await steps.remove();
	return 'removed';
}
