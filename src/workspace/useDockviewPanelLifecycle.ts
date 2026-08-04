import type { DockviewApi, DockviewReadyEvent } from 'dockview';
import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useCallback,
	useRef,
} from 'react';

type LifecycleOptions = {
	apiRef: MutableRefObject<DockviewApi | null>;
	cancelMacroRunsForSession: (sessionId: string) => void;
	clearActivitySession: (sessionId: string) => void;
	clearMacroRunsForSession: (sessionId: string) => void;
	closeServerPanel?: (panelId: string) => void;
	commitPanelOrder?: (panelIds: readonly string[]) => void;
	filePathPanelMapRef: MutableRefObject<Map<string, string>>;
	focusedSessionIdRef: MutableRefObject<string | null>;
	folderPathPanelMapRef: MutableRefObject<Map<string, string>>;
	markTerminalActivityViewed: (sessionId: string) => void;
	movingTerminalSessionIdsRef: MutableRefObject<Set<string>>;
	panelSessionMapRef: MutableRefObject<Map<string, string>>;
	publishTerminalActivityOverview: () => void;
	setFocusedSessionId: Dispatch<SetStateAction<string | null>>;
	setIsDockviewReady: Dispatch<SetStateAction<boolean>>;
	syncPanelFocusState: () => void;
	terminalActivityTimersRef: MutableRefObject<Map<string, number>>;
};

function removePanelMapping(
	panelId: string,
	panelMap: MutableRefObject<Map<string, string>>,
) {
	for (const [resourcePath, candidatePanelId] of panelMap.current) {
		if (candidatePanelId === panelId) {
			panelMap.current.delete(resourcePath);
			return;
		}
	}
}

/**
 * Owns Dockview's imperative lifecycle subscription boundary. Consumers retain
 * feature callbacks, while panel registry cleanup and stable adapter identity
 * stay out of their render orchestration.
 */
export function useDockviewPanelLifecycle(options: LifecycleOptions) {
	const optionsRef = useRef(options);
	optionsRef.current = options;

	const handleReady = useCallback((event: DockviewReadyEvent) => {
		const current = optionsRef.current;
		current.apiRef.current = event.api;
		current.setIsDockviewReady(true);

		event.api.onDidRemovePanel((panel) => {
			const latest = optionsRef.current;
			const sessionId = latest.panelSessionMapRef.current.get(panel.id);
			if (!sessionId) {
				removePanelMapping(panel.id, latest.filePathPanelMapRef);
				removePanelMapping(panel.id, latest.folderPathPanelMapRef);
				latest.closeServerPanel?.(panel.id);
				return;
			}

			latest.panelSessionMapRef.current.delete(panel.id);
			const isMoving =
				latest.movingTerminalSessionIdsRef.current.delete(sessionId);
			const timer = latest.terminalActivityTimersRef.current.get(sessionId);
			if (timer !== undefined) {
				window.clearTimeout(timer);
				latest.terminalActivityTimersRef.current.delete(sessionId);
			}
			latest.clearActivitySession(sessionId);
			latest.clearMacroRunsForSession(sessionId);
			latest.setFocusedSessionId((focused) =>
				focused === sessionId
					? (event.api.activePanel?.params?.sessionId ?? null)
					: focused,
			);
			if (!isMoving) latest.cancelMacroRunsForSession(sessionId);
			if (!isMoving) latest.closeServerPanel?.(panel.id);
			window.requestAnimationFrame(latest.publishTerminalActivityOverview);
		});

		event.api.onDidActivePanelChange(() => {
			const latest = optionsRef.current;
			latest.syncPanelFocusState();
			const sessionId = event.api.activePanel?.params?.sessionId;
			if (typeof sessionId === 'string' && sessionId.length > 0) {
				latest.focusedSessionIdRef.current = sessionId;
				latest.setFocusedSessionId(sessionId);
				latest.markTerminalActivityViewed(sessionId);
			}
		});

		event.api.onDidMovePanel((move) => {
			// A cross-group move changes split geometry and is not a tab reorder.
			if (move.panel.group.id !== move.from.id) return;
			const latest = optionsRef.current;
			const panelIds = event.api.groups.flatMap((group) =>
				group.panels.map((panel) => panel.id),
			);
			latest.commitPanelOrder?.(panelIds);
		});
	}, []);

	return handleReady;
}
