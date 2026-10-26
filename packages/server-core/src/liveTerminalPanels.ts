import type { TerminalSessionSnapshot } from './terminalService/types.js';
import type {
	WorkspaceApplyResult,
	WorkspaceCommand,
	WorkspaceState,
	WorkspaceStore,
} from './workspace.js';

/**
 * How long a running terminal may be without a panel before the server gives
 * it one. Every creator spawns the PTY first and commits its panel after, so a
 * session is briefly panel-less by design; this outlasts those windows.
 */
export const LIVE_TERMINAL_PANEL_GRACE_MS = 5_000;

export interface LiveTerminalPanelsOptions {
	readonly workspace: WorkspaceStore;
	readonly listSessions: () => readonly TerminalSessionSnapshot[];
	readonly apply: (
		commandId: string,
		command: WorkspaceCommand,
	) => WorkspaceApplyResult | undefined;
	/** End a running terminal whose project no longer exists. */
	readonly kill: (sessionId: string) => Promise<unknown>;
	readonly graceMs?: number;
	readonly now?: () => number;
}

export interface LiveTerminalPanels {
	/** Look again for running terminals without a panel. */
	readonly check: () => void;
	readonly dispose: () => void;
}

/** Running terminals that no terminal panel shows. */
export function runningSessionsWithoutPanel(
	state: WorkspaceState,
	sessions: readonly TerminalSessionSnapshot[],
): readonly TerminalSessionSnapshot[] {
	const shown = new Set<string>();
	for (const panel of Object.values(state.panels))
		if (panel.type === 'terminal') shown.add(panel.sessionId);
	return sessions.filter(
		(session) => session.status === 'running' && !shown.has(session.sessionId),
	);
}

/**
 * Every running terminal has a panel. One found without a panel for longer
 * than the grace gets a new panel in its project's General folder; one whose
 * project is gone is ended, since closing a project ends its terminals.
 *
 * It looks when the workspace changes and when `check` is called, and holds a
 * timer only while a panel-less terminal is waiting out its grace. Nothing is
 * polled (ADR-0028).
 */
export function bindLiveTerminalPanels(
	options: LiveTerminalPanelsOptions,
): LiveTerminalPanels {
	const graceMs = options.graceMs ?? LIVE_TERMINAL_PANEL_GRACE_MS;
	const now = options.now ?? Date.now;
	/** When each panel-less terminal was first seen without its panel. */
	const unseenSince = new Map<string, number>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let attempt = 0;
	let disposed = false;

	const schedule = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		if (disposed || unseenSince.size === 0) return;
		const due = Math.min(...unseenSince.values()) + graceMs;
		timer = setTimeout(
			() => {
				timer = undefined;
				check();
			},
			Math.max(0, due - now()),
		);
		(timer as { unref?: () => void }).unref?.();
	};

	const givePanel = (session: TerminalSessionSnapshot): void => {
		const state = options.workspace.state;
		if (state.projects[session.projectId] === undefined) {
			void options.kill(session.sessionId).catch(() => undefined);
			return;
		}
		const record = state.terminalSessions[session.sessionId];
		// The workspace places this terminal in another project than the one it
		// runs under; a move is still committing, and it brings its own panel.
		if (record !== undefined && record.projectId !== session.projectId) return;
		let panelId = `p:${session.sessionId}`.slice(0, 128);
		for (let n = 2; state.panels[panelId] !== undefined; n += 1)
			panelId = `p${n}:${session.sessionId}`.slice(0, 128);
		attempt += 1;
		const commandId = `live-panel:${attempt}:${session.sessionId}`.slice(
			0,
			128,
		);
		// No folder means General, and no title means the next `Terminal N`.
		options.apply(
			commandId,
			record === undefined
				? {
						type: 'terminal.createPanel',
						sessionId: session.sessionId,
						projectId: session.projectId,
						panelId,
						cwd: session.cwd,
						createdAt: session.createdAt,
						...(session.launch === undefined ? {} : { launch: session.launch }),
					}
				: {
						type: 'panel.create',
						panel: {
							id: panelId,
							projectId: session.projectId,
							type: 'terminal',
							sessionId: session.sessionId,
							cwd: session.cwd,
							createdAt: session.createdAt,
						},
					},
		);
	};

	const check = (): void => {
		if (disposed) return;
		const panelless = runningSessionsWithoutPanel(
			options.workspace.state,
			options.listSessions(),
		);
		const ids = new Set(panelless.map((session) => session.sessionId));
		for (const id of [...unseenSince.keys()])
			if (!ids.has(id)) unseenSince.delete(id);
		const at = now();
		for (const session of panelless) {
			const since = unseenSince.get(session.sessionId);
			if (since === undefined) {
				unseenSince.set(session.sessionId, at);
				continue;
			}
			if (at - since < graceMs) continue;
			unseenSince.delete(session.sessionId);
			try {
				givePanel(session);
			} catch {
				// A refused panel leaves the terminal as it was; the next change
				// to the workspace looks at it again.
			}
		}
		schedule();
	};

	const unsubscribe = options.workspace.subscribe(() => {
		// The listener runs inside the committing apply; look once it returns.
		queueMicrotask(check);
	});

	return Object.freeze({
		check,
		dispose: () => {
			disposed = true;
			unsubscribe();
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			unseenSince.clear();
		},
	});
}
