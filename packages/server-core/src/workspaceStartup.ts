import { ProjectEnvironmentRouteError } from './projectEnvironment/index.js';
import {
	THIS_SERVER_ENVIRONMENT_ID,
	type WorkspaceProject,
	type WorkspaceState,
	type WorkspaceStore,
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

/** How long a remote project's environment may still be connecting. */
export const REMOTE_TERMINAL_SEED_DEADLINE_MS = 60_000;

const RETRYABLE_TERMINAL_SEED_CODES = new Set([
	'environment-unavailable',
	'provider-unavailable',
	'provider-operation-failed',
	'operation-timeout',
	'spawn_failed',
]);

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
	/** Overridden by tests so a retrying seed does not hold the suite open. */
	readonly remoteSeedDeadlineMs?: number;
	readonly onSeedFailure?: (message: string) => void;
}

const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;

export function isHostFilesystemProject(project: WorkspaceProject): boolean {
	return project.projectEnvironmentId === THIS_SERVER_ENVIRONMENT_ID;
}

export function isRetryableTerminalSeedError(error: unknown): boolean {
	let current: unknown = error;
	for (let i = 0; i < 8 && current !== undefined && current !== null; i += 1) {
		if (current instanceof ProjectEnvironmentRouteError && current.retryable)
			return true;
		if (
			typeof current === 'object' &&
			current !== null &&
			'code' in current &&
			typeof (current as { code: unknown }).code === 'string' &&
			RETRYABLE_TERMINAL_SEED_CODES.has((current as { code: string }).code)
		)
			return true;
		current = current instanceof Error ? current.cause : undefined;
	}
	return false;
}

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
 * Returns once every host-filesystem project has a live terminal. A remote
 * project's environment may still be connecting, so its seed is left running in
 * the background rather than holding the workspace closed behind a handshake.
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
		if (isHostFilesystemProject(project)) {
			await options.createTerminal({
				projectId: project.id,
				cwd: project.root,
				cols: DEFAULT_COLS,
				rows: DEFAULT_ROWS,
			});
			continue;
		}
		// A remote environment can still be connecting. The workspace is not held
		// closed behind that handshake; the project's tab spins until its
		// replacement session is published.
		void seedRemoteProjectTerminal(project, options);
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

async function seedRemoteProjectTerminal(
	project: WorkspaceProject,
	options: WorkspaceStartupRestoreOptions,
): Promise<void> {
	const deadline =
		Date.now() +
		(options.remoteSeedDeadlineMs ?? REMOTE_TERMINAL_SEED_DEADLINE_MS);
	let delayMs = 250;
	while (Date.now() < deadline) {
		if (projectHasTerminalPanel(options.workspace.state, project.id)) return;
		try {
			await options.createTerminal({
				projectId: project.id,
				cwd: project.root,
				cols: DEFAULT_COLS,
				rows: DEFAULT_ROWS,
			});
			return;
		} catch (error: unknown) {
			if (
				!isRetryableTerminalSeedError(error) ||
				Date.now() + delayMs >= deadline
			) {
				options.onSeedFailure?.(
					error instanceof Error
						? error.message.replace(/[\r\n]/gu, ' ').slice(0, 300)
						: 'remote terminal seed failed',
				);
				return;
			}
			await new Promise((resolve) => setTimeout(resolve, delayMs));
			delayMs = Math.min(delayMs * 2, 2_000);
		}
	}
}
