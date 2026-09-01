import type { DockviewApi } from 'dockview';
import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useCallback,
	useRef,
} from 'react';
import type {
	TerminalContextReader,
	TerminalPanelParams,
	TerminalTabMacroRun,
	TerminalTabMoveProject,
} from '../components/TerminalTab';
import { recordBootstrapDiagnostic } from '../shared/rendererDiagnostics';
import {
	recallActiveSession,
	shouldActivateAdoptedTerminal,
} from './localViewState';
import {
	getServerTerminalPresentationTitle,
	type MovedTerminalTab,
} from './terminalTransferOrchestration';

type ProjectIdentity = {
	color: string;
	emoji: string;
	id: string;
	title: string;
};

type UseTerminalAdoptionControllerOptions = {
	apiRef: MutableRefObject<DockviewApi | null>;
	cancelMacroRun: (runId: string) => void;
	clearFinishedMacroRuns: (sessionId: string) => void;
	clearMacroRun: (sessionId: string, runId: string) => void;
	getProjectsForMove: () => TerminalTabMoveProject[];
	hydrateRecording: (sessionId: string) => void;
	onError: (message: string | null) => void;
	onMoveToProject: (
		sourceProjectId: string,
		panelId: string,
		targetProjectId: string,
	) => void;
	panelSessionsRef: MutableRefObject<Map<string, string>>;
	project: ProjectIdentity;
	publishActivityOverview: () => void;
	registerTerminalContextReader: (
		sessionId: string,
		reader: TerminalContextReader,
	) => () => void;
	replaceMacroRuns: (sessionId: string, runs: TerminalTabMacroRun[]) => void;
	revealRecording: (recordingId: string) => Promise<unknown>;
	setFocusedSessionId: Dispatch<SetStateAction<string | null>>;
	showActiveTabActivityIndicator: boolean;
	showFinishedTabActivityIndicator: boolean;
	startRecording: (sessionId: string) => Promise<unknown>;
	stopRecording: (sessionId: string) => Promise<unknown>;
	syncPanelFocusState: () => void;
	terminalCounterRef: MutableRefObject<number>;
	terminalServerIdentity: { serverId: string } | null;
};

export function useTerminalAdoptionController({
	apiRef,
	cancelMacroRun,
	clearFinishedMacroRuns,
	clearMacroRun,
	getProjectsForMove,
	hydrateRecording,
	onError,
	onMoveToProject,
	panelSessionsRef,
	project,
	publishActivityOverview,
	registerTerminalContextReader,
	replaceMacroRuns,
	revealRecording,
	setFocusedSessionId,
	showActiveTabActivityIndicator,
	showFinishedTabActivityIndicator,
	startRecording,
	stopRecording,
	syncPanelFocusState,
	terminalCounterRef,
	terminalServerIdentity,
}: UseTerminalAdoptionControllerOptions) {
	/**
	 * The tab this device was on, read once and consumed once.
	 *
	 * It cannot be re-read per adoption. Restoring a workspace adopts terminals
	 * one at a time, and the first one activates itself because nothing is
	 * selected yet — which records *it* as this device's choice and erases the
	 * very session being restored, before that session's panel is adopted. The
	 * memory has to be taken before any of that happens.
	 *
	 * `null` means not yet read; `undefined` means read and nothing remembered.
	 */
	const rememberedSessionRef = useRef<string | null | undefined>(null);
	/**
	 * Adopt a terminal into this project's Dockview.
	 *
	 * `activate` is what separates a workspace fact from a view decision. A tab
	 * dragged here by this user is a local action and should land focused. A
	 * terminal that merely appeared because another device created it is not:
	 * stealing the active tab for it drags this device off whatever it was
	 * reading. The device that created a terminal focuses it itself, through
	 * the creation controller, once the panel exists.
	 */
	const acceptMovedTerminal = useCallback(
		(movedTerminal: MovedTerminalTab, { activate = true } = {}) => {
			recordBootstrapDiagnostic('app.workspace.adopt.begin');
			const api = apiRef.current;
			if (
				[...panelSessionsRef.current.values()].includes(movedTerminal.sessionId)
			) {
				return true;
			}

			if (!api) {
				return false;
			}

			terminalCounterRef.current += 1;
			const panelId =
				movedTerminal.panelId ?? `terminal-${terminalCounterRef.current}`;
			const inheritsProjectColor = movedTerminal.inheritsProjectColor === true;
			const color = inheritsProjectColor
				? project.color
				: (movedTerminal.color ?? project.color);
			const macroRuns = movedTerminal.macroRuns ?? [];

			// Dockview activates a newly added panel unless told otherwise, so
			// declining to call setActive() below is not enough on its own.
			if (rememberedSessionRef.current === null)
				rememberedSessionRef.current = recallActiveSession(project.id);
			const rememberedSessionId = rememberedSessionRef.current ?? undefined;
			const activatePanel = shouldActivateAdoptedTerminal({
				requestedLocally: activate,
				hasActivePanel: api.activePanel !== undefined,
				rememberedSessionId,
				sessionId: movedTerminal.sessionId,
			});
			// Spent once. A restored selection must not be able to pull focus back
			// from a terminal the user has since chosen.
			if (rememberedSessionId === movedTerminal.sessionId)
				rememberedSessionRef.current = undefined;
			recordBootstrapDiagnostic('app.workspace.adopt.before-add-panel');
			const panel = api.addPanel<TerminalPanelParams>({
				component: 'terminal',
				id: panelId,
				inactive: !activatePanel,
				params: {
					activityIndicatorsEnabled:
						movedTerminal.activityIndicatorsEnabled !== false,
					color,
					emoji: movedTerminal.emoji ?? '',
					inheritsProjectColor,
					isFocused: false,
					macroRuns,
					onCancelMacroRun: cancelMacroRun,
					onClearFinishedMacroRuns: () =>
						clearFinishedMacroRuns(movedTerminal.sessionId),
					onClearMacroRun: (runId) =>
						clearMacroRun(movedTerminal.sessionId, runId),
					onMoveToProject: (targetProjectId) =>
						onMoveToProject(project.id, panelId, targetProjectId),
					onRevealRecording: (recordingId) => void revealRecording(recordingId),
					onStartRecording: () => void startRecording(movedTerminal.sessionId),
					onStopRecording: () => void stopRecording(movedTerminal.sessionId),
					onUpdateNote: (terminalNote) =>
						apiRef.current
							?.getPanel(panelId)
							?.api.updateParameters({ terminalNote }),
					projectColor: project.color,
					projectsForMove: getProjectsForMove(),
					recordingError: movedTerminal.recordingError,
					recordingId: movedTerminal.recordingId,
					recordingStatus: movedTerminal.recordingStatus ?? 'idle',
					registerTerminalContextReader,
					cwd: movedTerminal.cwd,
					sessionId: movedTerminal.sessionId,
					showActiveTabActivityIndicator:
						movedTerminal.showActiveTabActivityIndicator ??
						showActiveTabActivityIndicator,
					showFinishedTabActivityIndicator:
						movedTerminal.showFinishedTabActivityIndicator ??
						showFinishedTabActivityIndicator,
					terminalActivityState:
						movedTerminal.terminalActivityState ?? 'viewed',
					terminalClientFromPosition: 0,
					terminalSessionStatus: movedTerminal.terminalSessionStatus,
					terminalClientIdentity:
						terminalServerIdentity && movedTerminal.serverProjectId
							? {
									projectId: movedTerminal.serverProjectId,
									serverId: terminalServerIdentity.serverId,
								}
							: undefined,
					terminalNote: movedTerminal.terminalNote,
				},
				tabComponent: 'terminalTab',
				title: movedTerminal.title,
			});
			recordBootstrapDiagnostic('app.workspace.adopt.after-add-panel');

			panelSessionsRef.current.set(panel.id, movedTerminal.sessionId);
			if (macroRuns.length > 0) {
				replaceMacroRuns(movedTerminal.sessionId, macroRuns);
			}
			hydrateRecording(movedTerminal.sessionId);
			if (activatePanel) {
				recordBootstrapDiagnostic('app.workspace.adopt.before-activate');
				panel.api.setActive();
				setFocusedSessionId(movedTerminal.sessionId);
			}
			onError(null);
			syncPanelFocusState();
			window.requestAnimationFrame(publishActivityOverview);
			recordBootstrapDiagnostic('app.workspace.adopt.end');
			return true;
		},
		[
			apiRef,
			cancelMacroRun,
			clearFinishedMacroRuns,
			clearMacroRun,
			getProjectsForMove,
			hydrateRecording,
			onError,
			onMoveToProject,
			panelSessionsRef,
			project,
			publishActivityOverview,
			registerTerminalContextReader,
			replaceMacroRuns,
			revealRecording,
			setFocusedSessionId,
			showActiveTabActivityIndicator,
			showFinishedTabActivityIndicator,
			startRecording,
			stopRecording,
			syncPanelFocusState,
			terminalCounterRef,
			terminalServerIdentity,
		],
	);

	const acceptServerTerminal = useCallback(
		(
			panelId: string,
			sessionId: string,
			title?: string,
			cwd?: string,
			terminalSessionStatus?: 'running' | 'exited' | 'interrupted',
		) => {
			if ([...panelSessionsRef.current.values()].includes(sessionId)) {
				const existingPanelId = [...panelSessionsRef.current.entries()].find(
					([, mappedSessionId]) => mappedSessionId === sessionId,
				)?.[0];
				const existingPanel =
					existingPanelId === undefined
						? undefined
						: apiRef.current?.getPanel(existingPanelId);
				if (
					existingPanel !== undefined &&
					terminalSessionStatus !== undefined &&
					existingPanel.params?.terminalSessionStatus !== terminalSessionStatus
				) {
					existingPanel.api.updateParameters({ terminalSessionStatus });
				}
				return true;
			}
			return acceptMovedTerminal({
				inheritsProjectColor: true,
				cwd,
				panelId,
				serverProjectId: project.id,
				sessionId,
				terminalSessionStatus,
				title: getServerTerminalPresentationTitle(
					title,
					terminalCounterRef.current + 1,
				),
			}, { activate: false });
		},
		[acceptMovedTerminal, panelSessionsRef, project.id, terminalCounterRef],
	);

	return { acceptMovedTerminal, acceptServerTerminal };
}
