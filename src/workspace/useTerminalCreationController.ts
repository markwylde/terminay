import type { Direction, DockviewApi, DockviewGroupPanel } from 'dockview';
import { type MutableRefObject, useCallback } from 'react';
import { releaseCreatedTerminalChromeFocus } from '../components/terminalFocusInteraction';
import { recordBootstrapDiagnostic } from '../shared/rendererDiagnostics';

type SplitDirection = Extract<Direction, 'below' | 'right'>;

export type AddTerminalOptions = {
	cwd?: string | null;
	profileId?: string;
	direction?: SplitDirection;
	groupId?: string;
	initialInput?: string;
	title?: string;
};

type CreatedTerminalPresentation = {
	panelId: string;
	sessionId: string;
	title: string;
};

export function formatTerminalInitialInput(text: string): string {
	if (!/[\r\n]/.test(text)) {
		return text;
	}
	return `\x1b[200~${text.replace(/\r\n?/g, '\n')}\x1b[201~`;
}

export function scheduleCreatedTerminalFocus(sessionId: string): void {
	const announce = () => {
		releaseCreatedTerminalChromeFocus(
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null,
		);
		window.dispatchEvent(
			new CustomEvent('terminay-focus-terminal', {
				detail: { sessionId },
			}),
		);
	};
	announce();
	window.requestAnimationFrame(() => {
		announce();
		window.requestAnimationFrame(announce);
	});
	window.setTimeout(announce, 50);
}

type UseTerminalCreationControllerOptions = {
	apiRef: MutableRefObject<DockviewApi | null>;
	createSession:
		| ((request: {
				activePanelId?: string;
				cwd?: string;
				profileId?: string;
				projectId: string;
		  }) => Promise<{ sessionId: string }>)
		| null;
	hydrateRecording: (sessionId: string) => void;
	onError: (message: string | null) => void;
	projectId: string;
	recordNewTerminals: boolean;
	sendInput: (sessionId: string, data: string) => void;
	startRecording: (sessionId: string) => Promise<unknown>;
	splitPanel?: (request: {
		projectId: string;
		panelId: string;
		direction: 'horizontal' | 'vertical';
	}) => Promise<void>;
	suppressInitialActivity: (sessionId: string) => void;
	waitForCreatedTerminal?: (sessionId: string) => Promise<boolean>;
};

async function activateCreatedTerminalPresentation(
	apiRef: MutableRefObject<DockviewApi | null>,
	sessionId: string,
	placement?: {
		direction: SplitDirection;
		referenceGroup: DockviewGroupPanel;
	},
): Promise<{ panelId: string; title: string } | null> {
	return await new Promise<{ panelId: string; title: string } | null>(
		(resolve) => {
			const startedAt = performance.now();
			const inspect = () => {
				const panel = apiRef.current?.panels.find(
					(candidate) => candidate.params?.sessionId === sessionId,
				);
				if (panel) {
					if (placement !== undefined) {
						panel.api.moveTo({
							group: placement.referenceGroup,
							position: placement.direction === 'below' ? 'bottom' : 'right',
						});
					}
					panel.api.setActive();
					// Dockview publishes its active-panel CSS/visibility state on the
					// following render frame. Focus only after that contract is in the
					// DOM so xterm can actually take the caret from the creating control.
					window.requestAnimationFrame(() => {
						window.requestAnimationFrame(() => {
							scheduleCreatedTerminalFocus(sessionId);
							resolve({
								panelId: panel.id,
								title: panel.title ?? 'Terminal',
							});
						});
					});
					return;
				}
				if (performance.now() - startedAt >= 1_000) {
					resolve(null);
					return;
				}
				window.requestAnimationFrame(inspect);
			};
			inspect();
		},
	);
}

export function useTerminalCreationController({
	apiRef,
	createSession,
	hydrateRecording,
	onError,
	projectId,
	recordNewTerminals,
	sendInput,
	startRecording,
	splitPanel,
	suppressInitialActivity,
	waitForCreatedTerminal,
}: UseTerminalCreationControllerOptions) {
	return useCallback(
		async (
			options?: AddTerminalOptions,
		): Promise<CreatedTerminalPresentation | null> => {
			const activePanel = apiRef.current?.activePanel;
			const splitPlacement =
				options?.direction === undefined ||
				apiRef.current?.activePanel === undefined
					? undefined
					: {
							direction: options.direction,
							referenceGroup: apiRef.current.activePanel.group,
						};
			if (!apiRef.current) {
				return null;
			}

			try {
				if (!createSession) {
					throw new Error('The server terminal client is unavailable.');
				}

				const { sessionId } = await createSession({
					projectId,
					...(activePanel === undefined
						? {}
						: { activePanelId: activePanel.id }),
					...(typeof options?.cwd === 'string' && options.cwd.length > 0
						? { cwd: options.cwd }
						: {}),
					...(options?.profileId === undefined
						? {}
						: { profileId: options.profileId }),
				});
				suppressInitialActivity(sessionId);
				recordBootstrapDiagnostic('app.workspace.create.await-delta');
				if (options?.initialInput) {
					const initialInput = options.initialInput;
					window.setTimeout(() => {
						sendInput(sessionId, formatTerminalInitialInput(initialInput));
						sendInput(sessionId, '\r');
					}, 900);
				}
				if (recordNewTerminals) {
					void startRecording(sessionId);
				} else {
					hydrateRecording(sessionId);
				}
				// The server delta owns presentation creation. Do not resolve the
				// command until that exact presentation has arrived and is active;
				// callers must never observe the previously active terminal as the
				// result of a completed "new terminal" command.
				const didSynchronize = await waitForCreatedTerminal?.(sessionId);
				if (didSynchronize === false) {
					throw new Error(
						'Server did not publish a terminal panel for the created session.',
					);
				}
				if (options?.direction !== undefined && splitPanel !== undefined) {
					await splitPanel({
						projectId,
						panelId: `p:${sessionId}`.slice(0, 128),
						direction:
							options.direction === 'below' ? 'vertical' : 'horizontal',
					});
				}
				const presented = await activateCreatedTerminalPresentation(
					apiRef,
					sessionId,
					splitPlacement,
				);
				if (!presented) {
					throw new Error(
						'Server did not publish a terminal panel for the created session.',
					);
				}
				onError(null);
				// workspace.changed is the sole owner of Dockview presentation.
				return {
					panelId: presented.panelId,
					sessionId,
					title: presented.title,
				};
			} catch (error) {
				onError(error instanceof Error ? error.message : String(error));
				return null;
			}
		},
		[
			apiRef,
			createSession,
			hydrateRecording,
			onError,
			projectId,
			recordNewTerminals,
			sendInput,
			startRecording,
			splitPanel,
			suppressInitialActivity,
			waitForCreatedTerminal,
		],
	);
}
