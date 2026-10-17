import type { TerminalService } from '../terminalService/service.js';
import type { PtyProcess } from '../terminalService/types.js';
import type {
	TerminalPanel,
	TerminalSession,
	WorkspaceState,
	WorkspaceStore,
} from '../workspace.js';
import type {
	HeldSessionSummary,
	SessionHolderPtyFactory,
} from './factory.js';

/**
 * Restart recovery when a session holder keeps PTYs running (ADR-0035).
 *
 * Every persisted terminal session ends up in exactly one of three states:
 * adopted and running under its original identity, ended with the output it
 * left behind, or ended with nothing to show. Its panel is kept in all three.
 * A shell still running that the holder has and the workspace does not is
 * recovered into a project of its own, so nothing runs that no panel can
 * reach and no shell is ended that someone may still need (ADR-0071).
 */

export interface ReattachHeldSessionsOptions {
	readonly serverId: string;
	readonly workspace: WorkspaceStore;
	readonly terminal: TerminalService;
	readonly holder: SessionHolderPtyFactory;
	readonly now?: () => number;
	/**
	 * The workspace was initialized by this start. Its one terminal session is
	 * about to be created, not recovered, so nothing persisted is reconciled;
	 * anything a holder still has belongs to a workspace that no longer exists
	 * and is ended.
	 */
	readonly freshWorkspace?: boolean;
}

export interface ReattachHeldSessionsResult {
	/** Sessions still running, now supervised by this server. */
	readonly adopted: readonly string[];
	/** Sessions that are no longer running; their panels show what was saved. */
	readonly ended: readonly string[];
	/** Held sessions the workspace did not know and that had already ended,
	 * or belonged to another server; they were ended. */
	readonly orphaned: readonly string[];
	/** Held shells the workspace did not know that were still running: each
	 * now has a panel in a "Recovered terminals" project, and was adopted. */
	readonly recovered: readonly string[];
}

/** The name of the project a restart gives shells it found and could not place. */
export const RECOVERED_TERMINALS_PROJECT_NAME = 'Recovered terminals';

const FALLBACK_COLS = 80;
const FALLBACK_ROWS = 24;

export async function reattachHeldSessions(
	options: ReattachHeldSessionsOptions,
): Promise<ReattachHeldSessionsResult> {
	const { workspace, terminal, holder } = options;
	const now = options.now ?? (() => Date.now());
	const held = new Map(
		(await holder.start()).map((session) => [session.sessionId, session]),
	);
	const persisted = workspace.state.terminalSessions;
	const orphaned: string[] = [];
	const strays: HeldSessionSummary[] = [];
	for (const [sessionId, record] of held) {
		const session = persisted[sessionId];
		// A fresh workspace's one session is about to be created, not recovered.
		if (options.freshWorkspace === true && session !== undefined) {
			orphaned.push(sessionId);
			held.delete(sessionId);
			await holder.end(sessionId);
			continue;
		}
		if (session !== undefined && session.serverId === options.serverId)
			continue;
		// A shell still running that nothing in the workspace names is kept and
		// given a place below. One that has ended, or that a workspace names
		// for another server, has nothing to recover.
		if (session === undefined && record.exit === undefined) {
			strays.push(record);
			continue;
		}
		orphaned.push(sessionId);
		held.delete(sessionId);
		await holder.end(sessionId);
	}
	const recovered = recoverStrays(options, strays, now());
	for (const record of strays)
		if (!recovered.includes(record.sessionId)) {
			orphaned.push(record.sessionId);
			held.delete(record.sessionId);
			await holder.end(record.sessionId);
		}
	if (options.freshWorkspace === true) {
		// Nothing persisted is reconciled; only what was recovered is adopted.
		const adopted: string[] = [];
		const ended: string[] = [];
		for (const sessionId of recovered) {
			const session = workspace.state.terminalSessions[sessionId];
			if (session === undefined) continue;
			try {
				const taken = await holder.adopt(sessionId);
				terminal.adoptSession({
					identity: identityOf(session),
					cwd: taken.record.cwd,
					createdAt: session.createdAt,
					cols: taken.record.cols,
					rows: taken.record.rows,
					process: taken.process,
					outputPosition: taken.from,
				});
				adopted.push(sessionId);
			} catch {
				ended.push(sessionId);
			}
		}
		holder.pruneTails(new Set());
		return { adopted, ended, orphaned, recovered };
	}
	const state = workspace.state;
	const panels = terminalPanelsBySession(state);

	// The workspace is reconciled before anything is adopted, so the exit of a
	// held session that has already ended is recorded by the ordinary exit path
	// when its retained output is replayed.
	const reattachable = new Set<string>();
	const exitedWhileAway = new Map<string, number | undefined>();
	const tails = new Map<string, ReturnType<typeof holder.readTail>>();
	for (const session of Object.values(state.terminalSessions)) {
		if (held.has(session.id)) {
			if (session.status !== 'exited') reattachable.add(session.id);
			continue;
		}
		const tail = holder.readTail(session.id);
		tails.set(session.id, tail);
		if (session.status !== 'exited' && tail?.exit?.exitCode != null)
			exitedWhileAway.set(session.id, tail.exit.exitCode);
	}
	workspace.reconcileHeldTerminalSessions(
		reattachable,
		exitedWhileAway,
		now(),
	);

	const adopted: string[] = [];
	const ended: string[] = [];
	for (const session of Object.values(workspace.state.terminalSessions)) {
		if (terminal.getSession(session.id) !== undefined) continue;
		const panel = panels.get(session.id);
		const record = held.get(session.id);
		if (record !== undefined) {
			try {
				const taken = await holder.adopt(session.id);
				terminal.adoptSession({
					identity: identityOf(session),
					cwd: panel?.cwd ?? taken.record.cwd,
					createdAt: session.createdAt,
					cols: taken.record.cols,
					rows: taken.record.rows,
					...(session.launch === undefined ? {} : { launch: session.launch }),
					// A process that has already ended has no pid worth binding
					// anything to: the number may belong to something else by now.
					process:
						taken.record.exit === undefined
							? taken.process
							: withoutPid(taken.process),
					outputPosition: taken.from,
				});
				(taken.record.exit === undefined ? adopted : ended).push(session.id);
				continue;
			} catch {
				// The holder went away between listing and adopting. What is left
				// is whatever it saved on the way out.
				tails.set(session.id, holder.readTail(session.id));
			}
		}
		const tail = tails.get(session.id);
		const status =
			workspace.state.terminalSessions[session.id]?.status === 'exited'
				? 'exited'
				: 'interrupted';
		const exitCode =
			workspace.state.terminalSessions[session.id]?.exitCode ??
			tail?.exit?.exitCode ??
			undefined;
		terminal.restoreEndedSession({
			identity: identityOf(session),
			cwd: panel?.cwd ?? tail?.cwd ?? projectRoot(state, session) ?? '.',
			createdAt: session.createdAt,
			cols: tail?.cols ?? FALLBACK_COLS,
			rows: tail?.rows ?? FALLBACK_ROWS,
			...(session.launch === undefined ? {} : { launch: session.launch }),
			status,
			...(exitCode === undefined || exitCode === null ? {} : { exitCode }),
			signal: tail?.exit?.signal ?? null,
			endedAt:
				tail?.exit?.at ?? tail?.savedAt ?? session.interruptedAt ?? now(),
			outputPosition: tail?.bufferedFrom ?? session.outputPosition,
			bytes: tail?.bytes ?? new Uint8Array(0),
		});
		ended.push(session.id);
	}

	// A tail belongs to a panel. Sessions the workspace no longer has, and
	// sessions that are running again, have nothing left to keep.
	holder.pruneTails(
		new Set(
			Object.keys(workspace.state.terminalSessions).filter(
				(sessionId) => !adopted.includes(sessionId),
			),
		),
	);
	return { adopted, ended, orphaned, recovered };
}

/**
 * Give each running shell the workspace did not know a panel, in one new
 * "Recovered terminals" project in the first view. Returns the sessions that
 * now have one; a shell the workspace refuses to place is left to be ended.
 */
function recoverStrays(
	options: ReattachHeldSessionsOptions,
	strays: readonly HeldSessionSummary[],
	at: number,
): string[] {
	const first = strays[0];
	if (first === undefined) return [];
	const { workspace } = options;
	const viewId = workspace.state.viewOrder[0];
	if (viewId === undefined) return [];
	let projectId = `recovered-${at.toString(36)}`;
	for (let n = 2; workspace.state.projects[projectId] !== undefined; n += 1)
		projectId = `recovered-${at.toString(36)}-${n}`;
	const created = workspace.apply({
		commandId: `recover:${projectId}`.slice(0, 128),
		command: {
			type: 'project.create',
			projectId,
			viewId,
			root: first.cwd,
			name: RECOVERED_TERMINALS_PROJECT_NAME,
		},
	});
	if (!created.ok) return [];
	const recovered: string[] = [];
	for (const [index, record] of strays.entries()) {
		const placed = workspace.apply({
			commandId: `recover:${record.sessionId}`.slice(0, 128),
			command: {
				type: 'terminal.createPanel',
				sessionId: record.sessionId,
				projectId,
				panelId: `p:${record.sessionId}`.slice(0, 128),
				title: `Recovered ${index + 1}`,
				cwd: record.cwd,
				createdAt: record.createdAt,
			},
		});
		if (placed.ok) recovered.push(record.sessionId);
	}
	return recovered;
}

function identityOf(session: TerminalSession) {
	return {
		serverId: session.serverId,
		projectId: session.projectId,
		sessionId: session.id,
	};
}

function terminalPanelsBySession(
	state: WorkspaceState,
): Map<string, TerminalPanel> {
	const panels = new Map<string, TerminalPanel>();
	for (const panel of Object.values(state.panels))
		if (panel.type === 'terminal') panels.set(panel.sessionId, panel);
	return panels;
}

function projectRoot(
	state: WorkspaceState,
	session: TerminalSession,
): string | undefined {
	return state.projects[session.projectId]?.root;
}

function withoutPid(process: PtyProcess): PtyProcess {
	const { pid: _pid, getCwd: _getCwd, ...rest } = process;
	return rest;
}
