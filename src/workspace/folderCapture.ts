/**
 * What a device does when the server moves a terminal into the folder of a
 * worktree that terminal created.
 *
 * The move itself arrives as an ordinary workspace change, and the Folders
 * tree shows it like any other. The journal event handled here says why it
 * happened, and one thing follows from it: the device that was looking at the
 * terminal keeps looking at it.
 *
 * Everything here is pure. The event is input from the server and is parsed
 * before anything reads it.
 */

/** The journal event the server appends after capturing a terminal. */
export const FOLDER_TERMINAL_CAPTURED_EVENT = 'folder.terminal-captured';

export type FolderTerminalCapture = {
	projectId: string;
	/** The worktree's folder, where the terminal is now. */
	folderId: string;
	panelId: string;
	/** The folder the terminal left. */
	fromFolderId: string;
};

const MAX_ID_LENGTH = 128;

function id(value: unknown): string | undefined {
	return typeof value === 'string' &&
		value.length > 0 &&
		value.length <= MAX_ID_LENGTH
		? value
		: undefined;
}

/** A capture, or undefined for anything that is not exactly one. */
export function parseFolderTerminalCapture(
	payload: unknown,
): FolderTerminalCapture | undefined {
	if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
		return undefined;
	const record = payload as Record<string, unknown>;
	const projectId = id(record.projectId);
	const folderId = id(record.folderId);
	const panelId = id(record.panelId);
	const fromFolderId = id(record.fromFolderId);
	if (
		projectId === undefined ||
		folderId === undefined ||
		panelId === undefined ||
		fromFolderId === undefined ||
		folderId === fromFolderId
	)
		return undefined;
	return { projectId, folderId, panelId, fromFolderId };
}

/** The panel in front of the window: the focused panel of the folder on
 * screen. Absent while Home, or no project, is in front. */
export type FrontPanel = { projectId: string; panelId: string };

/**
 * The panel in front now and the one it replaced.
 *
 * The move and the event that explains it travel separately, so by the time
 * the event is read the terminal may already have left the folder on screen
 * and something else be in front. The panel that was in front until a moment
 * ago is still the one this device was looking at.
 */
export type FrontPanelHistory = {
	current?: FrontPanel;
	previous?: FrontPanel & { replacedAt: number };
};

export function recordFrontPanel(
	history: FrontPanelHistory,
	front: FrontPanel | undefined,
	now: number,
): FrontPanelHistory {
	const { current } = history;
	if (
		current?.projectId === front?.projectId &&
		current?.panelId === front?.panelId
	)
		return history;
	return {
		...(front === undefined ? {} : { current: front }),
		...(current === undefined
			? history.previous === undefined
				? {}
				: { previous: history.previous }
			: { previous: { ...current, replacedAt: now } }),
	};
}

/** How long after leaving the front a panel still counts as being looked at. */
export const FRONT_PANEL_GRACE_MS = 3_000;

/** Whether this device was looking at the captured terminal. */
export function wasLookingAt(
	history: FrontPanelHistory,
	capture: Pick<FolderTerminalCapture, 'projectId' | 'panelId'>,
	now: number,
): boolean {
	const matches = (front: FrontPanel | undefined) =>
		front?.projectId === capture.projectId && front.panelId === capture.panelId;
	if (matches(history.current)) return true;
	return (
		matches(history.previous) &&
		history.previous !== undefined &&
		now - history.previous.replacedAt <= FRONT_PANEL_GRACE_MS
	);
}
