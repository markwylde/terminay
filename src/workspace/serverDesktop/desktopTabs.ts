/**
 * The server desktop tabs this device has open in projects.
 *
 * A desktop tab is this device's view of the server's desktop, like a pull
 * request tab: the server does not know it exists. Home remembers its own
 * tabs in its own arrangement; a project's tabs are remembered here, by the
 * folder they sit in, so they come back after a reload and so moving one to
 * another project is a change to one entry that both projects follow.
 */

import { useSyncExternalStore } from 'react';

/** The Dockview component and tab component a desktop tab is drawn with. */
export const SERVER_DESKTOP_PANEL_COMPONENT = 'serverDesktop';
export const SERVER_DESKTOP_TAB_COMPONENT = 'serverDesktopTab';

export type DesktopTabPlace = Readonly<{ projectId: string; folderId: string }>;

export type DesktopTabEntry = Readonly<{
	id: string;
	serverId: string;
	place: DesktopTabPlace;
}>;

const STORAGE_KEY = 'terminay.view.server-desktop-tabs.v1';
const MAX_ENTRIES = 64;

const isText = (value: unknown): value is string =>
	typeof value === 'string' && value.length > 0 && value.length <= 512;

/** Entries a stored document names, dropping anything unreadable. */
export function parseDesktopTabs(value: unknown): DesktopTabEntry[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const entries: DesktopTabEntry[] = [];
	for (const item of value.slice(0, MAX_ENTRIES)) {
		const candidate = item as Partial<DesktopTabEntry> | null;
		const place = candidate?.place as Partial<DesktopTabPlace> | undefined;
		if (
			!isText(candidate?.id) ||
			!isText(candidate.serverId) ||
			!isText(place?.projectId) ||
			!isText(place.folderId) ||
			seen.has(candidate.id)
		)
			continue;
		seen.add(candidate.id);
		entries.push({
			id: candidate.id,
			serverId: candidate.serverId,
			place: { projectId: place.projectId, folderId: place.folderId },
		});
	}
	return entries;
}

function load(): DesktopTabEntry[] {
	try {
		const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
		return typeof raw === 'string' ? parseDesktopTabs(JSON.parse(raw)) : [];
	} catch {
		return [];
	}
}

let entries: readonly DesktopTabEntry[] | undefined;
const listeners = new Set<() => void>();

function current(): readonly DesktopTabEntry[] {
	entries ??= load();
	return entries;
}

function commit(next: readonly DesktopTabEntry[]): void {
	entries = next;
	try {
		globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		/* A device that cannot remember still shows the tab until it reloads. */
	}
	for (const listener of listeners) listener();
}

/** A new tab id, unique on this device. */
export function newDesktopTabId(): string {
	const random =
		globalThis.crypto?.randomUUID?.() ??
		`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	return `server-desktop-${random}`;
}

export const desktopTabs = {
	list: current,
	subscribe(listener: () => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	/** Put a tab in a project's folder: a new one, or one moved from Home. */
	add(entry: DesktopTabEntry): void {
		commit([...current().filter((e) => e.id !== entry.id), entry]);
	},
	/** Move a tab to another project's folder. */
	move(id: string, place: DesktopTabPlace): void {
		commit(current().map((e) => (e.id === id ? { ...e, place } : e)));
	},
	/** Forget a tab: it was closed, or it moved to Home. */
	remove(id: string): void {
		if (!current().some((e) => e.id === id)) return;
		commit(current().filter((e) => e.id !== id));
	},
	/** Where a tab is now, if it is in a project. */
	placeOf(id: string): DesktopTabPlace | undefined {
		return current().find((e) => e.id === id)?.place;
	},
};

/** The desktop tabs one folder of one project shows, for one server. */
export function desktopTabsIn(
	list: readonly DesktopTabEntry[],
	serverId: string | undefined,
	place: DesktopTabPlace,
): DesktopTabEntry[] {
	return list.filter(
		(entry) =>
			entry.serverId === serverId &&
			entry.place.projectId === place.projectId &&
			entry.place.folderId === place.folderId,
	);
}

export function useDesktopTabs(): readonly DesktopTabEntry[] {
	return useSyncExternalStore(desktopTabs.subscribe, current, current);
}

/** Forget everything; for tests. */
export function resetDesktopTabsForTest(): void {
	entries = undefined;
	listeners.clear();
}
