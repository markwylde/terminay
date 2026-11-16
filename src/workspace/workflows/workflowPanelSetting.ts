/**
 * Whether workflow panels show collapsed or expanded. One device-local
 * choice for every terminal on this device; never sent to a server and
 * never part of a template (ADR-0097).
 */

import { useSyncExternalStore } from 'react';
import {
	clampPanelWidth,
	WORKFLOW_PANEL_MAX_WIDTH,
	WORKFLOW_PANEL_MIN_WIDTH,
	WORKFLOW_PANEL_NOTES,
	WORKFLOW_PANEL_WIDTH,
	type WorkflowPanelNotes,
} from './workflowPanelModel';

export type WorkflowPanelSetting = 'collapsed' | 'expanded';

export const WORKFLOW_PANEL_STORAGE_KEY = 'terminay.workflowPanel.v1';

const listeners = new Set<() => void>();
let current: WorkflowPanelSetting | undefined;

function read(): WorkflowPanelSetting {
	if (current !== undefined) return current;
	try {
		current =
			globalThis.localStorage?.getItem(WORKFLOW_PANEL_STORAGE_KEY) === 'expanded'
				? 'expanded'
				: 'collapsed';
	} catch {
		current = 'collapsed';
	}
	return current;
}

export function workflowPanelSetting(): WorkflowPanelSetting {
	return read();
}

export function setWorkflowPanelSetting(next: WorkflowPanelSetting): void {
	if (read() === next) return;
	current = next;
	try {
		globalThis.localStorage?.setItem(WORKFLOW_PANEL_STORAGE_KEY, next);
	} catch {
		// Storage may be unavailable; the choice still holds for this session.
	}
	for (const listener of [...listeners]) listener();
}

export function subscribeWorkflowPanelSetting(listener: () => void): () => void {
	listeners.add(listener);
	// Another window of this device changing it changes it here too.
	const onStorage = (event: StorageEvent) => {
		if (event.key !== WORKFLOW_PANEL_STORAGE_KEY) return;
		current = undefined;
		listener();
	};
	globalThis.addEventListener?.('storage', onStorage);
	return () => {
		listeners.delete(listener);
		globalThis.removeEventListener?.('storage', onStorage);
	};
}

export function useWorkflowPanelSetting(): WorkflowPanelSetting {
	return useSyncExternalStore(
		subscribeWorkflowPanelSetting,
		workflowPanelSetting,
		() => 'collapsed',
	);
}

/**
 * How wide the expanded panel is, kept exactly as the collapse choice is: one
 * device-local width for every terminal, never sent to a server and never
 * part of a template. A pane may draw it narrower to keep its terminal's
 * columns; this is the width the user chose.
 */
export const WORKFLOW_PANEL_WIDTH_STORAGE_KEY = 'terminay.workflowPanelWidth.v1';

const widthListeners = new Set<() => void>();
let currentWidth: number | undefined;

/** A stored width is used only when it is one the panel can take. */
function parseStoredWidth(raw: string | null | undefined): number {
	if (raw === null || raw === undefined || !/^\d+$/.test(raw))
		return WORKFLOW_PANEL_WIDTH;
	const width = Number(raw);
	return Number.isSafeInteger(width) &&
		width >= WORKFLOW_PANEL_MIN_WIDTH &&
		width <= WORKFLOW_PANEL_MAX_WIDTH
		? width
		: WORKFLOW_PANEL_WIDTH;
}

function readWidth(): number {
	if (currentWidth !== undefined) return currentWidth;
	try {
		currentWidth = parseStoredWidth(
			globalThis.localStorage?.getItem(WORKFLOW_PANEL_WIDTH_STORAGE_KEY),
		);
	} catch {
		currentWidth = WORKFLOW_PANEL_WIDTH;
	}
	return currentWidth;
}

export function workflowPanelWidth(): number {
	return readWidth();
}

export function setWorkflowPanelWidth(width: number): void {
	const next = clampPanelWidth(width);
	if (readWidth() === next) return;
	currentWidth = next;
	try {
		globalThis.localStorage?.setItem(
			WORKFLOW_PANEL_WIDTH_STORAGE_KEY,
			String(next),
		);
	} catch {
		// Storage may be unavailable; the width still holds for this session.
	}
	for (const listener of [...widthListeners]) listener();
}

export function subscribeWorkflowPanelWidth(listener: () => void): () => void {
	widthListeners.add(listener);
	// Another window of this device resizing it resizes it here too.
	const onStorage = (event: StorageEvent) => {
		if (event.key !== WORKFLOW_PANEL_WIDTH_STORAGE_KEY) return;
		currentWidth = undefined;
		listener();
	};
	globalThis.addEventListener?.('storage', onStorage);
	return () => {
		widthListeners.delete(listener);
		globalThis.removeEventListener?.('storage', onStorage);
	};
}

export function useWorkflowPanelWidth(): number {
	return useSyncExternalStore(
		subscribeWorkflowPanelWidth,
		workflowPanelWidth,
		() => WORKFLOW_PANEL_WIDTH,
	);
}

/**
 * How the expanded panel shows step notes, kept exactly as the collapse
 * choice is: one device-local choice for every terminal, never sent to a
 * server, never part of a template, and separate from Home's Workflows view.
 */
export const WORKFLOW_PANEL_NOTES_STORAGE_KEY = 'terminay.workflowPanelNotes.v1';

const notesListeners = new Set<() => void>();
let currentNotes: WorkflowPanelNotes | undefined;

/** A stored density is used only when it is one of the three. */
function parseStoredNotes(raw: string | null | undefined): WorkflowPanelNotes {
	return (WORKFLOW_PANEL_NOTES as readonly (string | null | undefined)[]).includes(raw)
		? (raw as WorkflowPanelNotes)
		: 'full';
}

function readNotes(): WorkflowPanelNotes {
	if (currentNotes !== undefined) return currentNotes;
	try {
		currentNotes = parseStoredNotes(
			globalThis.localStorage?.getItem(WORKFLOW_PANEL_NOTES_STORAGE_KEY),
		);
	} catch {
		currentNotes = 'full';
	}
	return currentNotes;
}

export function workflowPanelNotes(): WorkflowPanelNotes {
	return readNotes();
}

export function setWorkflowPanelNotes(next: WorkflowPanelNotes): void {
	const notes = parseStoredNotes(next);
	if (readNotes() === notes) return;
	currentNotes = notes;
	try {
		globalThis.localStorage?.setItem(WORKFLOW_PANEL_NOTES_STORAGE_KEY, notes);
	} catch {
		// Storage may be unavailable; the choice still holds for this session.
	}
	for (const listener of [...notesListeners]) listener();
}

export function subscribeWorkflowPanelNotes(listener: () => void): () => void {
	notesListeners.add(listener);
	// Another window of this device changing it changes it here too.
	const onStorage = (event: StorageEvent) => {
		if (event.key !== WORKFLOW_PANEL_NOTES_STORAGE_KEY) return;
		currentNotes = undefined;
		listener();
	};
	globalThis.addEventListener?.('storage', onStorage);
	return () => {
		notesListeners.delete(listener);
		globalThis.removeEventListener?.('storage', onStorage);
	};
}

export function useWorkflowPanelNotes(): WorkflowPanelNotes {
	return useSyncExternalStore(
		subscribeWorkflowPanelNotes,
		workflowPanelNotes,
		() => 'full',
	);
}

/**
 * A device-local choice of one of `values`, kept exactly as the collapse
 * choice is: shared by every terminal and window of this device through
 * storage, never sent to a server, and read as `fallback` when the stored
 * value is unreadable or unknown.
 */
function deviceChoice<T extends string>(
	key: string,
	values: readonly T[],
	fallback: T,
) {
	const listeners = new Set<() => void>();
	let current: T | undefined;
	const parse = (raw: string | null | undefined): T =>
		(values as readonly (string | null | undefined)[]).includes(raw)
			? (raw as T)
			: fallback;
	const read = (): T => {
		if (current !== undefined) return current;
		try {
			current = parse(globalThis.localStorage?.getItem(key));
		} catch {
			current = fallback;
		}
		return current;
	};
	const set = (next: T): void => {
		const value = parse(next);
		if (read() === value) return;
		current = value;
		try {
			globalThis.localStorage?.setItem(key, value);
		} catch {
			// Storage may be unavailable; the choice still holds for this session.
		}
		for (const listener of [...listeners]) listener();
	};
	const subscribe = (listener: () => void): (() => void) => {
		listeners.add(listener);
		const onStorage = (event: StorageEvent) => {
			if (event.key !== key) return;
			current = undefined;
			listener();
		};
		globalThis.addEventListener?.('storage', onStorage);
		return () => {
			listeners.delete(listener);
			globalThis.removeEventListener?.('storage', onStorage);
		};
	};
	const use = (): T => useSyncExternalStore(subscribe, read, () => fallback);
	return { read, set, subscribe, use };
}

/**
 * Whether workflows show as the vertical panel at a pane's right edge or the
 * horizontal drawer along its bottom (ADR-0128). Vertical until chosen.
 */
export type WorkflowLayout = 'vertical' | 'horizontal';
export const WORKFLOW_LAYOUT_STORAGE_KEY = 'terminay.workflowLayout.v1';
const layoutChoice = deviceChoice<WorkflowLayout>(
	WORKFLOW_LAYOUT_STORAGE_KEY,
	['vertical', 'horizontal'],
	'vertical',
);
export const workflowLayout = layoutChoice.read;
export const setWorkflowLayout = layoutChoice.set;
export const subscribeWorkflowLayout = layoutChoice.subscribe;
export const useWorkflowLayout = layoutChoice.use;

/**
 * Whether the horizontal drawer shows collapsed or expanded: its own choice,
 * apart from the vertical panel's. Collapsed until the user expands it.
 */
export const WORKFLOW_DRAWER_STORAGE_KEY = 'terminay.workflowDrawer.v1';
const drawerChoice = deviceChoice<WorkflowPanelSetting>(
	WORKFLOW_DRAWER_STORAGE_KEY,
	['collapsed', 'expanded'],
	'collapsed',
);
export const workflowDrawerSetting = drawerChoice.read;
export const setWorkflowDrawerSetting = drawerChoice.set;
export const subscribeWorkflowDrawerSetting = drawerChoice.subscribe;
export const useWorkflowDrawerSetting = drawerChoice.use;
