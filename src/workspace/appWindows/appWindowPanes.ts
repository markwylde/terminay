/**
 * The terminal panes app windows are laid out over, and which terminals have a
 * window the user has not looked at yet.
 *
 * A terminal panel registers its element here. The window host lives outside
 * the docking layout, so a view's iframe is never moved or detached when a tab
 * or project is switched (moving an iframe reloads it); it only follows the
 * registered element's rectangle.
 */

export interface AppWindowPane {
	readonly serverId: string;
	readonly sessionId: string;
	readonly element: HTMLElement;
	/** Whether this client holds the terminal's interactive presentation lease. */
	readonly isController: boolean;
	/** The terminal's ordinary takeover, for a client that does not. */
	readonly takeControl: () => void;
	/**
	 * Renew this client's own control lease. A lease lapses if the client's
	 * timers were paused; renewing never displaces a different holder.
	 */
	readonly renewControl: () => Promise<void>;
	readonly focusTerminal: () => void;
}

type Listener = () => void;

const panes = new Map<string, AppWindowPane>();
const paneListeners = new Set<Listener>();
let paneSnapshot: ReadonlyMap<string, AppWindowPane> = new Map();

function publishPanes(): void {
	paneSnapshot = new Map(panes);
	for (const listener of paneListeners) listener();
}

/** Register or update a pane. Returns its removal. */
export function registerAppWindowPane(key: string, pane: AppWindowPane): () => void {
	panes.set(key, pane);
	publishPanes();
	return () => {
		// A pane that only changed (it gained or lost control, say) is removed
		// and registered again in one commit. Removal waits a microtask so the
		// windows over it never see the pane missing in between, which would
		// unmount their views and lose their state.
		queueMicrotask(() => {
			if (panes.get(key) !== pane) return;
			panes.delete(key);
			publishPanes();
		});
	};
}

export function subscribeAppWindowPanes(listener: Listener): () => void {
	paneListeners.add(listener);
	return () => paneListeners.delete(listener);
}

export function appWindowPanesSnapshot(): ReadonlyMap<string, AppWindowPane> {
	return paneSnapshot;
}

// --- attention: a window arrived while its terminal was not on screen ---

let unseen: ReadonlySet<string> = new Set();
const unseenListeners = new Set<Listener>();

function publishUnseen(next: Set<string>): void {
	unseen = next;
	for (const listener of unseenListeners) listener();
}

/** Mark a pane (`serverId:sessionId`) as having an unseen window. */
export function markAppWindowUnseen(paneKey: string): void {
	if (unseen.has(paneKey)) return;
	publishUnseen(new Set(unseen).add(paneKey));
}

/** The user is looking at this pane: nothing in it is unseen any more. */
export function markAppWindowSeen(paneKey: string): void {
	if (!unseen.has(paneKey)) return;
	const next = new Set(unseen);
	next.delete(paneKey);
	publishUnseen(next);
}

/** Forget panes whose terminals no longer have any window. */
export function retainAppWindowUnseen(paneKeys: ReadonlySet<string>): void {
	const next = new Set([...unseen].filter((key) => paneKeys.has(key)));
	if (next.size !== unseen.size) publishUnseen(next);
}

export function subscribeAppWindowUnseen(listener: Listener): () => void {
	unseenListeners.add(listener);
	return () => unseenListeners.delete(listener);
}

export function appWindowUnseenSnapshot(): ReadonlySet<string> {
	return unseen;
}

/**
 * Whether a registered pane's element is on screen right now. An inactive tab
 * has no size; a project that is not in front keeps its size and is only made
 * invisible, which its panes inherit.
 */
export function isPaneVisible(pane: AppWindowPane | undefined): boolean {
	if (pane === undefined || !pane.element.isConnected) return false;
	const rect = pane.element.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return false;
	return getComputedStyle(pane.element).visibility === 'visible';
}
