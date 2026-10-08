/**
 * Remembered geometry for the resizable in-page windows.
 *
 * Per-device view state, like the selected tab: a rectangle only means
 * something on the screen it was made on, so it never travels to a server and
 * is keyed by window id alone. Persistence is best-effort. Storage that is
 * unavailable, full, or holding something unexpected is a normal condition and
 * means the window opens at its default.
 */

import type { WindowRect } from './geometry.ts';

const STORAGE_KEY = 'terminay.view.in-page-window.v1';

export const IN_PAGE_WINDOW_IDS = [
	'settings',
	'macros',
	'recordings',
	'remote-control',
	'performance-log',
] as const;

export type InPageWindowId = (typeof IN_PAGE_WINDOW_IDS)[number];

export interface RememberedGeometry extends WindowRect {
	readonly maximized: boolean;
}

type Stored = Partial<Record<InPageWindowId, RememberedGeometry>>;

function isWindowId(value: string): value is InPageWindowId {
	return (IN_PAGE_WINDOW_IDS as readonly string[]).includes(value);
}

function parseGeometry(value: unknown): RememberedGeometry | null {
	if (typeof value !== 'object' || value === null) return null;
	const { x, y, width, height, maximized } = value as Record<string, unknown>;
	for (const field of [x, y, width, height]) {
		if (typeof field !== 'number' || !Number.isFinite(field)) return null;
	}
	if ((width as number) <= 0 || (height as number) <= 0) return null;
	if (typeof maximized !== 'boolean') return null;
	return {
		x: x as number,
		y: y as number,
		width: width as number,
		height: height as number,
		maximized,
	};
}

function readAll(): Stored {
	try {
		const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
		if (raw === null || raw === undefined) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return {};
		const stored: Stored = {};
		for (const [id, value] of Object.entries(parsed)) {
			if (!isWindowId(id)) continue;
			const geometry = parseGeometry(value);
			if (geometry !== null) stored[id] = geometry;
		}
		return stored;
	} catch {
		return {};
	}
}

export function readRememberedGeometry(
	id: InPageWindowId,
): RememberedGeometry | null {
	return readAll()[id] ?? null;
}

export function writeRememberedGeometry(
	id: InPageWindowId,
	geometry: RememberedGeometry,
): void {
	try {
		const next: Stored = {
			...readAll(),
			[id]: {
				x: Math.round(geometry.x),
				y: Math.round(geometry.y),
				width: Math.round(geometry.width),
				height: Math.round(geometry.height),
				maximized: geometry.maximized,
			},
		};
		globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		// Remembering is optional.
	}
}
