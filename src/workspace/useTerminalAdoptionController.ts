import type { DockviewApi } from 'dockview';
import {
	type Dispatch,
	type MutableRefObject,
	type SetStateAction,
	useCallback,
} from 'react';
import { recordBootstrapDiagnostic } from '../shared/rendererDiagnostics';
import type {
	TerminalContextReader,
	TerminalPanelParams,
	TerminalTabMacroRun,
	TerminalTabMoveProject,
} from '../components/TerminalTab';
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
	replaceMacroRuns: (
		sessionId: string,
		runs: TerminalTabMacroRun[],
	) => void;
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
	const acceptMovedTerminal = useCallback(
		(movedTerminal: MovedTerminalTab) => {
			recordBootstrapDiagnostic('app.workspace.adopt.begin');
			const api = apiRef.current;
			if (
				[...panelSessionsRef.current.values()].includes(
					movedTerminal.sessionId,
				)
			) {
				return true;
			}

			if (!api) {
				return false;
			}

			terminalCounterRef.current += 1;
			const panelId = movedTerminal.panelId ?? `terminal-${terminalCounterRef.current}`;
			const inheritsProjectColor = movedTerminal.inheritsProjectColor === true;
			const color = inheritsProjectColor
				? project.color
				: (movedTerminal.color ?? project.color);
			const macroRuns = movedTerminal.macroRuns ?? [];

			recordBootstrapDiagnostic(
				'app.workspace.adopt.before-add-panel',
			);
			const panel = api.addPanel<TerminalPanelParams>({
				component: 'terminal',
				id: panelId,
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
					onRevealRecording: (recordingId) =>
						void revealRecording(recordingId),
					onStartRecording: () =>
						void startRecording(movedTerminal.sessionId),
					onStopRecording: () =>
						void stopRecording(movedTerminal.sessionId),
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
			recordBootstrapDiagnostic(
				'app.workspace.adopt.after-add-panel',
			);

			panelSessionsRef.current.set(panel.id, movedTerminal.sessionId);
			if (macroRuns.length > 0) {
				replaceMacroRuns(movedTerminal.sessionId, macroRuns);
			}
			hydrateRecording(movedTerminal.sessionId);
			recordBootstrapDiagnostic(
				'app.workspace.adopt.before-activate',
			);
			panel.api.setActive();
			setFocusedSessionId(movedTerminal.sessionId);
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
		(panelId: string, sessionId: string, title?: string, cwd?: string) => {
			if (
				[...panelSessionsRef.current.values()].includes(sessionId)
			) {
				return true;
			}
			return acceptMovedTerminal({
				inheritsProjectColor: true,
				cwd,
				panelId,
				serverProjectId: project.id,
				sessionId,
				title: getServerTerminalPresentationTitle(
					title,
					terminalCounterRef.current + 1,
				),
			});
		},
		[
			acceptMovedTerminal,
			panelSessionsRef,
			project.id,
			terminalCounterRef,
		],
	);

	return { acceptMovedTerminal, acceptServerTerminal };
}
