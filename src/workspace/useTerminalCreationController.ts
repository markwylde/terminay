import type { Direction, DockviewApi, DockviewGroupPanel } from 'dockview';
import { type MutableRefObject, useCallback } from 'react';

type SplitDirection = Extract<Direction, 'below' | 'right'>;

export type AddTerminalOptions = {
	cwd?: string | null;
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

type UseTerminalCreationControllerOptions = {
	apiRef: MutableRefObject<DockviewApi | null>;
	createSession:
		| ((request: {
				cwd?: string;
				projectId: string;
		  }) => Promise<{ sessionId: string }>)
		| null;
	getTerminalCwd: (sessionId: string) => Promise<string | null>;
	hydrateRecording: (sessionId: string) => void;
	onError: (message: string | null) => void;
	projectId: string;
	recordNewTerminals: boolean;
	sendInput: (sessionId: string, data: string) => void;
	startRecording: (sessionId: string) => Promise<unknown>;
	suppressInitialActivity: (sessionId: string) => void;
	waitForCreatedTerminal?: (sessionId: string) => Promise<boolean>;
};

function parentDirectory(filePath: string): string {
	const separator = Math.max(
		filePath.lastIndexOf('/'),
		filePath.lastIndexOf('\\'),
	);
	return filePath.substring(0, separator) || filePath;
}

async function readTerminalCwdWithFallback(
	getTerminalCwd: (sessionId: string) => Promise<string | null>,
	sessionId: string,
	fallback: string | null,
): Promise<string | null> {
	let timeout: number | undefined;
	try {
		return await Promise.race([
			getTerminalCwd(sessionId),
			new Promise<string | null>((resolve) => {
				timeout = window.setTimeout(() => resolve(fallback), 250);
			}),
		]);
	} catch {
		return fallback;
	} finally {
		if (timeout !== undefined) window.clearTimeout(timeout);
	}
}

async function activateCreatedTerminalPresentation(
	apiRef: MutableRefObject<DockviewApi | null>,
	sessionId: string,
	placement?: {
		direction: SplitDirection;
		referenceGroup: DockviewGroupPanel;
	},
): Promise<{ panelId: string; title: string } | null> {
	return await new Promise<{ panelId: string; title: string } | null>((resolve) => {
		const startedAt = performance.now();
		const inspect = () => {
			const panel = apiRef.current?.panels.find(
				(candidate) => candidate.params?.sessionId === sessionId,
			);
			if (panel) {
				if (placement !== undefined) {
					panel.api.moveTo({
						group: placement.referenceGroup,
						position:
							placement.direction === 'below' ? 'bottom' : 'right',
					});
				}
				panel.api.setActive();
				// Dockview publishes its active-panel CSS/visibility state on the
				// following render frame. Resolve only after that contract is in the
				// DOM so callers cannot select the formerly active panel.
					window.requestAnimationFrame(() => {
						window.requestAnimationFrame(() => resolve({
							panelId: panel.id,
							title: panel.title ?? 'Terminal',
						}));
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
	});
}

export function useTerminalCreationController({
	apiRef,
	createSession,
	getTerminalCwd,
	hydrateRecording,
	onError,
	projectId,
	recordNewTerminals,
	sendInput,
	startRecording,
	suppressInitialActivity,
	waitForCreatedTerminal,
}: UseTerminalCreationControllerOptions) {
	return useCallback(
		async (
			options?: AddTerminalOptions,
		): Promise<CreatedTerminalPresentation | null> => {
			const activeParams = apiRef.current?.activePanel?.params;
			const splitPlacement =
				options?.direction === undefined ||
				apiRef.current?.activePanel === undefined
					? undefined
					: {
							direction: options.direction,
							referenceGroup:
								apiRef.current.activePanel.group,
						};
			if (!apiRef.current) {
				return null;
			}

			try {
				let inheritedCwd: string | null = null;
				const panelCwd =
					typeof activeParams?.cwd === 'string' && activeParams.cwd.length > 0
						? activeParams.cwd
						: null;
				if (activeParams?.sessionId) {
					inheritedCwd = await readTerminalCwdWithFallback(
						getTerminalCwd,
						activeParams.sessionId,
						panelCwd,
					);
				} else if (typeof activeParams?.folderPath === 'string') {
					inheritedCwd = activeParams.folderPath;
				} else if (typeof activeParams?.filePath === 'string') {
					inheritedCwd = parentDirectory(activeParams.filePath);
				} else {
					inheritedCwd = panelCwd;
				}
				if (!createSession) {
					throw new Error('The server terminal client is unavailable.');
				}

				const targetCwd = options?.cwd ?? inheritedCwd;
				const { sessionId } = await createSession({
					projectId,
					...(targetCwd ? { cwd: targetCwd } : {}),
				});
				suppressInitialActivity(sessionId);
				window.terminayBootstrapDiagnostic?.record(
					'app.workspace.create.await-delta',
				);
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
					throw new Error('Server did not publish a terminal panel for the created session.');
				}
				const presented = await activateCreatedTerminalPresentation(
					apiRef,
					sessionId,
					splitPlacement,
				);
				if (!presented) {
					throw new Error('Server did not publish a terminal panel for the created session.');
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
			getTerminalCwd,
			hydrateRecording,
			onError,
			projectId,
			recordNewTerminals,
			sendInput,
			startRecording,
			suppressInitialActivity,
			waitForCreatedTerminal,
		],
	);
}
