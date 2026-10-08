/**
 * When a project tab's peek is open.
 *
 * A peek shows another project's Folders tree under its tab. Project tabs are
 * also what a user presses to switch project, drags to reorder, tears off into
 * a window, and drops a terminal on, so the peek has one overriding rule: it
 * is never in the way of any of those. It opens only once the pointer has
 * rested on a tab, never for the tab in front, never while anything is being
 * dragged, and any press on a tab closes it.
 *
 * This is the whole decision, with the clock handed in. It reads pointer and
 * keyboard reports and says which tab's peek is open; it touches no element.
 */

/** How long the pointer rests on a tab before its peek opens. */
export const PROJECT_TAB_PEEK_DWELL_MS = 350;
/** How long the pointer may be over neither the tab nor the peek, which is
 * what crossing the gap between them takes, before the peek closes. */
export const PROJECT_TAB_PEEK_LEAVE_MS = 150;

export type ProjectTabPeekTimer = {
	set: (callback: () => void, delayMs: number) => unknown;
	clear: (handle: unknown) => void;
};

export type ProjectTabPeekState = {
	/** The tab whose peek is open, or null. */
	openTabId: string | null;
	/** True when the keyboard opened it: its first row takes focus, and
	 * closing returns focus to the tab. */
	viaKeyboard: boolean;
};

export type ProjectTabPeekEnvironment = {
	/** The tab in front, which never has a peek. */
	activeTabId: string | null;
	/** A project tab is being reordered or torn off, or a terminal is being
	 * dragged. */
	isDragging: boolean;
	/** False where the device has no hover, and so no peek. */
	canHover: boolean;
};

export type ProjectTabPeekController = {
	readonly state: ProjectTabPeekState;
	setEnvironment: (environment: ProjectTabPeekEnvironment) => void;
	pointerEnteredTab: (tabId: string) => void;
	pointerLeftTab: (tabId: string) => void;
	pointerEnteredPeek: () => void;
	pointerLeftPeek: () => void;
	/** Any press on any project tab: a click, or the start of a drag. */
	pointerDownOnTab: () => void;
	/** The down arrow on a focused tab. */
	keyboardOpen: (tabId: string) => void;
	/** Escape, a choice made in the peek, or focus leaving a keyboard peek. */
	close: () => void;
	dispose: () => void;
};

const CLOSED: ProjectTabPeekState = Object.freeze({
	openTabId: null,
	viaKeyboard: false,
});

export function createProjectTabPeekController(options: {
	timer: ProjectTabPeekTimer;
	onChange: (state: ProjectTabPeekState) => void;
	dwellMs?: number;
	leaveMs?: number;
}): ProjectTabPeekController {
	const { timer, onChange } = options;
	const dwellMs = options.dwellMs ?? PROJECT_TAB_PEEK_DWELL_MS;
	const leaveMs = options.leaveMs ?? PROJECT_TAB_PEEK_LEAVE_MS;
	let environment: ProjectTabPeekEnvironment = {
		activeTabId: null,
		isDragging: false,
		canHover: true,
	};
	let state = CLOSED;
	/** The tab the pointer is resting on, while its dwell runs. */
	let dwell: { tabId: string; handle: unknown } | null = null;
	let leave: unknown | null = null;
	let overTabId: string | null = null;
	let overPeek = false;
	/** Set by a press, cleared when the pointer next enters a tab: the tab
	 * under a press must not reopen its peek because the pointer stayed put. */
	let pressed = false;

	const publish = (next: ProjectTabPeekState) => {
		if (
			next.openTabId === state.openTabId &&
			next.viaKeyboard === state.viaKeyboard
		)
			return;
		state = next;
		onChange(state);
	};
	const cancelDwell = () => {
		if (dwell === null) return;
		timer.clear(dwell.handle);
		dwell = null;
	};
	const cancelLeave = () => {
		if (leave === null) return;
		timer.clear(leave);
		leave = null;
	};
	const mayOpen = (tabId: string) =>
		environment.canHover &&
		!environment.isDragging &&
		tabId !== environment.activeTabId;
	const close = () => {
		cancelDwell();
		cancelLeave();
		publish(CLOSED);
	};
	const startDwell = (tabId: string) => {
		cancelDwell();
		if (!mayOpen(tabId) || pressed) return;
		const handle = timer.set(() => {
			dwell = null;
			// Whatever was true when the pointer arrived, only what is true now
			// opens a peek.
			if (overTabId !== tabId || !mayOpen(tabId) || pressed) return;
			cancelLeave();
			publish({ openTabId: tabId, viaKeyboard: false });
		}, dwellMs);
		dwell = { tabId, handle };
	};
	const scheduleLeave = () => {
		cancelLeave();
		// A keyboard peek is not the pointer's to close by wandering off.
		if (state.openTabId === null || state.viaKeyboard) return;
		leave = timer.set(() => {
			leave = null;
			if (overPeek || overTabId === state.openTabId) return;
			publish(CLOSED);
		}, leaveMs);
	};

	return {
		get state() {
			return state;
		},
		setEnvironment(next) {
			environment = next;
			if (!next.canHover || next.isDragging) {
				close();
				return;
			}
			if (state.openTabId !== null && state.openTabId === next.activeTabId)
				close();
			if (dwell !== null && dwell.tabId === next.activeTabId) cancelDwell();
		},
		pointerEnteredTab(tabId) {
			overTabId = tabId;
			pressed = false;
			if (state.openTabId === tabId) {
				cancelLeave();
				return;
			}
			// Another tab's peek gives way to this tab's dwell; it closes when
			// the pointer has been gone from it for a moment, as on any leave.
			if (state.openTabId !== null) scheduleLeave();
			startDwell(tabId);
		},
		pointerLeftTab(tabId) {
			if (overTabId === tabId) overTabId = null;
			if (dwell?.tabId === tabId) cancelDwell();
			if (state.openTabId === tabId) scheduleLeave();
		},
		pointerEnteredPeek() {
			overPeek = true;
			cancelLeave();
		},
		pointerLeftPeek() {
			overPeek = false;
			scheduleLeave();
		},
		pointerDownOnTab() {
			pressed = true;
			close();
		},
		keyboardOpen(tabId) {
			if (!mayOpen(tabId)) return;
			cancelDwell();
			cancelLeave();
			publish({ openTabId: tabId, viaKeyboard: true });
		},
		close,
		dispose() {
			cancelDwell();
			cancelLeave();
			state = CLOSED;
		},
	};
}
