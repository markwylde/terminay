/** The application icon badge is the sum of what each native window's
 * Notifications control shows. Windows hold disjoint projects, so their counts
 * add; a window that goes away takes its count with it. */
export type AppBadgeTracker = Readonly<{
	set(windowId: number, count: number): void;
	clear(windowId: number): void;
	reset(): void;
	total(): number;
}>;

export function createAppBadgeTracker(
	setBadgeCount: (count: number) => void,
): AppBadgeTracker {
	const counts = new Map<number, number>();
	let applied = 0;
	const total = () => {
		let sum = 0;
		for (const count of counts.values()) sum += count;
		return sum;
	};
	const apply = () => {
		const next = total();
		if (next === applied) return;
		applied = next;
		try {
			setBadgeCount(next);
		} catch {
			// A desktop without an icon badge must not disturb the window that reported.
		}
	};
	return Object.freeze({
		set(windowId: number, count: number) {
			if (count === 0) counts.delete(windowId);
			else counts.set(windowId, count);
			apply();
		},
		clear(windowId: number) {
			if (counts.delete(windowId)) apply();
		},
		reset() {
			counts.clear();
			apply();
		},
		total,
	});
}
