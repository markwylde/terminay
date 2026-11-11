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
	WORKFLOW_PANEL_WIDTH,
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
