/**
 * Which folder workspaces a window holds, and how they are found.
 *
 * A project is presented by one workspace per folder: each owns one panel
 * layout and is exactly one folder scope, so its Files pane, its new-terminal
 * action, and its panel area cannot disagree about which folder they mean.
 * Only the selected folder's workspace is on screen; the others keep their
 * terminals running behind it, as a background project's workspace does.
 *
 * Everything here is a pure function of the workspace projection and of what
 * this device has selected. Nothing decides where a panel belongs: the server
 * does, and this only reads it.
 */

import type {
	ServerWorkspaceFolder,
	ServerWorkspacePanel,
	ServerWorkspaceProject,
} from '../shared/serverWorkspaceReconciliation.ts';
import { resolveSelectedFolderId } from './folderTreeModel.ts';
import type { WorkspaceInventoryEntry } from './workspaceInventory.ts';

type FolderMap = Readonly<Record<string, ServerWorkspaceFolder>>;

/** The folder a project is given while no projection describes it yet. Its
 * workspace is replaced by the real General folder's once one arrives. */
export const UNPROJECTED_FOLDER_ID = 'general';

/** One workspace's identity. `/` is in neither id's alphabet, so two different
 * pairs cannot produce the same key. */
export function folderWorkspaceKey(
	projectId: string,
	folderId: string,
): string {
	return `${projectId}/${folderId}`;
}

export function unprojectedGeneralFolder(
	projectId: string,
): ServerWorkspaceFolder {
	return {
		id: UNPROJECTED_FOLDER_ID,
		projectId,
		name: 'General',
		kind: 'general',
		panelIds: [],
	};
}

/** The project's folders in order, skipping any the projection does not hold. */
export function orderedProjectFolders(
	project: Pick<ServerWorkspaceProject, 'folderIds'> | undefined,
	folders: FolderMap,
): ServerWorkspaceFolder[] {
	return (project?.folderIds ?? [])
		.map((folderId) => folders[folderId])
		.filter((folder): folder is ServerWorkspaceFolder => folder !== undefined);
}

export type FolderMountInput = {
	projectId: string;
	/** Undefined while the projection does not describe the project. */
	project: Pick<ServerWorkspaceProject, 'folderIds'> | undefined;
	folders: FolderMap;
	/** What this device remembers showing; resolved against what exists. */
	rememberedFolderId: string | undefined;
	/** Folder ids this window already holds a workspace for. */
	mounted: ReadonlySet<string>;
	/** Whether a mounted workspace still shows a panel only it knows about,
	 * such as a file opened on this device. */
	holdsLocalPanels?: (folderId: string) => boolean;
};

/**
 * The folders that get a workspace, in folder order.
 *
 * A repository can have dozens of worktrees, so an empty folder nobody is
 * looking at gets none. A folder is mounted while it is selected or holds a
 * panel; one already mounted also stays while it still shows a panel of its
 * own, so deselecting a folder never discards a file left open in it.
 */
export function foldersToMount(
	input: FolderMountInput,
): ServerWorkspaceFolder[] {
	if (input.project === undefined)
		return [unprojectedGeneralFolder(input.projectId)];
	const selectedFolderId = resolveSelectedFolderId(
		input.project,
		input.folders,
		input.rememberedFolderId,
	);
	return orderedProjectFolders(input.project, input.folders).filter(
		(folder) =>
			folder.id === selectedFolderId ||
			folder.panelIds.length > 0 ||
			(input.mounted.has(folder.id) &&
				input.holdsLocalPanels?.(folder.id) === true),
	);
}

/** The folder whose workspace answers a project-level command, such as the
 * new-terminal shortcut: the one this device has selected. */
export function commandFolderId(
	project: Pick<ServerWorkspaceProject, 'folderIds'> | undefined,
	folders: FolderMap,
	rememberedFolderId: string | undefined,
): string {
	if (project === undefined) return UNPROJECTED_FOLDER_ID;
	return (
		resolveSelectedFolderId(project, folders, rememberedFolderId) ??
		UNPROJECTED_FOLDER_ID
	);
}

/** Where the projection places a terminal session. */
export function folderOfSession(
	panels: Readonly<Record<string, ServerWorkspacePanel>>,
	sessionId: string,
): ServerWorkspacePanel | undefined {
	for (const panel of Object.values(panels))
		if (panel.type === 'terminal' && panel.sessionId === sessionId)
			return panel;
	return undefined;
}

/**
 * The key under which a device remembers its active tab.
 *
 * The General folder keeps the project's own key, so what a device remembered
 * before a project had folders still restores. Every other folder remembers
 * separately: each has its own layout, and so its own tab in front.
 */
export function activeSessionMemoryKey(
	projectId: string,
	folder: Pick<ServerWorkspaceFolder, 'id' | 'kind'>,
): string {
	return folder.kind === 'general'
		? projectId
		: folderWorkspaceKey(projectId, folder.id);
}

/**
 * One project's inventory from its folders' inventories.
 *
 * The dashboard, the switcher, and the activity badges read a project as one
 * list, whichever folders its panels are in. Each folder has a panel in front
 * of its own layout; only the selected folder's is in front of the project, so
 * the others give that mark up here.
 */
export function mergeFolderInventories(
	folderIds: readonly string[],
	inventoryOfFolder: (
		folderId: string,
	) => readonly WorkspaceInventoryEntry[] | undefined,
	selectedFolderId: string | undefined,
): WorkspaceInventoryEntry[] {
	const merged: WorkspaceInventoryEntry[] = [];
	for (const folderId of folderIds) {
		for (const entry of inventoryOfFolder(folderId) ?? []) {
			if (folderId === selectedFolderId || entry.isActivePanel !== true) {
				merged.push(
					entry.folderId === folderId ? entry : { ...entry, folderId },
				);
				continue;
			}
			const { isActivePanel: _behindAnotherFolder, ...rest } = entry;
			void _behindAnotherFolder;
			merged.push({ ...rest, folderId });
		}
	}
	return merged;
}

/** What each folder's workspace has published, by project and then folder. */
export type FolderInventories = Readonly<
	Record<string, Readonly<Record<string, WorkspaceInventoryEntry[]>>>
>;

/**
 * Record what one folder's workspace published. An empty list is a workspace
 * with nothing to show, or one that has unmounted, and leaves no entry behind.
 * Returns the same object when nothing changed.
 */
export function withFolderInventory(
	current: FolderInventories,
	projectId: string,
	folderId: string,
	entries: WorkspaceInventoryEntry[],
): FolderInventories {
	const ofProject = current[projectId];
	if (entries.length > 0)
		return { ...current, [projectId]: { ...ofProject, [folderId]: entries } };
	if (ofProject === undefined || !(folderId in ofProject)) return current;
	const { [folderId]: _removed, ...remaining } = ofProject;
	void _removed;
	if (Object.keys(remaining).length > 0)
		return { ...current, [projectId]: remaining };
	const { [projectId]: _emptied, ...others } = current;
	void _emptied;
	return others;
}

/**
 * Every project's inventory, each merged from its folders in folder order.
 *
 * `folderOrder` is the project's folders as the projection lists them; a
 * project it does not describe is merged in the order its workspaces
 * published. A project with nothing to show has no entry.
 *
 * The folder a device shows when it remembers none is General, which
 * `generalFolderId` names; a project it does not name falls back to the first
 * folder listed.
 */
export function mergeProjectInventories(
	inventories: FolderInventories,
	folderOrder: (projectId: string) => readonly string[] | undefined,
	rememberedFolderId: (projectId: string) => string | undefined,
	generalFolderId: (projectId: string) => string | undefined = () => undefined,
): Record<string, WorkspaceInventoryEntry[]> {
	const merged: Record<string, WorkspaceInventoryEntry[]> = {};
	for (const [projectId, byFolder] of Object.entries(inventories)) {
		const folderIds = folderOrder(projectId) ?? Object.keys(byFolder);
		const remembered = rememberedFolderId(projectId);
		const entries = mergeFolderInventories(
			folderIds,
			(folderId) => byFolder[folderId],
			remembered !== undefined && folderIds.includes(remembered)
				? remembered
				: (generalFolderId(projectId) ?? folderIds[0]),
		);
		if (entries.length > 0) merged[projectId] = entries;
	}
	return merged;
}

/** The folder an inventory places a panel in. A file opened on this device is
 * in no projection, so the inventory is the only thing that knows. */
export function folderIdOfInventoryPanel(
	entries: readonly WorkspaceInventoryEntry[] | undefined,
	panelId: string,
): string | undefined {
	return entries?.find((entry) => entry.panelId === panelId)?.folderId;
}

/**
 * The workspaces a window holds, by project and folder.
 *
 * A terminal is looked up through the folder the projection places it in; a
 * project-level command through the folder this device has selected. Neither
 * lookup is the registry's to decide, so it only stores and finds.
 */
export class FolderWorkspaceRegistry<Handle> {
	private readonly byProject = new Map<string, Map<string, Handle>>();

	/** Record a workspace, or forget it when it has unmounted. */
	set(projectId: string, folderId: string, handle: Handle | null): void {
		const folders = this.byProject.get(projectId);
		if (handle === null) {
			folders?.delete(folderId);
			if (folders?.size === 0) this.byProject.delete(projectId);
			return;
		}
		if (folders === undefined)
			this.byProject.set(projectId, new Map([[folderId, handle]]));
		else folders.set(folderId, handle);
	}

	get(projectId: string, folderId: string | undefined): Handle | undefined {
		if (folderId === undefined) return undefined;
		return this.byProject.get(projectId)?.get(folderId);
	}

	has(projectId: string, folderId: string): boolean {
		return this.byProject.get(projectId)?.has(folderId) === true;
	}

	/** Every workspace of one project, in the order they were recorded. */
	ofProject(projectId: string): Handle[] {
		return [...(this.byProject.get(projectId)?.values() ?? [])];
	}

	all(): Handle[] {
		return [...this.byProject.values()].flatMap((folders) => [
			...folders.values(),
		]);
	}
}
