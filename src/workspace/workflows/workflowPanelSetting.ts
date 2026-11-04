/**
 * Whether workflow panels show collapsed or expanded. One device-local
 * choice for every terminal on this device; never sent to a server and
 * never part of a template (ADR-0097).
 */

import { useSyncExternalStore } from 'react';

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
