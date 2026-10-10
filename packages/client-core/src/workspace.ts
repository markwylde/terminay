import {
	parseWorkspaceDeltaDto,
	parseWorkspaceRecordsDeltaDto,
	WORKSPACE_RECORDS_DELTA_VERSION,
	type WorkspaceRecordsDeltaDto,
	workspaceDeltaVersionOf,
	parseWorkspaceSnapshotDto,
	type JsonValue,
	type ProtocolId,
	type WorkspaceDeltaDto,
	type WorkspaceSnapshotDto,
} from '@terminay/protocol';
import type { TerminayClient } from './client.js';
import { type ClientCommandResult, ClientError } from './types.js';

export interface WorkspaceQueryOptions {
	readonly signal?: AbortSignal;
	readonly deadlineMs?: number;
}
export interface WorkspaceCommandOptions extends WorkspaceQueryOptions {
	readonly commandId?: ProtocolId;
	readonly expectedRevision?: number;
}
export type {
	WorkspaceChangeRecordDto,
	WorkspaceDeltaDto,
	WorkspaceRecordsDeltaDto,
	WorkspaceSnapshotDto,
} from '@terminay/protocol';
export interface ProjectMoveRequest {
	readonly projectId: string;
	readonly targetViewId: string;
	readonly index?: number;
}
export interface ProjectActivationRequest {
	readonly projectId: string;
}
export interface ProjectMoveResult {
	readonly projectId: string;
	readonly revision: number;
	readonly cursor: string;
}
export interface PanelActivationRequest {
	readonly projectId: string;
	readonly panelId: string;
}
export interface PanelReorderRequest {
	readonly projectId: string;
	/** The folder whose panels are reordered. Absent means the one folder that
	 * holds every listed panel. */
	readonly folderId?: string;
	readonly panelIds: readonly string[];
}
export interface PanelSplitRequest {
	readonly projectId: string;
	readonly panelId: string;
	readonly direction: 'horizontal' | 'vertical';
	readonly weight?: number;
}
/** Longest terminal note a server accepts, in UTF-16 code units. */
export const MAX_PANEL_NOTE_CHARS = 1200;

export interface PanelUpdateRequest {
	readonly panelId: string;
	readonly patch: Readonly<{
		title?: string;
		emoji?: string;
		color?: string;
		inheritsProjectColor?: boolean;
		activityIndicatorsEnabled?: boolean;
		presentation?: 'file-viewer' | 'documentation';
		/** A terminal's note; `null` removes it. */
		note?: string | null;
	}>;
}
export interface ProjectCreateRequest {
	readonly projectId: string;
	readonly viewId: string;
	/** Absent means the server's default project folder. */
	readonly root?: string;
	/** Absent means the server assigns the next unique default name. */
	readonly name?: string;
	readonly color?: string;
	readonly icon?: string;
	readonly sidebar?: ProjectSidebarState;
}
export interface ProjectSidebarState {
	readonly fileExplorerWidth: number;
	readonly isFileExplorerOpen: boolean;
	readonly isExplorerPaneCollapsed: boolean;
	readonly isAgentsPaneCollapsed: boolean;
	readonly isGitPaneCollapsed: boolean;
	readonly isDocumentationPaneCollapsed: boolean;
	readonly expandedAgentEntryIds: readonly string[];
	readonly expandedDocumentationFolderIds: readonly string[];
	readonly sidebarAgentsHeight: number;
	readonly sidebarExplorerHeight: number;
	readonly sidebarGitHeight: number;
	readonly sidebarDocumentationHeight: number;
	readonly sidebarPanelOrder: readonly ('explorer' | 'agents' | 'git' | 'documentation')[];
}
export interface ProjectSidebarUpdateRequest {
	readonly projectId: string;
	readonly sidebar: Partial<ProjectSidebarState>;
}
export interface PanelCreateRequest {
	readonly panel: Readonly<{
		id: string;
		projectId: string;
		/** Absent means the project's General folder. */
		folderId?: string;
		type: 'file' | 'folder';
		path: string;
		createdAt: number;
		title?: string;
		presentation?: 'file-viewer' | 'documentation';
	}>;
}
export interface PanelMoveRequest {
	readonly panelId: string;
	readonly targetProjectId: string;
	readonly index?: number;
}
/** Moves a panel between folders of one project. Unlike a move between
 * projects it changes no terminal identity. */
export interface PanelFolderMoveRequest {
	readonly panelId: string;
	readonly folderId: string;
	readonly index?: number;
}
export interface FolderCreateRequest {
	readonly projectId: string;
	readonly name: string;
}
export interface FolderRenameRequest {
	readonly folderId: string;
	readonly name: string;
}
export interface FolderReorderRequest {
	readonly projectId: string;
	/** Every folder of the project, each once, in the order asked for. */
	readonly folderIds: readonly string[];
}
export interface WorkspaceViewCreateRequest {
	readonly viewId: string;
	readonly name: string;
}
export interface WorkspaceViewCommandResult {
	readonly revision: number;
	readonly cursor: string;
}
export interface ProjectRootUpdateRequest {
	readonly projectId: string;
	readonly root: string;
	readonly expectedRevision?: number;
}
export interface ProjectRootUpdateResult extends WorkspaceViewCommandResult {
	readonly projectId: string;
	readonly root: string;
}
export interface ProjectPresentationUpdateRequest {
	readonly projectId: string;
	readonly name: string;
	readonly root: string;
	readonly color: string;
	readonly icon: string;
}
export interface ProjectShellProfileUpdateRequest {
	readonly projectId: string;
	readonly profileId?: string;
}

/** Feature-owned workspace facade over the transport-neutral client. It keeps
 * renderer components from inventing operation names or passing titles as
 * authority while the compatibility renderer migrates incrementally. */
export class WorkspaceClient {
	constructor(private readonly client: TerminayClient) {}

	async snapshot(
		options: WorkspaceQueryOptions = {},
	): Promise<WorkspaceSnapshotDto> {
		const response = await this.client.query<JsonValue>(
			'workspace.snapshot',
			{},
			options,
		);
		return asSnapshot(response.result);
	}

	async delta(
		revision: number,
		cursor: string,
		options: WorkspaceQueryOptions = {},
	): Promise<WorkspaceDeltaDto | WorkspaceRecordsDeltaDto> {
		// A legacy polling projection may have retained an arbitrary cursor string.
		// The protocol only accepts the canonical cursor for the requested server
		// revision, so reject that compatibility shape before it can generate a
		// raw delta request against the connection-owned workspace authority.
		if (
			!Number.isSafeInteger(revision) ||
			revision < 0 ||
			cursor !== String(revision)
		)
			throw new TypeError('workspace delta cursor is invalid');
		const response = await this.client.query<JsonValue>(
			'workspace.delta',
			{ revision, cursor },
			options,
		);
		const expected = { serverId: readDeltaServerId(response.result), revision, cursor };
		// A server that negotiated change records answers with them (ADR-0059);
		// any other answers with the state the delta leads to.
		return workspaceDeltaVersionOf(response.result) === WORKSPACE_RECORDS_DELTA_VERSION
			? parseWorkspaceRecordsDeltaDto(response.result, expected)
			: parseWorkspaceDeltaDto(response.result, expected);
	}

	/**
	 * Optional persisted default identity. Live project-tab and terminal
	 * selection is client-local and must not be issued from presentation
	 * chrome; keep this named operation so callers cannot construct a raw
	 * `workspace.command` envelope.
	 */
	async activatePanel(
		request: PanelActivationRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (!isBoundedId(request.projectId) || !isBoundedId(request.panelId))
			throw new TypeError('panel activation ids are invalid');
		await this.client.command(
			'workspace.command',
			{
				command: {
					type: 'panel.activate',
					projectId: request.projectId,
					panelId: request.panelId,
				},
			},
			options,
		);
	}

	async reorderPanels(
		request: PanelReorderRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (
			!isBoundedId(request.projectId) ||
			request.panelIds.length === 0 ||
			request.panelIds.some((panelId) => !isBoundedId(panelId)) ||
			new Set(request.panelIds).size !== request.panelIds.length ||
			(request.folderId !== undefined && !isBoundedId(request.folderId))
		)
			throw new TypeError('panel reorder ids are invalid');
		await this.client.command(
			'workspace.command',
			{
				command: {
					type: 'panel.reorder',
					projectId: request.projectId,
					...(request.folderId === undefined
						? {}
						: { folderId: request.folderId }),
					panelIds: [...request.panelIds],
				},
			},
			options,
		);
	}

	async splitPanel(
		request: PanelSplitRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (!isBoundedId(request.projectId) || !isBoundedId(request.panelId) ||
			(request.direction !== 'horizontal' && request.direction !== 'vertical') ||
			(request.weight !== undefined && (!Number.isFinite(request.weight) || request.weight <= 0 || request.weight >= 1)))
			throw new TypeError('panel split request is invalid');
		await this.client.command('workspace.command', {
			command: {
				type: 'panel.split',
				projectId: request.projectId,
				panelId: request.panelId,
				direction: request.direction,
				...(request.weight === undefined ? {} : { weight: request.weight }),
			},
		}, options);
	}

	async createProject(
		request: ProjectCreateRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (
			!isBoundedId(request.projectId) ||
			!isBoundedId(request.viewId) ||
			(request.root !== undefined && !boundedPath(request.root)) ||
			(request.name !== undefined && !boundedLabel(request.name)) ||
			(request.color !== undefined && !boundedLabel(request.color)) ||
			(request.icon !== undefined &&
				(typeof request.icon !== 'string' ||
					request.icon.length > 128 ||
					request.icon.includes('\0')))
		)
			throw new TypeError('project create request is invalid');
		await this.client.command(
			'workspace.command',
			{ command: { type: 'project.create', ...request } } as unknown as JsonValue,
			options,
		);
	}

	async updateProjectSidebar(
		request: ProjectSidebarUpdateRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (!isBoundedId(request.projectId) || !isProjectSidebarPatch(request.sidebar))
			throw new TypeError('project sidebar update request is invalid');
		await this.client.command(
			'workspace.command',
			{ command: { type: 'project.sidebar.update', ...request } } as unknown as JsonValue,
			options,
		);
	}

	async activateProject(
		request: ProjectActivationRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (!isBoundedId(request.projectId))
			throw new TypeError('project activation id is invalid');
		await this.client.command(
			'workspace.command',
			{ command: { type: 'project.activate', projectId: request.projectId } },
			options,
		);
	}

	async closeProject(
		projectId: string,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (!isBoundedId(projectId))
			throw new TypeError('project close id is invalid');
		await this.client.command(
			'workspace.command',
			{ command: { type: 'project.close', projectId } },
			options,
		);
	}

	async createPanel(
		request: PanelCreateRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		const panel = request.panel;
		if (
			!isBoundedId(panel.id) ||
			!isBoundedId(panel.projectId) ||
			(panel.folderId !== undefined && !isBoundedId(panel.folderId)) ||
			(panel.type !== 'file' && panel.type !== 'folder') ||
			!boundedPath(panel.path) ||
			!Number.isSafeInteger(panel.createdAt) ||
			panel.createdAt < 0 ||
			(panel.title !== undefined && !boundedLabel(panel.title))
		)
			throw new TypeError('panel create request is invalid');
		await this.client.command(
			'workspace.command',
			{ command: { type: 'panel.create', panel } },
			options,
		);
	}

	async movePanel(
		request: PanelMoveRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (
			!isBoundedId(request.panelId) ||
			!isBoundedId(request.targetProjectId) ||
			(request.index !== undefined &&
				(!Number.isSafeInteger(request.index) || request.index < 0))
		)
			throw new TypeError('panel move request is invalid');
		await this.client.command(
			'workspace.command',
			{ command: { type: 'panel.move', ...request } },
			options,
		);
	}

	async movePanelToFolder(
		request: PanelFolderMoveRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (
			!isBoundedId(request.panelId) ||
			!isBoundedId(request.folderId) ||
			(request.index !== undefined &&
				(!Number.isSafeInteger(request.index) || request.index < 0))
		)
			throw new TypeError('panel folder move request is invalid');
		await this.client.command(
			'workspace.command',
			{
				command: {
					type: 'panel.moveToFolder',
					panelId: request.panelId,
					folderId: request.folderId,
					...(request.index === undefined ? {} : { index: request.index }),
				},
			},
			options,
		);
	}

	/** Create a plain folder. The server issues its id; read it from the next
	 * workspace projection. Only the server creates a linked folder. */
	async createFolder(
		request: FolderCreateRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (!isBoundedId(request.projectId) || !boundedFolderName(request.name))
			throw new TypeError('folder create request is invalid');
		await this.client.command(
			'workspace.command',
			{
				command: {
					type: 'folder.create',
					projectId: request.projectId,
					name: request.name,
				},
			},
			options,
		);
	}

	async renameFolder(
		request: FolderRenameRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (!isBoundedId(request.folderId) || !boundedFolderName(request.name))
			throw new TypeError('folder rename request is invalid');
		await this.client.command(
			'workspace.command',
			{
				command: {
					type: 'folder.rename',
					folderId: request.folderId,
					name: request.name,
				},
			},
			options,
		);
	}

	async reorderFolders(
		request: FolderReorderRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (
			!isBoundedId(request.projectId) ||
			request.folderIds.length === 0 ||
			request.folderIds.some((folderId) => !isBoundedId(folderId)) ||
			new Set(request.folderIds).size !== request.folderIds.length
		)
			throw new TypeError('folder reorder ids are invalid');
		await this.client.command(
			'workspace.command',
			{
				command: {
					type: 'folder.reorder',
					projectId: request.projectId,
					folderIds: [...request.folderIds],
				},
			},
			options,
		);
	}

	/** Delete an empty plain folder. The server refuses General, a folder that
	 * still holds panels, and a linked folder. */
	async deleteFolder(
		folderId: string,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (!isBoundedId(folderId))
			throw new TypeError('folder delete id is invalid');
		await this.client.command(
			'workspace.command',
			{ command: { type: 'folder.delete', folderId } },
			options,
		);
	}

	/** Answer a folder's offer to take the terminal that created its worktree. */
	async answerFolderOffer(
		folderId: string,
		answer: 'accept' | 'decline',
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (!isBoundedId(folderId) || (answer !== 'accept' && answer !== 'decline'))
			throw new TypeError('folder offer answer is invalid');
		await this.client.command(
			'workspace.command',
			{ command: { type: `folder.offer.${answer}`, folderId } },
			options,
		);
	}

	async closePanel(
		panelId: string,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (!isBoundedId(panelId)) throw new TypeError('panel close id is invalid');
		await this.client.command(
			'workspace.command',
			{ command: { type: 'panel.close', panelId } },
			options,
		);
	}

	/** Update presentation metadata for one server-owned panel without allowing
	 * a renderer to change its identity, project ownership, or panel type. */
	async updatePanel(
		request: PanelUpdateRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (
			!isBoundedId(request.panelId) ||
			typeof request.patch !== 'object' ||
			request.patch === null ||
			Array.isArray(request.patch)
		)
			throw new TypeError('panel update is invalid');
		const patch: Record<string, JsonValue> = {};
		for (const key of ['title', 'emoji', 'color'] as const) {
			const value = request.patch[key];
			if (value !== undefined) {
				if (
					typeof value !== 'string' ||
					value.length > 512 ||
					value.includes('\0')
				)
					throw new TypeError(`panel ${key} is invalid`);
				patch[key] = value;
			}
		}
		for (const key of [
			'inheritsProjectColor',
			'activityIndicatorsEnabled',
		] as const) {
			const value = request.patch[key];
			if (value !== undefined) {
				if (typeof value !== 'boolean')
					throw new TypeError(`panel ${key} is invalid`);
				patch[key] = value;
			}
		}
		const note = request.patch.note;
		if (note !== undefined) {
			if (
				note !== null &&
				(typeof note !== 'string' ||
					note.length > MAX_PANEL_NOTE_CHARS ||
					note.includes('\0'))
			)
				throw new TypeError('panel note is invalid');
			patch.note = note;
		}
		if (
			request.patch.presentation === 'file-viewer' ||
			request.patch.presentation === 'documentation'
		)
			patch.presentation = request.patch.presentation;

		if (Object.keys(patch).length === 0)
			throw new TypeError('panel update patch is empty');
		await this.client.command(
			'workspace.command',
			{ command: { type: 'panel.update', panelId: request.panelId, patch } },
			options,
		);
	}

	/** Commit a cross-view project move through the authenticated server
	 * operation. The compatibility drag adapter can continue carrying its
	 * visual/terminal payload after this authority mutation succeeds. */
	async moveProject(
		request: ProjectMoveRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<ProjectMoveResult> {
		if (!isBoundedId(request.projectId) || !isBoundedId(request.targetViewId))
			throw new TypeError('project move ids are invalid');
		if (
			request.index !== undefined &&
			(!Number.isSafeInteger(request.index) || request.index < 0)
		)
			throw new TypeError('project move index is invalid');
		const response = await this.client.command<JsonValue>(
			'project.move',
			{
				projectId: request.projectId,
				targetViewId: request.targetViewId,
				...(request.index === undefined ? {} : { index: request.index }),
			},
			options,
		);
		const result = asMoveResult(response.result);
		// A compatibility drag adapter may retain presentation state while this
		// mutation is in flight, but it never gets to choose a project identity.
		// Bind the server acknowledgement to the typed request before handing it
		// back to a renderer so an incompatible response cannot create a second
		// workspace authority.
		if (result.projectId !== request.projectId)
			throw new Error('project move response identity is invalid');
		return result;
	}

	/** Canonically rebind one server-owned project and its file services. */
	async updateProjectRoot(
		request: ProjectRootUpdateRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<ProjectRootUpdateResult> {
		if (
			!isBoundedId(request.projectId) ||
			typeof request.root !== 'string' ||
			request.root.length === 0 ||
			request.root.length > 4096 ||
			request.root.includes('\0')
		)
			throw new TypeError('project root update request is invalid');
		if (
			request.expectedRevision !== undefined &&
			(!Number.isSafeInteger(request.expectedRevision) ||
				request.expectedRevision < 0)
		)
			throw new TypeError('project root expected revision is invalid');
		let response: ClientCommandResult<JsonValue>;
		try {
			response = await this.client.command<JsonValue>(
				'project.root.update',
				{
					projectId: request.projectId,
					root: request.root,
					...(request.expectedRevision === undefined
						? {}
						: { expectedRevision: request.expectedRevision }),
				},
				options,
			);
		} catch (error) {
			if (
				error instanceof ClientError &&
				(error.code === 'not_found' || error.code === 'unavailable')
			) {
				throw new ClientError(
					'incompatible',
					'connected server does not support project root updates',
					{ cause: error },
				);
			}
			throw error;
		}
		const result = response.result;
		if (
			typeof result !== 'object' ||
			result === null ||
			Array.isArray(result) ||
			result.projectId !== request.projectId ||
			typeof result.root !== 'string' ||
			typeof result.revision !== 'number' ||
			!Number.isSafeInteger(result.revision) ||
			typeof result.cursor !== 'string' ||
			result.cursor !== String(result.revision)
		)
			throw new Error('project root update response is invalid');
		return Object.freeze({
			projectId: result.projectId,
			root: result.root,
			revision: result.revision,
			cursor: result.cursor,
		});
	}

	async updateProject(
		request: ProjectPresentationUpdateRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<void> {
		if (
			!isBoundedId(request.projectId) ||
			typeof request.name !== 'string' ||
			request.name.trim().length === 0 ||
			request.name.length > 256
		)
			throw new TypeError('project name is invalid');
		if (
			typeof request.root !== 'string' ||
			request.root.length === 0 ||
			request.root.length > 4096 ||
			request.root.includes('\0')
		)
			throw new TypeError('project root is invalid');
		for (const [name, value] of [
			['color', request.color],
			['icon', request.icon],
		] as const)
			if (
				typeof value !== 'string' ||
				value.length > 128 ||
				value.includes('\0')
			)
				throw new TypeError(`project ${name} is invalid`);
		await this.client.command(
			'workspace.command',
			{
				command: {
					type: 'project.update',
					projectId: request.projectId,
					name: request.name.trim(),
					root: request.root,
					color: request.color,
					icon: request.icon,
				},
			},
			options,
		);
	}

	async setProjectShellProfile(
		request: ProjectShellProfileUpdateRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<WorkspaceViewCommandResult> {
		if (!isBoundedId(request.projectId) || (request.profileId !== undefined && !isBoundedId(request.profileId)))
			throw new TypeError('project shell profile update is invalid');
		const response = await this.client.command<JsonValue>(
			request.profileId === undefined ? 'project.shell-profile.clear' : 'project.shell-profile.set',
			{ projectId: request.projectId, ...(request.profileId === undefined ? {} : { profileId: request.profileId }) },
			options,
		);
		return asWorkspaceViewCommandResult(response.result);
	}

	/** Native window compatibility can create a logical view, but it must not
	 * regain a generic workspace-command capability. */
	async createView(
		request: WorkspaceViewCreateRequest,
		options: WorkspaceCommandOptions = {},
	): Promise<WorkspaceViewCommandResult> {
		if (!isBoundedId(request.viewId) || !isBoundedName(request.name))
			throw new TypeError('workspace view create request is invalid');
		const response = await this.client.command<JsonValue>(
			'workspace.command',
			{
				command: {
					type: 'view.create',
					viewId: request.viewId,
					name: request.name,
				},
			},
			options,
		);
		return asWorkspaceViewCommandResult(response.result);
	}

	/** Closing a logical view is a named server operation for the legacy native
	 * presentation adapter; it deliberately exposes no generic command method. */
	async closeView(
		viewId: string,
		options: WorkspaceCommandOptions = {},
	): Promise<WorkspaceViewCommandResult> {
		if (!isBoundedId(viewId))
			throw new TypeError('workspace view id is invalid');
		const response = await this.client.command<JsonValue>(
			'workspace.command',
			{
				command: { type: 'view.close', viewId },
			},
			options,
		);
		return asWorkspaceViewCommandResult(response.result);
	}
}

function asSnapshot(value: JsonValue | undefined): WorkspaceSnapshotDto {
	return parseWorkspaceSnapshotDto(value);
}

function isProjectSidebarPatch(value: unknown): value is Partial<ProjectSidebarState> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const patch = value as Record<string, unknown>;
	const allowed = new Set([
		'fileExplorerWidth', 'isFileExplorerOpen', 'isExplorerPaneCollapsed',
		'isAgentsPaneCollapsed', 'isGitPaneCollapsed', 'isDocumentationPaneCollapsed',
		'expandedAgentEntryIds', 'expandedDocumentationFolderIds', 'sidebarAgentsHeight',
		'sidebarExplorerHeight', 'sidebarGitHeight', 'sidebarDocumentationHeight',
		'sidebarPanelOrder',
	]);
	if (Object.keys(patch).length === 0 || Object.keys(patch).some((key) => !allowed.has(key))) return false;
	for (const key of ['isFileExplorerOpen', 'isExplorerPaneCollapsed', 'isAgentsPaneCollapsed', 'isGitPaneCollapsed', 'isDocumentationPaneCollapsed']) {
		if (key in patch && typeof patch[key] !== 'boolean') return false;
	}
	for (const key of ['fileExplorerWidth', 'sidebarAgentsHeight', 'sidebarExplorerHeight', 'sidebarGitHeight', 'sidebarDocumentationHeight']) {
		if (key in patch && (!Number.isSafeInteger(patch[key]) || (patch[key] as number) < 30 || (patch[key] as number) > 2_000)) return false;
	}
	for (const key of ['expandedAgentEntryIds', 'expandedDocumentationFolderIds']) {
		if (key in patch && (!Array.isArray(patch[key]) || patch[key].length > 256 || patch[key].some((entry) => typeof entry !== 'string' || entry.length === 0 || entry.length > 4_096 || entry.includes('\0')))) return false;
	}
	if ('sidebarPanelOrder' in patch) {
		const order = patch.sidebarPanelOrder;
		const ids = ['explorer', 'agents', 'git', 'documentation'];
		if (!Array.isArray(order) || order.length !== ids.length || new Set(order).size !== ids.length || ids.some((id) => !order.includes(id))) return false;
	}
	return true;
}

function readDeltaServerId(value: JsonValue | undefined): string {
	if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof value.serverId !== 'string') {
		throw new TypeError('invalid workspace delta');
	}
	return value.serverId;
}

function asMoveResult(value: JsonValue | undefined): ProjectMoveResult {
	if (
		typeof value !== 'object' ||
		value === null ||
		Array.isArray(value) ||
		typeof value.projectId !== 'string' ||
		typeof value.revision !== 'number' ||
		!Number.isSafeInteger(value.revision) ||
		typeof value.cursor !== 'string'
	)
		throw new Error('invalid project move result');
	return value as unknown as ProjectMoveResult;
}

function asWorkspaceViewCommandResult(
	value: JsonValue | undefined,
): WorkspaceViewCommandResult {
	if (
		typeof value !== 'object' ||
		value === null ||
		Array.isArray(value) ||
		typeof value.revision !== 'number' ||
		!Number.isSafeInteger(value.revision) ||
		value.revision < 0 ||
		typeof value.cursor !== 'string' ||
		value.cursor !== String(value.revision)
	)
		throw new Error('invalid workspace view command result');
	return Object.freeze({ revision: value.revision, cursor: value.cursor });
}

function isBoundedId(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
	);
}

function isBoundedName(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.trim().length > 0 &&
		value.length <= 128 &&
		![...value].some((character) => {
			const code = character.codePointAt(0) ?? 0;
			return code < 0x20 || code === 0x7f;
		})
	);
}

function boundedPath(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= 4096 &&
		!value.includes('\0')
	);
}

/** The server stores a folder name of at most 256 characters. */
function boundedFolderName(value: unknown): value is string {
	return boundedLabel(value) && value.length <= 256;
}
function boundedLabel(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.trim().length > 0 &&
		value.length <= 512 &&
		!value.includes('\0')
	);
}
