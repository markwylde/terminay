import {
	createInitialWorkspace,
	type WorkspaceState,
	WorkspaceStore,
} from './workspace.js';
import {
	type WorkspaceStateBackend,
	WorkspaceRepository,
} from './workspaceRepository.js';

export const DEFAULT_WORKSPACE_IDENTITIES = Object.freeze({
	projectId: 'default',
	panelId: 'default:terminal',
	sessionId: 'default',
});

export type WorkspaceHydration =
	| Readonly<{
			state: 'ready';
			viewId: string;
			projectId: string;
			panelId: string;
			sessionId: string;
			projectEnvironmentId: string;
	  }>
	| Readonly<{ state: 'empty' }>;

export function createFreshWorkspaceState(
	serverId: string,
	defaultProjectRoot: string,
	now = Date.now(),
): WorkspaceState {
	const workspace = new WorkspaceStore(createInitialWorkspace(serverId));
	const viewId = workspace.state.viewOrder[0];
	if (viewId === undefined) throw new Error('canonical workspace has no view');
	const apply = (
		commandId: string,
		command: Parameters<WorkspaceStore['apply']>[0]['command'],
	) => {
		const result = workspace.apply({ commandId, command });
		if (!result.ok) throw new Error(result.conflict.message);
	};
	apply('system:default-project', {
		type: 'project.create', projectId: DEFAULT_WORKSPACE_IDENTITIES.projectId,
		viewId, root: defaultProjectRoot, rootOrigin: 'server-default', name: 'Project',
	});
	apply('system:default-terminal-panel', {
		type: 'terminal.createPanel', projectId: DEFAULT_WORKSPACE_IDENTITIES.projectId,
		sessionId: DEFAULT_WORKSPACE_IDENTITIES.sessionId,
		panelId: DEFAULT_WORKSPACE_IDENTITIES.panelId, title: 'Terminal 1',
		cwd: defaultProjectRoot, createdAt: now,
	});
	return workspace.state;
}

export async function openCanonicalWorkspace(options: Readonly<{
	backend: WorkspaceStateBackend;
	serverId: string;
	defaultProjectRoot: string;
	now?: number;
}>): Promise<WorkspaceRepository> {
	const repository = new WorkspaceRepository(options.backend, options.serverId, () =>
		createFreshWorkspaceState(options.serverId, options.defaultProjectRoot, options.now),
	);
	await repository.load();
	return repository;
}

export function resolveWorkspaceHydration(state: WorkspaceState): WorkspaceHydration {
	for (const viewId of state.viewOrder) {
		const view = state.views[viewId];
		const projectId = view?.activeProjectId ?? view?.projectIds[0];
		const project = projectId === undefined ? undefined : state.projects[projectId];
		const panelId = project?.activePanelId ?? project?.panelIds[0];
		const panel = panelId === undefined ? undefined : state.panels[panelId];
		if (view !== undefined && project !== undefined && panel?.type === 'terminal') {
			return { state: 'ready', viewId, projectId: project.id, panelId: panel.id,
				sessionId: panel.sessionId, projectEnvironmentId: project.projectEnvironmentId };
		}
	}
	return { state: 'empty' };
}
