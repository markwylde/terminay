/**
 * Per-device view state.
 *
 * The workspace's contents are shared: which terminals exist, what they are
 * called, which project they belong to, and every byte they produce. Which one
 * you happen to be looking at is not. Two devices attached to the same
 * workspace are two people reading the same book at different pages.
 *
 * This module owns the small amount of state that must never travel: the tab
 * each device last had selected, and the rule for what a device selects when it
 * has no opinion yet.
 *
 * Persistence is deliberately best-effort. A device can reconnect to a
 * workspace whose projects and terminals have completely changed, so a
 * remembered session is a hint to be validated against what actually exists,
 * never a instruction to be obeyed. Storage that is unavailable, full, or
 * disabled is a normal condition, not an error worth surfacing.
 */

import {
	DEFAULT_DASHBOARD_VIEW_MODE,
	type DashboardViewMode,
	isDashboardViewMode,
} from './dashboardViewMode.ts';
import {
	DEFAULT_HOME_SECTION,
	type HomeSection,
	isHomeSection,
} from './homeSection.ts';

const STORAGE_KEY = 'terminay.view.active-session.v1';
/** Bounded so a long-lived browser profile cannot accumulate dead projects. */
const MAX_REMEMBERED_PROJECTS = 64;

type RememberedSessions = Record<string, string>;

function readAll(): RememberedSessions {
	try {
		const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
		if (raw === null || raw === undefined) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
			return {};
		const entries = Object.entries(parsed).filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string',
		);
		return Object.fromEntries(entries);
	} catch {
		return {};
	}
}

function writeAll(value: RememberedSessions): void {
	try {
		const entries = Object.entries(value).slice(-MAX_REMEMBERED_PROJECTS);
		globalThis.localStorage?.setItem(
			STORAGE_KEY,
			JSON.stringify(Object.fromEntries(entries)),
		);
	} catch {
		/* A device that cannot remember still works; it just starts fresh. */
	}
}

export function rememberActiveSession(
	projectId: string,
	sessionId: string,
): void {
	if (projectId.length === 0 || sessionId.length === 0) return;
	const all = readAll();
	if (all[projectId] === sessionId) return;
	// Re-inserting moves this project to the end, so the bound above evicts the
	// least recently used project rather than an arbitrary one.
	delete all[projectId];
	all[projectId] = sessionId;
	writeAll(all);
}

export function recallActiveSession(projectId: string): string | undefined {
	if (projectId.length === 0) return undefined;
	return readAll()[projectId];
}

export function forgetActiveSession(projectId: string): void {
	const all = readAll();
	if (!(projectId in all)) return;
	delete all[projectId];
	writeAll(all);
}

/**
 * Whether this device was last showing the Home dashboard rather than a
 * project.
 *
 * The selected view is this device's business in exactly the way the selected
 * terminal is: two devices attached to one workspace can sit on Home and on a
 * project without either dragging the other. It is scoped per workspace view so
 * two windows onto the same server keep their own answer, and it is a hint like
 * every other value in this module — a device that cannot read it, or that
 * reconnects to a workspace where Home cannot be shown, simply selects a
 * project.
 */
const HOME_SELECTION_STORAGE_KEY = 'terminay.view.home-selected.v1';

function homeSelectionKey(serverId: string, viewId: string): string {
	return `${serverId}:${viewId}`;
}

function readHomeSelections(): Record<string, true> {
	try {
		const raw = globalThis.localStorage?.getItem(HOME_SELECTION_STORAGE_KEY);
		if (raw === null || raw === undefined) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
			return {};
		return Object.fromEntries(
			Object.entries(parsed)
				.filter((entry) => entry[1] === true)
				.map((entry) => [entry[0], true as const]),
		);
	} catch {
		return {};
	}
}

function writeHomeSelections(value: Record<string, true>): void {
	try {
		const entries = Object.entries(value).slice(-MAX_REMEMBERED_PROJECTS);
		globalThis.localStorage?.setItem(
			HOME_SELECTION_STORAGE_KEY,
			JSON.stringify(Object.fromEntries(entries)),
		);
	} catch {
		/* A device that cannot remember still works; it just starts on a project. */
	}
}

export function rememberHomeSelected(
	serverId: string,
	viewId: string | null,
	selected: boolean,
): void {
	if (serverId.length === 0 || viewId === null || viewId.length === 0) return;
	const key = homeSelectionKey(serverId, viewId);
	const all = readHomeSelections();
	if (selected) {
		if (all[key] === true) return;
		all[key] = true;
	} else {
		if (!(key in all)) return;
		delete all[key];
	}
	writeHomeSelections(all);
}

export function recallHomeSelected(
	serverId: string,
	viewId: string | null,
): boolean {
	if (serverId.length === 0 || viewId === null || viewId.length === 0)
		return false;
	return readHomeSelections()[homeSelectionKey(serverId, viewId)] === true;
}

/**
 * Which shape this device shows the dashboard in.
 *
 * The same kind of fact as which tab it has selected: it belongs to the person
 * at the screen, not to the workspace. It is stored once per device rather than
 * per server, because the dashboard spans every attached server and there is no
 * one server whose key it could hang from.
 *
 * A hint like everything else here — an unreadable, disabled, or nonsense value
 * is the List view and no error.
 */
const DASHBOARD_VIEW_MODE_STORAGE_KEY = 'terminay.view.dashboard-mode.v1';

export function rememberDashboardViewMode(mode: DashboardViewMode): void {
	try {
		globalThis.localStorage?.setItem(DASHBOARD_VIEW_MODE_STORAGE_KEY, mode);
	} catch {
		/* A device that cannot remember still works; it just starts on List. */
	}
}

export function recallDashboardViewMode(): DashboardViewMode {
	try {
		const raw = globalThis.localStorage?.getItem(
			DASHBOARD_VIEW_MODE_STORAGE_KEY,
		);
		return isDashboardViewMode(raw) ? raw : DEFAULT_DASHBOARD_VIEW_MODE;
	} catch {
		return DEFAULT_DASHBOARD_VIEW_MODE;
	}
}

/**
 * Whether this device bands the Board by project.
 *
 * The same kind of hint as the view mode it refines, and kept beside it for the
 * same reason. Anything other than a stored `true` is the ungrouped Board.
 */
const DASHBOARD_BOARD_GROUPED_STORAGE_KEY =
	'terminay.view.dashboard-board-grouped.v1';

export function rememberDashboardBoardGrouped(grouped: boolean): void {
	try {
		globalThis.localStorage?.setItem(
			DASHBOARD_BOARD_GROUPED_STORAGE_KEY,
			grouped ? 'true' : 'false',
		);
	} catch {
		/* A device that cannot remember still works; it starts ungrouped. */
	}
}

export function recallDashboardBoardGrouped(): boolean {
	try {
		return (
			globalThis.localStorage?.getItem(DASHBOARD_BOARD_GROUPED_STORAGE_KEY) ===
			'true'
		);
	} catch {
		return false;
	}
}

/**
 * Whether this device shows Home's sidebar.
 *
 * Kept apart from every project's sidebar visibility: Home is not a project, so
 * toggling one never touches the other. Stored once per device, like the
 * dashboard view mode, because Home spans every attached server. A device with
 * no answer — or one that cannot read it — shows the sidebar open.
 */
const HOME_SIDEBAR_VISIBLE_STORAGE_KEY = 'terminay.view.home-sidebar-visible.v1';

export function rememberHomeSidebarVisible(visible: boolean): void {
	try {
		globalThis.localStorage?.setItem(
			HOME_SIDEBAR_VISIBLE_STORAGE_KEY,
			visible ? 'true' : 'false',
		);
	} catch {
		/* A device that cannot remember still works; it starts with it open. */
	}
}

export function recallHomeSidebarVisible(): boolean {
	try {
		return (
			globalThis.localStorage?.getItem(HOME_SIDEBAR_VISIBLE_STORAGE_KEY) !==
			'false'
		);
	} catch {
		return true;
	}
}

/**
 * Which Home section this device last showed. A hint like everything else here:
 * an unreadable, disabled, or nonsense value is the Home overview and no error.
 */
const HOME_SECTION_STORAGE_KEY = 'terminay.view.home-section.v1';

export function rememberHomeSection(section: HomeSection): void {
	try {
		globalThis.localStorage?.setItem(HOME_SECTION_STORAGE_KEY, section);
	} catch {
		/* A device that cannot remember still works; it starts on Home. */
	}
}

export function recallHomeSection(): HomeSection {
	try {
		const raw = globalThis.localStorage?.getItem(HOME_SECTION_STORAGE_KEY);
		return isHomeSection(raw) ? raw : DEFAULT_HOME_SECTION;
	} catch {
		return DEFAULT_HOME_SECTION;
	}
}

export interface AdoptedTerminalActivation {
	/** True when this device asked for the terminal: a tab dragged into this
	 * project, or a terminal this device created. False when it merely appeared
	 * because another device created it. */
	readonly requestedLocally: boolean;
	/** False when this device has nothing selected and would otherwise show a
	 * blank workspace. */
	readonly hasActivePanel: boolean;
	/** The session this device had selected last time it saw this project. */
	readonly rememberedSessionId?: string | undefined;
	readonly sessionId: string;
}

/**
 * Whether adopting a terminal should make it the active tab.
 *
 * The default is no. A terminal appearing is a workspace fact, and acting on it
 * drags this device off whatever it was reading — the remote jumping to a
 * terminal the desktop just created. Three cases override that:
 */
export function shouldActivateAdoptedTerminal(
	options: AdoptedTerminalActivation,
): boolean {
	// This device asked for it. Focusing what you just created or dragged is the
	// whole point.
	if (options.requestedLocally) return true;
	// This device is showing nothing. It has no view to protect and must land
	// somewhere, so the first terminal it adopts becomes its default rather than
	// whatever another device is looking at.
	if (!options.hasActivePanel) return true;
	// This is the tab this device was on before it reconnected. Restoring it is
	// this device's own past choice, not another device's present one.
	return (
		options.rememberedSessionId !== undefined &&
		options.rememberedSessionId === options.sessionId
	);
}
