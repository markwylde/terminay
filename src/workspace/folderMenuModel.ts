/**
 * What a folder's context menu offers.
 *
 * A folder that stands for a worktree, a linked folder or General in a
 * repository, offers that worktree's actions, each available exactly when Git
 * and the host allow it for that worktree. A folder that stands for none, a
 * plain folder or General outside a repository, is offered nothing Git-shaped
 * at all.
 *
 * This decides what is listed and what is greyed. What an entry does is the
 * caller's business.
 */

import type { ServerWorkspaceFolder } from '../shared/serverWorkspaceReconciliation.ts';
import type { GitWorktreeStatus } from '../types/terminay';

export type FolderMenuActionId =
	| 'commit-and-push'
	| 'pull'
	| 'rename-folder'
	| 'rename-worktree'
	| 'delete-worktree'
	| 'delete-folder'
	| 'copy-path'
	| 'copy-relative-path'
	| 'open-shell'
	| 'reveal';

export type FolderMenuEntry =
	| { readonly separator: true }
	| {
			readonly separator?: false;
			readonly id: FolderMenuActionId;
			readonly label: string;
			readonly disabled: boolean;
			readonly danger?: true;
	  };

/** The facts of a listed worktree that decide availability. */
export type FolderMenuWorktree = Pick<
	GitWorktreeStatus,
	| 'branch'
	| 'isBare'
	| 'isCurrent'
	| 'isDetached'
	| 'isMain'
	| 'isPrunable'
	| 'errorMessage'
>;

export type FolderMenuInput = {
	kind: ServerWorkspaceFolder['kind'];
	/** True when the project root is inside a Git repository. */
	isGitProject: boolean;
	/**
	 * The worktree the folder stands for. Absent for a plain folder, for
	 * General outside a repository, and for a linked folder whose worktree the
	 * listing does not hold.
	 */
	worktree: FolderMenuWorktree | undefined;
	isPulling?: boolean;
	isDeleting?: boolean;
	/** The server can show a directory in this machine's file manager. */
	canReveal: boolean;
};

const SEPARATOR: FolderMenuEntry = Object.freeze({ separator: true });

export function folderMenuEntries(input: FolderMenuInput): FolderMenuEntry[] {
	const { kind, worktree } = input;
	const isPulling = input.isPulling === true;
	const isDeleting = input.isDeleting === true;
	// A plain folder is the project root with no Git meaning of its own, even
	// when that root is a checkout.
	const offersGit =
		kind === 'linked' || (kind === 'general' && input.isGitProject);
	// A bare or missing worktree has no directory to open, copy, or reveal.
	const unavailable =
		offersGit &&
		(worktree === undefined || worktree.isBare || worktree.isPrunable);
	const busy = isDeleting;
	const entries: FolderMenuEntry[] = [];

	if (offersGit) {
		entries.push(
			{
				id: 'commit-and-push',
				label: 'Commit & push with AI…',
				disabled: busy || unavailable || !!worktree?.errorMessage,
			},
			SEPARATOR,
			{
				id: 'pull',
				label: isPulling ? 'Pulling from origin…' : 'Pull from origin',
				disabled:
					busy ||
					isPulling ||
					unavailable ||
					worktree?.isDetached === true ||
					!worktree?.branch ||
					!!worktree?.errorMessage,
			},
		);
	}
	// A linked folder is named by its worktree's branch and has no name of its
	// own to change; General's is fixed.
	if (kind === 'plain')
		entries.push({ id: 'rename-folder', label: 'Rename folder', disabled: busy });
	if (kind === 'linked') {
		// The checkout at the project root and the main worktree are never a
		// linked folder's; the rule stays in case a listing says otherwise.
		const cannotMoveOrRemove =
			worktree === undefined ||
			worktree.isCurrent ||
			worktree.isMain ||
			worktree.isBare;
		entries.push(
			{
				id: 'rename-worktree',
				label: 'Rename worktree',
				disabled: busy || cannotMoveOrRemove || worktree?.isPrunable === true,
			},
			{
				id: 'delete-worktree',
				label: 'Delete worktree',
				danger: true,
				disabled: busy || cannotMoveOrRemove,
			},
		);
	}
	if (kind === 'plain')
		entries.push({
			id: 'delete-folder',
			label: 'Delete folder',
			danger: true,
			disabled: busy,
		});
	if (entries.length > 0) entries.push(SEPARATOR);
	entries.push({
		id: 'copy-path',
		label: 'Copy path',
		disabled: busy || unavailable,
	});
	if (offersGit)
		entries.push({
			id: 'copy-relative-path',
			label: 'Copy relative path',
			disabled: busy || unavailable,
		});
	entries.push(SEPARATOR, {
		id: 'open-shell',
		label: 'Open shell in folder',
		disabled: busy || unavailable,
	});
	if (input.canReveal)
		entries.push({
			id: 'reveal',
			label: 'Reveal in OS',
			disabled: busy || unavailable,
		});
	return entries;
}

/** The labels a menu offers, in order, for reading a menu at a glance. */
export function folderMenuLabels(entries: readonly FolderMenuEntry[]): string[] {
	return entries.flatMap((entry) =>
		entry.separator === true ? [] : [entry.label],
	);
}
