import type { TerminalService } from '../terminalService/service.js';
import type { PtyProcess } from '../terminalService/types.js';
import type {
	TerminalPanel,
	TerminalSession,
	WorkspaceState,
	WorkspaceStore,
} from '../workspace.js';
import type { SessionHolderPtyFactory } from './factory.js';

/**
 * Restart recovery when a session holder keeps PTYs running (ADR-0035).
 *
 * Every persisted terminal session ends up in exactly one of three states:
 * adopted and running under its original identity, ended with the output it
 * left behind, or ended with nothing to show. Its panel is kept in all three.
 * A session the holder has but the workspace does not is ended, so nothing
 * runs that no panel can reach.
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
	/** Held sessions the workspace does not know, which were ended. */
	readonly orphaned: readonly string[];
}

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
	if (options.freshWorkspace === true) {
		for (const sessionId of held.keys()) await holder.end(sessionId);
		holder.pruneTails(new Set());
		return { adopted: [], ended: [], orphaned: [...held.keys()] };
	}
	const state = workspace.state;
	const persisted = state.terminalSessions;
	const panels = terminalPanelsBySession(state);

	const orphaned: string[] = [];
	for (const sessionId of held.keys()) {
		const session = persisted[sessionId];
		if (session !== undefined && session.serverId === options.serverId)
			continue;
		orphaned.push(sessionId);
		held.delete(sessionId);
		await holder.end(sessionId);
	}

	// The workspace is reconciled before anything is adopted, so the exit of a
	// held session that has already ended is recorded by the ordinary exit path
	// when its retained output is replayed.
	const reattachable = new Set<string>();
	const exitedWhileAway = new Map<string, number | undefined>();
	const tails = new Map<string, ReturnType<typeof holder.readTail>>();
	for (const session of Object.values(persisted)) {
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
	return { adopted, ended, orphaned };
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
