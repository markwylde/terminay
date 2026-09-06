/**
 * The workspace panel inventory.
 *
 * Every project publishes one entry per panel it holds — terminal, file, and
 * folder alike — whether or not that panel is currently doing anything. The
 * dashboard reads the whole list; the header activity menu and the per-project
 * tab badges read `selectNotableEntries` over the same list, so a panel can
 * never read one way on one surface and another way on another.
 *
 * Status here is already canonical: the builder applies the authority order
 * from the terminal-activity-signals spec, where a terminal under agent
 * authority reports its agent state and raw output never competes with it.
 * `idle` is the resting value that no earlier surface needed.
 */

import type { TerminalActivityState } from '../components/TerminalTab';
import type { AgentState } from '../types/agentStatus';
import type {
	TerminalActivityOverviewItem,
	TerminalActivityOverviewState,
	TerminalPresentationActivityState,
} from './activityStates';

export type PanelTabAppearance = {
	activityIndicatorsEnabled?: boolean;
	agentNeedsAttention?: boolean;
	agentState?: AgentState;
	agentUnread?: boolean;
	color?: string;
	emoji?: string;
	inheritsProjectColor?: boolean;
	projectColor?: string;
	showActiveTabActivityIndicator?: boolean;
	showFinishedTabActivityIndicator?: boolean;
	terminalNote?: string;
};

export function getEffectiveTerminalTabColor(
	params: PanelTabAppearance | undefined,
	fallbackProjectColor: string,
): string {
	if (params?.inheritsProjectColor) {
		return params.projectColor ?? fallbackProjectColor;
	}

	return params?.color ?? fallbackProjectColor;
}

export function areTerminalActivityIndicatorsEnabled(
	params: PanelTabAppearance | undefined,
): boolean {
	return params?.activityIndicatorsEnabled !== false;
}

export function isTerminalActivityIndicatorStateVisible(
	state: TerminalActivityState | undefined,
	params: PanelTabAppearance | undefined,
): state is TerminalPresentationActivityState {
	if (!areTerminalActivityIndicatorsEnabled(params)) {
		return false;
	}

	if (state === 'attention') {
		return true;
	}

	if (state === 'recent') {
		return params?.showActiveTabActivityIndicator === true;
	}

	if (state === 'unviewed') {
		return params?.showFinishedTabActivityIndicator !== false;
	}

	return false;
}

export type WorkspaceInventoryPanelKind = 'terminal' | 'file' | 'folder';

export type WorkspaceInventoryStatus = 'idle' | TerminalActivityOverviewState;

export type WorkspaceInventoryEntry = {
	/** Set only when an agent-owned terminal has finished and stays unread. */
	agentUnread?: boolean;
	color: string;
	emoji: string;
	/**
	 * True when this panel's own appearance settings hide its raw-output
	 * activity indicator. The dashboard still shows the canonical status; the
	 * indicator-driven surfaces honour the setting.
	 */
	indicatorsSuppressed?: boolean;
	isAgentStatus: boolean;
	kind: WorkspaceInventoryPanelKind;
	panelId: string;
	projectEmoji: string;
	projectId: string;
	projectTitle: string;
	/** Present for terminal panels; file and folder panels have no session. */
	sessionId?: string;
	status: WorkspaceInventoryStatus;
	title: string;
};

export type InventoryPanelParams = PanelTabAppearance & {
	filePath?: string;
	folderPath?: string;
	sessionId?: string;
	terminalActivityState?: TerminalActivityState;
};

export type InventoryPanelSource = {
	id: string;
	params?: InventoryPanelParams;
	title?: string;
};

export type InventoryProjectSource = {
	color: string;
	emoji: string;
	id: string;
	title: string;
};

function panelKind(
	params: InventoryPanelParams | undefined,
): WorkspaceInventoryPanelKind {
	if (params?.sessionId) return 'terminal';
	if (params?.folderPath !== undefined) return 'folder';
	if (params?.filePath !== undefined) return 'file';
	return 'terminal';
}

function defaultPanelTitle(kind: WorkspaceInventoryPanelKind): string {
	if (kind === 'folder') return 'Folder';
	if (kind === 'file') return 'File';
	return 'Terminal';
}

/**
 * One entry per panel, in the order the panels were given, with the canonical
 * status already resolved.
 */
export function buildProjectInventoryEntries(options: {
	agentIntegrationEnabled: boolean;
	panels: readonly InventoryPanelSource[];
	project: InventoryProjectSource;
}): WorkspaceInventoryEntry[] {
	const { agentIntegrationEnabled, panels, project } = options;
	const entries: WorkspaceInventoryEntry[] = [];

	for (const panel of panels) {
		const params = panel.params;
		const kind = panelKind(params);
		const sessionId = params?.sessionId;
		const agentState = params?.agentState;
		const base = {
			color: getEffectiveTerminalTabColor(params, project.color),
			emoji: params?.emoji ?? '',
			kind,
			panelId: panel.id,
			projectEmoji: project.emoji,
			projectId: project.id,
			projectTitle: project.title,
			title: panel.title ?? defaultPanelTitle(kind),
			...(sessionId === undefined ? {} : { sessionId }),
		};

		if (kind !== 'terminal') {
			entries.push({ ...base, isAgentStatus: false, status: 'idle' });
			continue;
		}

		if (agentIntegrationEnabled && sessionId && agentState) {
			// Once a native lifecycle hook has claimed this terminal, raw output
			// activity must never compete with that authority.
			entries.push({
				...base,
				agentUnread: params?.agentUnread === true,
				isAgentStatus: true,
				status: agentState,
			});
			continue;
		}

		const activityState = params?.terminalActivityState;
		const status: WorkspaceInventoryStatus =
			activityState === 'recent' ||
			activityState === 'unviewed' ||
			activityState === 'attention'
				? activityState
				: 'idle';
		entries.push({
			...base,
			indicatorsSuppressed: !isTerminalActivityIndicatorStateVisible(
				activityState,
				params,
			),
			isAgentStatus: false,
			status,
		});
	}

	return entries;
}

/**
 * The predicate the header activity menu and the project tab badges have always
 * used: an agent-owned terminal counts while it is working, while it needs
 * attention, and once it is done but unread; any other terminal counts only
 * while its own indicator settings would show its state. File and folder panels
 * have never had activity and never count.
 */
export function isNotableInventoryEntry(
	entry: WorkspaceInventoryEntry,
): boolean {
	if (entry.kind !== 'terminal') return false;
	if (entry.sessionId === undefined) return false;
	if (entry.status === 'idle') return false;
	if (entry.isAgentStatus) {
		if (entry.status === 'working') return true;
		if (entry.status === 'waiting' || entry.status === 'blocked') return true;
		return entry.status === 'done' && entry.agentUnread === true;
	}
	return entry.indicatorsSuppressed !== true;
}

/**
 * The notable entries, in inventory order, shaped for the surfaces that only
 * ever knew about notable terminals.
 */
export function selectNotableEntries(
	entries: readonly WorkspaceInventoryEntry[],
): TerminalActivityOverviewItem[] {
	const items: TerminalActivityOverviewItem[] = [];
	for (const entry of entries) {
		if (!isNotableInventoryEntry(entry)) continue;
		if (entry.status === 'idle') continue;
		items.push({
			color: entry.color,
			emoji: entry.emoji,
			isAgentStatus: entry.isAgentStatus,
			panelId: entry.panelId,
			projectEmoji: entry.projectEmoji,
			projectId: entry.projectId,
			projectTitle: entry.projectTitle,
			sessionId: entry.sessionId ?? '',
			state: entry.status,
			title: entry.title,
		});
	}
	return items;
}
