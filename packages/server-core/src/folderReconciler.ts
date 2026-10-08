import { basename, sep } from 'node:path';
import type { ListedWorktree } from './folderRoots.js';
import {
	isAutomationSpace,
	type WorkspaceApplyResult,
	type WorkspaceCommand,
	type WorkspaceFolder,
	type WorkspaceFolderWorktreeLink,
	type WorkspaceState,
} from './workspace.js';

/** What the Git service knows about a project's repository right now. */
export interface ReconcilerWorktreeListing {
	/** Only `ready` and `not-repository` are definite. Anything else is a
	 * failure to find out, and changes nothing. */
	readonly state: string;
	readonly worktrees: readonly ListedWorktree[];
}

/** A worktree that appeared after the project's folders were first reconciled. */
export interface WorktreeAppeared {
	readonly projectId: string;
	readonly folderId: string;
	readonly worktree: WorkspaceFolderWorktreeLink;
	/** The panel whose terminal created the worktree, when one is established. */
	readonly createdByPanelId?: string;
}

export interface FolderReconcilerOptions {
	readonly workspace: () => WorkspaceState;
	/** Commit a command as the host. Every change the reconciler makes is an
	 * ordinary workspace revision. */
	readonly apply: (
		commandId: string,
		command: WorkspaceCommand,
	) => WorkspaceApplyResult;
	/** The Git service's maintained listing. Reading it must not start a timer
	 * or a watcher of its own (ADR-0028). */
	readonly worktrees: (projectId: string) => Promise<ReconcilerWorktreeListing>;
	/** The canonical project root, or null when it cannot be resolved. */
	readonly canonicalRoot: (root: string) => Promise<string | null>;
	/** Which panel's terminal created a worktree that has just appeared. Asked
	 * only for worktrees that turn up after the project was first reconciled. */
	readonly creatorOf?: (appeared: {
		readonly projectId: string;
		readonly worktree: WorkspaceFolderWorktreeLink;
	}) => Promise<string | undefined>;
	readonly onWorktreeAppeared?: (appeared: WorktreeAppeared) => void;
	readonly onError?: (projectId: string, error: unknown) => void;
}

/**
 * Keeps one linked folder per worktree of each project's repository.
 *
 * It holds no watcher and no timer. The host calls `reconcile` when a project
 * is bound and whenever the Git service reports a change for it; the reconciler
 * reads the listing the Git service already maintains and issues the folder
 * commands that bring the project's folders in line.
 */
export class FolderReconciler {
	private readonly running = new Map<string, Promise<void>>();
	private readonly again = new Set<string>();
	/** Projects whose folders have been brought in line at least once. A
	 * worktree found by that first pass was already there, so it is not
	 * announced as having appeared. */
	private readonly settled = new Set<string>();
	/** Projects with a worktree operation of Terminay's own in flight. */
	private readonly suspended = new Map<string, number>();
	/** The worktree ids each project's last pass saw. */
	private readonly known = new Map<string, ReadonlySet<string>>();
	private serial = 0;

	constructor(private readonly options: FolderReconcilerOptions) {}

	/** Bring a project's folders in line with its worktrees. Calls for one
	 * project never overlap; a call that arrives during a pass runs one more
	 * pass after it. */
	reconcile(projectId: string): Promise<void> {
		if (this.suspended.has(projectId)) {
			this.again.add(projectId);
			return Promise.resolve();
		}
		const current = this.running.get(projectId);
		if (current !== undefined) {
			this.again.add(projectId);
			return current;
		}
		const pass = this.loop(projectId).finally(() => {
			this.running.delete(projectId);
		});
		this.running.set(projectId, pass);
		return pass;
	}

	/**
	 * React to a change the Git service reported. Most changes are an edit
	 * inside a worktree the project already has a folder for, and need nothing.
	 * A pass runs only for a change that names no worktree, which is how a
	 * removal or a registry change is reported, and for a worktree no pass has
	 * seen yet, so an idle window does not re-read the listing on every save.
	 */
	onGitChange(change: {
		readonly projectId: string;
		readonly worktreeId: string | null;
	}): void {
		const known = this.known.get(change.projectId);
		if (
			change.worktreeId !== null &&
			known !== undefined &&
			known.has(change.worktreeId)
		)
			return;
		void this.reconcile(change.projectId);
	}

	/** Forget a project that was closed or released. */
	release(projectId: string): void {
		this.known.delete(projectId);
		this.settled.delete(projectId);
		this.again.delete(projectId);
		this.suspended.delete(projectId);
	}

	/**
	 * Hold off passes for a project while Terminay changes a worktree itself.
	 * The registry watch fires in the middle of such an operation; a pass run
	 * then would act on a half-finished state. Call the returned function when
	 * the operation has finished, after any `relink`; a pass that was asked for
	 * in the meantime runs then.
	 */
	suspend(projectId: string): () => void {
		this.suspended.set(projectId, (this.suspended.get(projectId) ?? 0) + 1);
		let resumed = false;
		return () => {
			if (resumed) return;
			resumed = true;
			const remaining = (this.suspended.get(projectId) ?? 1) - 1;
			if (remaining > 0) {
				this.suspended.set(projectId, remaining);
				return;
			}
			this.suspended.delete(projectId);
			if (this.again.has(projectId)) void this.reconcile(projectId);
		};
	}

	/**
	 * Keep a folder linked to a worktree that Terminay itself renamed or moved.
	 * Without this the next pass would see one worktree vanish and another
	 * appear, and would empty the folder into General.
	 */
	relink(
		projectId: string,
		repositoryId: string,
		fromPath: string,
		toPath: string,
	): boolean {
		const folder = this.linkedFolders(projectId).find(
			(candidate) =>
				candidate.worktree?.repositoryId === repositoryId &&
				candidate.worktree.path === fromPath,
		);
		if (folder === undefined) return false;
		return this.apply({
			type: 'folder.link.update',
			folderId: folder.id,
			worktree: { repositoryId, path: toPath },
		}).ok;
	}

	private async loop(projectId: string): Promise<void> {
		do {
			this.again.delete(projectId);
			try {
				await this.pass(projectId);
			} catch (error) {
				this.options.onError?.(projectId, error);
			}
		} while (this.again.has(projectId) && !this.suspended.has(projectId));
	}

	private async pass(projectId: string): Promise<void> {
		const project = this.options.workspace().projects[projectId];
		if (project === undefined || isAutomationSpace(project)) return;
		const listing = await this.options.worktrees(projectId);
		if (listing.state !== 'ready' && listing.state !== 'not-repository')
			return;
		this.known.set(
			projectId,
			new Set(
				listing.worktrees.flatMap((worktree) =>
					worktree.id === undefined ? [] : [worktree.id],
				),
			),
		);
		const root =
			listing.state === 'ready'
				? await this.options.canonicalRoot(project.root)
				: null;
		// Without the project root there is no telling which checkout General
		// stands for, so nothing is decided on this pass.
		if (listing.state === 'ready' && root === null) return;
		const wanted =
			root === null ? [] : worktreesNeedingFolders(listing.worktrees, root);

		// The workspace may have changed while the listing was read.
		if (this.options.workspace().projects[projectId] === undefined) return;
		const linked = this.linkedFolders(projectId);
		const key = (link: WorkspaceFolderWorktreeLink) =>
			`${link.repositoryId}\0${link.path}`;
		const have = new Set(
			linked.flatMap((folder) =>
				folder.worktree === undefined ? [] : [key(folder.worktree)],
			),
		);
		const want = new Set(wanted.map(key));

		for (const folder of linked) {
			if (folder.worktree === undefined || want.has(key(folder.worktree)))
				continue;
			this.removeFolder(projectId, folder.id);
		}
		const announce = this.settled.has(projectId);
		for (const worktree of wanted) {
			if (have.has(key(worktree))) continue;
			const link = { repositoryId: worktree.repositoryId, path: worktree.path };
			const name = basename(worktree.path) || worktree.path;
			const creator = announce
				? await this.options
						.creatorOf?.({ projectId, worktree: link })
						.catch(() => undefined)
				: undefined;
			// A creator that closed or left the project while it was being worked
			// out makes the command invalid; the folder is still wanted.
			const created =
				creator === undefined
					? this.apply({ type: 'folder.create', projectId, name, worktree: link })
					: this.createWithCreator(projectId, name, link, creator);
			if (!created.ok) continue;

			const folderId = created.event.changedIds.find(
				(id) => created.state.folders[id]?.worktree?.path === link.path,
			);
			const createdByPanelId =
				folderId === undefined
					? undefined
					: created.state.folders[folderId]?.createdByPanelId;
			if (announce && folderId !== undefined)
				this.options.onWorktreeAppeared?.({
					projectId,
					folderId,
					worktree: link,
					...(createdByPanelId === undefined ? {} : { createdByPanelId }),
				});
		}
		this.settled.add(projectId);
	}

	private createWithCreator(
		projectId: string,
		name: string,
		worktree: WorkspaceFolderWorktreeLink,
		createdByPanelId: string,
	): WorkspaceApplyResult {
		const withCreator = this.apply({
			type: 'folder.create',
			projectId,
			name,
			worktree,
			createdByPanelId,
		});
		return withCreator.ok
			? withCreator
			: this.apply({ type: 'folder.create', projectId, name, worktree });
	}

	/** Move a folder's panels to General, keeping their order and leaving every
	 * terminal running, then remove the folder. */
	private removeFolder(projectId: string, folderId: string): void {
		const state = this.options.workspace();
		const folder = state.folders[folderId];
		const general = state.projects[projectId]?.folderIds[0];
		if (folder === undefined || general === undefined) return;
		for (const panelId of folder.panelIds)
			if (
				!this.apply({ type: 'panel.moveToFolder', panelId, folderId: general })
					.ok
			)
				return;
		this.apply({ type: 'folder.delete', folderId });
	}

	private linkedFolders(projectId: string): WorkspaceFolder[] {
		const state = this.options.workspace();
		return (state.projects[projectId]?.folderIds ?? [])
			.map((folderId) => state.folders[folderId])
			.filter(
				(folder): folder is WorkspaceFolder => folder?.kind === 'linked',
			);
	}

	private apply(command: WorkspaceCommand): WorkspaceApplyResult {
		this.serial += 1;
		return this.options.apply(`folders:${this.serial}`, command);
	}
}

/**
 * Every worktree that gets its own folder: all of them except the checkout the
 * project root sits in, which General stands for. That is the deepest worktree
 * containing the root, so a project opened on a subdirectory of a checkout, or
 * on a linked worktree, is handled the same way.
 *
 * A worktree Git still registers but whose directory is gone keeps its folder:
 * the registration is still a worktree of the repository, and its folder is
 * the only place it can be deleted from. Nothing can be read or launched in
 * it, because the root resolver fails closed for it. A bare entry has no
 * working tree to stand for and gets no folder.
 */
export function worktreesNeedingFolders(
	worktrees: readonly ListedWorktree[],
	canonicalProjectRoot: string,
): ListedWorktree[] {
	const foldered = worktrees.filter((worktree) => worktree.isBare !== true);
	const contains = (worktree: ListedWorktree) =>
		canonicalProjectRoot === worktree.path ||
		canonicalProjectRoot.startsWith(
			worktree.path.endsWith(sep) ? worktree.path : `${worktree.path}${sep}`,
		);
	// General stands for a checkout that exists.
	const home = foldered
		.filter((worktree) => worktree.isPrunable !== true && contains(worktree))
		.sort((a, b) => b.path.length - a.path.length)[0];
	return foldered.filter((worktree) => worktree !== home);
}
