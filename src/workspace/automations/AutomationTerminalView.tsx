/**
 * The automation space's terminals, as real terminals.
 *
 * The automation space is a reserved project that no project tab ever shows,
 * so this is its only renderer. It mounts the same `TerminalPanel` a project
 * uses, inside its own Dockview, bound to the space's project on the owning
 * connection — so the terminals attach, focus, take input, and close exactly
 * as project terminals do.
 */

import {
	type DockviewApi,
	DockviewReact,
	type DockviewReadyEvent,
} from 'dockview';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
	TerminalPanel,
	TerminalPanelClientContext,
} from '../../components/TerminalPanel';
import type { TerminalPanelParams } from '../../components/TerminalTab';
import type { WorkspaceConnectionContext } from '../../shared/connections/connectionRegistry';
import { composeProjectTerminalClientContext } from '../../shared/projectTerminalClientContext';
import type { AutomationSpaceTerminal } from './automationsModel';

const AUTOMATION_TERMINAL_COLOR = '#5b6b82';

export type AutomationTerminalViewProps = Readonly<{
	context: WorkspaceConnectionContext;
	serverId: string;
	projectId: string;
	projectRoot: string;
	terminals: readonly AutomationSpaceTerminal[];
	selectedPanelId?: string;
	onSelect: (panelId: string) => void;
	/** A person closed a terminal's tab: close it on the server. */
	onClose: (panelId: string) => void;
}>;

export function AutomationTerminalView({
	context,
	onClose,
	onSelect,
	projectId,
	projectRoot,
	selectedPanelId,
	serverId,
	terminals,
}: AutomationTerminalViewProps) {
	const apiRef = useRef<DockviewApi | null>(null);
	// Panels this view removes to follow the server are not a person closing
	// them, and neither is Dockview disposing everything on unmount or reload.
	const followingRef = useRef(new Set<string>());
	const detachingRef = useRef(false);
	const callbacksRef = useRef({ onClose, onSelect });
	callbacksRef.current = { onClose, onSelect };
	const terminalsRef = useRef(terminals);
	terminalsRef.current = terminals;
	const components = useMemo(() => ({ terminal: TerminalPanel }), []);
	const clientContext = useMemo(
		() => composeProjectTerminalClientContext(context, projectId, projectRoot),
		[context, projectId, projectRoot],
	);

	const sync = useCallback(() => {
		const api = apiRef.current;
		if (api === null) return;
		const wanted = new Map(
			terminalsRef.current.map((terminal) => [terminal.panelId, terminal]),
		);
		for (const panel of [...api.panels]) {
			if (wanted.has(panel.id)) continue;
			followingRef.current.add(panel.id);
			api.removePanel(panel);
			followingRef.current.delete(panel.id);
		}
		for (const terminal of wanted.values()) {
			const existing = api.getPanel(terminal.panelId);
			if (existing !== undefined) {
				if (
					(existing.params as TerminalPanelParams | undefined)
						?.terminalSessionStatus !== terminal.status
				)
					existing.api.updateParameters({
						terminalSessionStatus: terminal.status,
					});
				if (existing.title !== terminal.title)
					existing.api.setTitle(terminal.title);
				continue;
			}
			api.addPanel<TerminalPanelParams>({
				component: 'terminal',
				id: terminal.panelId,
				inactive: api.activePanel !== undefined,
				title: terminal.title,
				params: {
					activityIndicatorsEnabled: false,
					color: AUTOMATION_TERMINAL_COLOR,
					emoji: '',
					inheritsProjectColor: false,
					isFocused: false,
					recordingStatus: 'idle',
					sessionId: terminal.sessionId,
					terminalActivityState: 'viewed',
					terminalClientFromPosition: 0,
					terminalClientIdentity: { projectId, serverId },
					terminalSessionStatus: terminal.status,
				},
			});
		}
	}, [projectId, serverId]);

	const handleReady = useCallback(
		(event: DockviewReadyEvent) => {
			apiRef.current = event.api;
			event.api.onDidRemovePanel((panel) => {
				if (detachingRef.current || followingRef.current.has(panel.id)) return;
				callbacksRef.current.onClose(panel.id);
			});
			event.api.onDidActivePanelChange((panel) => {
				if (panel !== undefined) callbacksRef.current.onSelect(panel.id);
			});
			sync();
		},
		[sync],
	);

	useEffect(() => {
		sync();
	}, [sync, terminals]);

	useEffect(() => {
		if (selectedPanelId === undefined) return;
		const panel = apiRef.current?.getPanel(selectedPanelId);
		if (panel === undefined || panel.api.isActive) return;
		panel.api.setActive();
	}, [selectedPanelId, terminals]);

	useEffect(() => {
		const markDetaching = () => {
			detachingRef.current = true;
		};
		window.addEventListener('beforeunload', markDetaching);
		window.addEventListener('pagehide', markDetaching);
		return () => {
			// Runs before Dockview disposes its panels on unmount.
			detachingRef.current = true;
			window.removeEventListener('beforeunload', markDetaching);
			window.removeEventListener('pagehide', markDetaching);
		};
	}, []);

	return (
		<div
			className="home-automations__terminal-view workspace dockview-theme-dark"
			data-terminay-automation-terminal-view="true"
		>
			<TerminalPanelClientContext.Provider value={clientContext}>
				<DockviewReact components={components} onReady={handleReady} />
			</TerminalPanelClientContext.Provider>
		</div>
	);
}
