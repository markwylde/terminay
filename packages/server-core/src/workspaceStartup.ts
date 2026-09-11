import type {
	WorkspaceProject,
	WorkspaceState,
	WorkspaceStore,
} from './workspace.js';
import { resolveWorkspaceHydration } from './workspaceHydration.js';

/**
 * What a restored workspace contains after a restart.
 *
 * A terminal panel describes a process owned by the server process that created
 * it. Restart that process and the panel still persists while the process it
 * names does not, so restoring the panel as-is publishes a tab that can only say
 * it has exited. This discards those panels and puts one live terminal back in
 * every project that lost them.
 *
 * It lives beside the workspace store rather than in a host, because both are
 * server state: a host that decided this would be deciding what a restored
 * workspace contains, and two hosts deciding it separately is how they came to
 * disagree.
 */

export interface WorkspaceStartupTerminalRequest {
	readonly projectId: string;
	readonly cwd: string;
	/** Set only for the first-run seed, which has a session id to honour. */
	readonly sessionId?: string;
	readonly projectRootOrigin?: 'server-default';
	readonly cols: number;
	readonly rows: number;
}

export interface WorkspaceStartupRestoreOptions {
	readonly workspace: WorkspaceStore;
	/** Whether the server already holds live sessions; a hot start reaps nothing. */
	readonly liveSessionCount: () => number;
	/** Whether a session id still names a session this process owns. */
	readonly hasSession: (sessionId: string) => boolean;
	/**
	 * Making the session. The policy above is shared; the act is not — Desktop
	 * wraps it in replay buffers, detachable consumers and renderer bindings that
	 * a standalone server has no equivalent for.
	 */
	readonly createTerminal: (
		request: WorkspaceStartupTerminalRequest,
	) => Promise<unknown>;
	/**
	 * Projects whose root could not be bound and which therefore get no
	 * replacement terminal. A missing root is a recoverable project condition to
	 * repair, not a reason to fail startup.
	 */
	readonly unavailableProjectIds?: ReadonlySet<string>;
	/**
	 * Whether this data root was initialized by this start. A first run has
	 * nothing stale to reap and one committed terminal panel whose session must
	 * exist before the workspace is shown; a restart is the reverse.
	 */
	readonly firstRun: boolean;
}

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;

/**
 * Restored projects in presentation order: the selected view's active project
 * first, then the rest of its membership, then anything unattached. The active
 * project is seeded first so the tab a client shows first is ready before its
 * siblings are.
 */
export function restoredProjectsInPresentationOrder(
	state: WorkspaceState,
): readonly WorkspaceProject[] {
	const seen = new Set<string>();
	const projects: WorkspaceProject[] = [];
	const remember = (projectId: string | undefined) => {
		if (projectId === undefined || seen.has(projectId)) return;
		const project = state.projects[projectId];
		if (project === undefined) return;
		seen.add(project.id);
		projects.push(project);
	};
	for (const viewId of state.viewOrder) {
		const view = state.views[viewId];
		remember(view?.activeProjectId);
		for (const projectId of view?.projectIds ?? []) remember(projectId);
	}
	for (const project of Object.values(state.projects)) remember(project.id);
	return projects;
}

function projectHasTerminalPanel(
	state: WorkspaceState,
	projectId: string,
): boolean {
	const project = state.projects[projectId];
	if (project === undefined) return false;
	return project.panelIds.some(
		(panelId) => state.panels[panelId]?.type === 'terminal',
	);
}

/**
 * Reap the terminals of the previous process and seed replacements.
 *
 * Returns once every project has a live terminal. Every project executes on
 * this server, so there is nothing to wait on before a session can be made.
 */
export async function restoreWorkspaceOnStartup(
	options: WorkspaceStartupRestoreOptions,
): Promise<void> {
	const { workspace } = options;
	if (options.firstRun) {
		await seedInitializedWorkspace(options);
		return;
	}

	// A server that already holds sessions is not restarting into this state; it
	// is being asked to start twice.
	if (options.liveSessionCount() === 0) workspace.discardStaleTerminalState();

	const unavailable = options.unavailableProjectIds ?? new Set<string>();
	for (const project of restoredProjectsInPresentationOrder(workspace.state)) {
		if (unavailable.has(project.id)) continue;
		if (projectHasTerminalPanel(workspace.state, project.id)) continue;
		await options.createTerminal({
			projectId: project.id,
			cwd: project.root,
			cols: DEFAULT_COLS,
			rows: DEFAULT_ROWS,
		});
	}
}

/**
 * A newly initialized workspace already names the one terminal it expects, so
 * the panel exists and only its session is missing.
 */
async function seedInitializedWorkspace(
	options: WorkspaceStartupRestoreOptions,
): Promise<void> {
	const { workspace } = options;
	const hydration = resolveWorkspaceHydration(workspace.state);
	if (hydration.state !== 'ready')
		throw new Error('fresh canonical workspace has no active terminal');
	if (options.hasSession(hydration.sessionId)) return;
	const project = workspace.state.projects[hydration.projectId];
	if (project === undefined)
		throw new Error('fresh canonical workspace project is unavailable');
	try {
		await options.createTerminal({
			projectId: hydration.projectId,
			sessionId: hydration.sessionId,
			cwd: project.root,
			projectRootOrigin: 'server-default',
			cols: DEFAULT_COLS,
			rows: DEFAULT_ROWS,
		});
	} catch (error) {
		workspace.markInterruptedSessions();
		throw error;
	}
}

