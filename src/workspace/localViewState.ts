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
