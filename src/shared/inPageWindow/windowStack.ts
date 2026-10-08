/**
 * Which in-page window is on top.
 *
 * Windows are modal and stack only by nesting: a dialog opened from inside a
 * window sits above it. One Escape closes one window, the topmost, so the
 * order lives here rather than in each window's own key handler.
 */

export interface WindowStackEntry {
	readonly close: () => void;
}

export interface WindowStack {
	/** Adds a window above every other; returns the function that removes it. */
	push(entry: WindowStackEntry): () => void;
	/** The window's distance from the bottom, or -1 when it is not open. */
	depthOf(entry: WindowStackEntry): number;
	top(): WindowStackEntry | null;
	subscribe(listener: () => void): () => void;
}

export function createWindowStack(): WindowStack {
	let entries: readonly WindowStackEntry[] = [];
	const listeners = new Set<() => void>();
	const changed = () => {
		for (const listener of listeners) listener();
	};
	return {
		push(entry) {
			entries = [...entries, entry];
			changed();
			return () => {
				entries = entries.filter((candidate) => candidate !== entry);
				changed();
			};
		},
		depthOf: (entry) => entries.indexOf(entry),
		top: () => entries.at(-1) ?? null,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

export const inPageWindowStack = createWindowStack();

/** Escape closes the topmost window, unless something inside it already used the key. */
export function closeTopOnEscape(
	stack: WindowStack,
	event: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'preventDefault'>,
): boolean {
	if (event.key !== 'Escape' || event.defaultPrevented) return false;
	const top = stack.top();
	if (top === null) return false;
	event.preventDefault();
	top.close();
	return true;
}
