import type { DockviewApi } from 'dockview';
import type {
	TerminalActivityState,
	TerminalTabMacroRun,
} from '../components/TerminalTab';
import type { AgentState } from '../types/agentStatus';

export type MovedTerminalTab = {
	activityIndicatorsEnabled?: boolean;
	agentNeedsAttention?: boolean;
	agentState?: AgentState;
	agentUnread?: boolean;
	color?: string;
	emoji?: string;
	inheritsProjectColor?: boolean;
	macroRuns?: TerminalTabMacroRun[];
	recordingError?: string | null;
	recordingId?: string | null;
	recordingStatus?: 'failed' | 'idle' | 'recording';
	cwd?: string;
	panelId?: string;
	sessionId: string;
	terminalSessionStatus?: 'running' | 'exited' | 'interrupted';
	/**
	 * The immutable server project identity that owns the retained PTY. Moving
	 * its presentation must never recreate or silently re-home the process.
	 */
	serverProjectId?: string;
	showActiveTabActivityIndicator?: boolean;
	showFinishedTabActivityIndicator?: boolean;
	terminalActivityState?: TerminalActivityState;
	terminalNote?: string;
	title: string;
};

export type MovedProject = {
	activeSessionId: string | null;
	terminals: MovedTerminalTab[];
};

type DockviewPanel = NonNullable<ReturnType<DockviewApi['getPanel']>>;

type TerminalTransferContext = {
	defaultServerProjectId?: string;
	runningMacroRunsBySession: Record<string, TerminalTabMacroRun[] | undefined>;
};

export function getServerTerminalPresentationTitle(
	title: string | undefined,
	nextTerminalNumber: number,
): string {
	return typeof title === 'string' && title.trim().length > 0
		? title.trim()
		: `Terminal ${nextTerminalNumber}`;
}

export function snapshotMovedTerminal(
	panel: DockviewPanel,
	context: TerminalTransferContext,
): MovedTerminalTab | null {
	const sessionId = panel.params?.sessionId;
	if (!sessionId) {
		return null;
	}

	return {
		activityIndicatorsEnabled: panel.params?.activityIndicatorsEnabled,
		agentNeedsAttention: panel.params?.agentNeedsAttention,
		agentState: panel.params?.agentState,
		agentUnread: panel.params?.agentUnread,
		color: panel.params?.color,
		emoji: panel.params?.emoji,
		inheritsProjectColor: panel.params?.inheritsProjectColor,
		macroRuns: context.runningMacroRunsBySession[sessionId] ?? [],
		recordingError: panel.params?.recordingError,
		recordingId: panel.params?.recordingId,
		recordingStatus: panel.params?.recordingStatus,
		cwd: panel.params?.cwd,
		serverProjectId:
			panel.params?.terminalClientIdentity?.projectId ??
			context.defaultServerProjectId,
		sessionId,
		showActiveTabActivityIndicator:
			panel.params?.showActiveTabActivityIndicator,
		showFinishedTabActivityIndicator:
			panel.params?.showFinishedTabActivityIndicator,
		terminalActivityState: panel.params?.terminalActivityState,
		terminalNote: panel.params?.terminalNote,
		title: panel.title ?? 'Terminal',
	};
}

export function exportTerminalPresentationForMove(options: {
	api: DockviewApi | null;
	context: TerminalTransferContext;
	movingSessionIds: Set<string>;
	panelId: string;
}): MovedTerminalTab | null {
	const panel = options.api?.getPanel(options.panelId);
	if (!panel) {
		return null;
	}
	const movedTerminal = snapshotMovedTerminal(panel, options.context);
	if (!movedTerminal) {
		return null;
	}

	options.movingSessionIds.add(movedTerminal.sessionId);
	panel.api.close();
	return movedTerminal;
}

export function exportProjectPresentationsForMove(options: {
	api: DockviewApi | null;
	context: TerminalTransferContext;
	movingSessionIds: Set<string>;
}): MovedProject | null {
	if (!options.api) {
		return null;
	}

	const terminals = options.api.panels.flatMap((panel) => {
		const moved = snapshotMovedTerminal(panel, options.context);
		return moved ? [moved] : [];
	});
	if (terminals.length === 0) {
		return null;
	}

	for (const terminal of terminals) {
		options.movingSessionIds.add(terminal.sessionId);
	}
	return {
		activeSessionId: options.api.activePanel?.params?.sessionId ?? null,
		terminals,
	};
}
