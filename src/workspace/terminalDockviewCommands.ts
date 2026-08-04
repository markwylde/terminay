import type { DockviewApi } from 'dockview';

export type DockviewPanel = NonNullable<ReturnType<DockviewApi['getPanel']>>;

export function getActiveTerminalSessionId(api: DockviewApi | null): string | null {
	return api?.activePanel?.params?.sessionId ?? null;
}

export function findTerminalPanel(
	api: DockviewApi | null,
	panelSessions: ReadonlyMap<string, string>,
	sessionId: string,
): DockviewPanel | null {
	if (!api) {
		return null;
	}
	for (const [panelId, panelSessionId] of panelSessions) {
		if (panelSessionId === sessionId) {
			return api.getPanel(panelId) ?? null;
		}
	}
	return null;
}

export function findTerminalFocusTarget(options: {
	api: DockviewApi | null;
	focusedSessionId: string | null;
	panelSessions: ReadonlyMap<string, string>;
}): DockviewPanel | null {
	const { api } = options;
	const activePanel = api?.activePanel ?? null;
	// Deliberately preserve focus on active file/folder panels.
	if (activePanel && !activePanel.params?.sessionId) {
		return null;
	}
	if (activePanel?.params?.sessionId) {
		return activePanel;
	}
	if (options.focusedSessionId) {
		const focused = findTerminalPanel(
			api,
			options.panelSessions,
			options.focusedSessionId,
		);
		if (focused) {
			return focused;
		}
	}
	for (const group of api?.groups ?? []) {
		if (group.activePanel?.params?.sessionId) {
			return group.activePanel;
		}
		const terminal = group.panels.find((panel) => panel.params?.sessionId);
		if (terminal) {
			return terminal;
		}
	}
	return null;
}

export function activateTerminalPanel(options: {
	api: DockviewApi | null;
	panelId: string;
	sessionId: string;
}): DockviewPanel | null {
	const panel = options.api?.getPanel(options.panelId);
	if (!panel || panel.params?.sessionId !== options.sessionId) {
		return null;
	}
	panel.api.setActive();
	return panel;
}

export function closeActiveDockviewPanel(options: {
	api: DockviewApi | null;
	onCloseLastPanel: () => void;
}): void {
	const activePanel = options.api?.activePanel;
	if (!activePanel) {
		return;
	}
	if (options.api?.panels.length === 1) {
		options.onCloseLastPanel();
		return;
	}
	activePanel.api.close();
}

export async function saveActiveDockviewPanel(options: {
	api: DockviewApi | null;
	onError: (message: string) => void;
	onSaved: () => void;
}): Promise<void> {
	const save = options.api?.activePanel?.params?.onSave;
	if (typeof save !== 'function') {
		return;
	}
	try {
		if (await save()) {
			options.onSaved();
		}
	} catch (error) {
		options.onError(error instanceof Error ? error.message : String(error));
	}
}

export async function popoutActiveDockviewPanel(options: {
	api: DockviewApi | null;
	popoutUrl: string;
}): Promise<void> {
	const activePanel = options.api?.activePanel;
	if (!options.api || !activePanel) {
		return;
	}
	await options.api.addPopoutGroup(activePanel, {
		popoutUrl: options.popoutUrl,
	});
}
