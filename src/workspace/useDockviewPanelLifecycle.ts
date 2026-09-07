import type { DockviewApi, DockviewReadyEvent } from 'dockview';
import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
} from 'react';
import { rememberActiveSession } from './localViewState';

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
	/** Scopes this device's remembered tab to the project it belongs to. */
	projectId: string;
	publishWorkspaceInventory: () => void;
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
	const rendererUnloadingRef = useRef(false);
	optionsRef.current = options;

	useEffect(() => {
		const markRendererUnloading = () => {
			rendererUnloadingRef.current = true;
		};
		window.addEventListener('beforeunload', markRendererUnloading);
		window.addEventListener('pagehide', markRendererUnloading);
		return () => {
			window.removeEventListener('beforeunload', markRendererUnloading);
			window.removeEventListener('pagehide', markRendererUnloading);
		};
	}, []);

	const handleReady = useCallback((event: DockviewReadyEvent) => {
		const current = optionsRef.current;
		current.apiRef.current = event.api;
		current.setIsDockviewReady(true);

		event.api.onDidRemovePanel((panel) => {
			// Dockview disposes its panels while the whole renderer is reloading or
			// closing. That is a client detach, not an intent to delete canonical
			// panels or terminate their server-owned sessions.
			if (rendererUnloadingRef.current) return;
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
			window.requestAnimationFrame(latest.publishWorkspaceInventory);
		});

		event.api.onDidActivePanelChange(() => {
			const latest = optionsRef.current;
			latest.syncPanelFocusState();
			const sessionId = event.api.activePanel?.params?.sessionId;
			if (typeof sessionId === 'string' && sessionId.length > 0) {
				latest.focusedSessionIdRef.current = sessionId;
				latest.setFocusedSessionId(sessionId);
				// Do not acknowledge here: activating a project also makes its last
				// panel Dockview-active. Tab click, xterm click, and typing ack.
				// This device's own choice, kept on this device so a reconnect
				// restores the tab this user was on rather than another device's.
				rememberActiveSession(latest.projectId, sessionId);
			}
		});

		event.api.onDidAddPanel(() => {
			if (rendererUnloadingRef.current) return;
			window.requestAnimationFrame(optionsRef.current.publishWorkspaceInventory);
		});

		event.api.onDidMovePanel((move) => {
			const latest = optionsRef.current;
			// Moving a panel changes the order the inventory reports, whether it was
			// a tab reorder or a change of split geometry.
			window.requestAnimationFrame(latest.publishWorkspaceInventory);
			// A cross-group move changes split geometry and is not a tab reorder.
			if (move.panel.group.id !== move.from.id) return;
			const panelIds = event.api.groups.flatMap((group) =>
				group.panels.map((panel) => panel.id),
			);
			latest.commitPanelOrder?.(panelIds);
		});
	}, []);

	return handleReady;
}
