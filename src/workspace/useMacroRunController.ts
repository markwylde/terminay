import type { MacroClient, MacroRunSnapshot, MacroTarget } from '@terminay/client-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TerminalTabMacroRun } from '../components/TerminalTab';
import { renderMacroDurationMs, renderMacroTemplate } from '../macroSettings';
import type { MacroDefinition, MacroFieldValue } from '../types/macros';

type MacroRunController = {
	abortController: AbortController;
	sessionId: string;
	serverTarget?: MacroTarget;
};

type MacroRunControllerOptions = {
	focusActiveTerminal: () => void;
	getActiveSessionId: () => string | null;
	getDecryptedSecret: (secretId: string) => Promise<string>;
	sendInput: (sessionId: string, data: string) => void;
	setErrorText: (message: string | null) => void;
	waitForInactivity: (
		sessionId: string,
		durationMs: number,
		signal: AbortSignal,
	) => Promise<void>;
	serverMacroClient?: MacroClient;
	serverTargetForSession?: (sessionId: string) => MacroTarget;
};

function abortError(): Error {
	const error = new Error('Macro execution canceled.');
	error.name = 'AbortError';
	return error;
}

function throwIfAborted(signal: AbortSignal) {
	if (signal.aborted) throw abortError();
}

function waitForDelay(durationMs: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) return reject(abortError());
		const onAbort = () => {
			window.clearTimeout(timeout);
			reject(abortError());
		};
		const timeout = window.setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, durationMs);
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

function inputForKey(key: string): string | null {
	return (
		{
			ArrowDown: '\x1b[B',
			ArrowUp: '\x1b[A',
			Backspace: '\x7f',
			Enter: '\r',
			Escape: '\x1b',
			Tab: '\t',
		}[key] ?? null
	);
}

function formatTypedText(text: string): string {
	if (!/[\r\n]/.test(text)) return text;
	return `\x1b[200~${text.replace(/\r\n?/g, '\n')}\x1b[201~`;
}

function formatDurationSeconds(durationSeconds: string): string {
	const numeric = Number(durationSeconds);
	if (durationSeconds.trim() && Number.isFinite(numeric)) {
		return String(Math.max(0, Math.round(numeric * 10) / 10));
	}
	return durationSeconds.trim() || '0';
}

function describeStep(step: MacroDefinition['steps'][number]): string {
	switch (step.type) {
		case 'type':
			return `Type: ${step.content.replace(/\s+/g, ' ').trim() || '(empty)'}`.slice(0, 96);
		case 'key':
			return `Press ${step.key}`;
		case 'secret':
			return 'Insert secret';
		case 'wait_time':
			return `Wait ${formatDurationSeconds(step.durationSeconds)}s`;
		case 'wait_inactivity':
			return `Wait for inactivity ${formatDurationSeconds(step.durationSeconds)}s`;
		case 'select_line':
			return 'Select current line';
		case 'paste':
			return 'Paste clipboard';
	}
}

export function useMacroRunController(options: MacroRunControllerOptions) {
	const [runningMacroRunsBySession, setRunningMacroRunsBySession] = useState<
		Record<string, TerminalTabMacroRun[]>
	>({});
	const controllersRef = useRef<Map<string, MacroRunController>>(new Map());

	const applyServerSnapshot = useCallback((snapshot: MacroRunSnapshot) => {
		const sessionId = snapshot.target.sessionId;
		setRunningMacroRunsBySession((current) => {
			const runs = current[sessionId];
			if (!runs?.some((run) => run.id === snapshot.runId)) return current;
			return {
				...current,
				[sessionId]: runs.map((run) => run.id !== snapshot.runId ? run : {
					...run,
					status: snapshot.status,
					steps: run.steps.map((step, index) => ({
						...step,
						status: snapshot.status === 'canceled' && index >= snapshot.stepIndex
							? 'canceled'
							: snapshot.status === 'failed' && index === snapshot.stepIndex
								? 'failed'
								: index < snapshot.stepIndex || snapshot.status === 'completed'
									? 'completed'
									: index === snapshot.stepIndex
										? 'running'
										: 'pending',
					})),
				}),
			};
		});
		if (snapshot.status !== 'running') controllersRef.current.delete(snapshot.runId);
	}, []);

	useEffect(() => {
		if (options.serverMacroClient === undefined) return;
		return options.serverMacroClient.onRunChanged(applyServerSnapshot);
	}, [applyServerSnapshot, options.serverMacroClient]);

	const updateRun = useCallback(
		(
			sessionId: string,
			runId: string,
			updater: (run: TerminalTabMacroRun) => TerminalTabMacroRun,
		) => {
			setRunningMacroRunsBySession((current) => {
				const runs = current[sessionId];
				if (!runs?.length) return current;
				let changed = false;
				const nextRuns = runs.map((run) => {
					if (run.id !== runId) return run;
					changed = true;
					return updater(run);
				});
				return changed ? { ...current, [sessionId]: nextRuns } : current;
			});
		},
		[],
	);

	const updateRunStatus = useCallback(
		(
			sessionId: string,
			runId: string,
			status: TerminalTabMacroRun['status'],
		) => updateRun(sessionId, runId, (run) => ({ ...run, status })),
		[updateRun],
	);

	const updateRunStepStatus = useCallback(
		(
			sessionId: string,
			runId: string,
			stepId: string,
			status: TerminalTabMacroRun['steps'][number]['status'],
		) =>
			updateRun(sessionId, runId, (run) => ({
				...run,
				steps: run.steps.map((step) =>
					step.id === stepId ? { ...step, status } : step,
				),
			})),
		[updateRun],
	);

	const replaceSessionRuns = useCallback(
		(sessionId: string, runs: TerminalTabMacroRun[]) => {
			setRunningMacroRunsBySession((current) => ({
				...current,
				[sessionId]: runs,
			}));
		},
		[],
	);

	const registerRun = useCallback(
		(
			sessionId: string,
			run: TerminalTabMacroRun,
			abortController: AbortController,
		) => {
			controllersRef.current.set(run.id, { abortController, sessionId });
			setRunningMacroRunsBySession((current) => ({
				...current,
				[sessionId]: [run, ...(current[sessionId] ?? [])],
			}));
		},
		[],
	);

	const finishRun = useCallback((runId: string) => {
		controllersRef.current.delete(runId);
	}, []);

	const clearSessionRuns = useCallback((sessionId: string) => {
		setRunningMacroRunsBySession((current) => {
			if (!(sessionId in current)) return current;
			const { [sessionId]: _removed, ...rest } = current;
			return rest;
		});
	}, []);

	const clearFinishedSessionRuns = useCallback((sessionId: string) => {
		setRunningMacroRunsBySession((current) => {
			const runs = current[sessionId];
			if (!runs?.length) return current;
			const nextRuns = runs.filter(
				(run) => run.status === 'running' || run.status === 'canceling',
			);
			if (nextRuns.length === runs.length) return current;
			if (nextRuns.length === 0) {
				const { [sessionId]: _removed, ...rest } = current;
				return rest;
			}
			return { ...current, [sessionId]: nextRuns };
		});
	}, []);

	const clearRun = useCallback((sessionId: string, runId: string) => {
		setRunningMacroRunsBySession((current) => {
			const runs = current[sessionId];
			if (!runs?.length) return current;
			const nextRuns = runs.filter((run) => run.id !== runId);
			if (nextRuns.length === runs.length) return current;
			if (nextRuns.length === 0) {
				const { [sessionId]: _removed, ...rest } = current;
				return rest;
			}
			return { ...current, [sessionId]: nextRuns };
		});
	}, []);

	const cancelRun = useCallback(
		(runId: string) => {
			const controller = controllersRef.current.get(runId);
			if (!controller) return;
			updateRunStatus(controller.sessionId, runId, 'canceling');
			if (
				options.serverMacroClient !== undefined &&
				controller.serverTarget !== undefined
			) {
				void options.serverMacroClient
					.cancel(runId, controller.serverTarget)
					.catch((error) => {
						updateRunStatus(controller.sessionId, runId, 'failed');
						options.setErrorText(error instanceof Error ? error.message : String(error));
					});
				return;
			}
			controller.abortController.abort();
		},
		[options, updateRunStatus],
	);

	const cancelSessionRuns = useCallback(
		(sessionId: string) => {
			for (const [runId, controller] of controllersRef.current) {
				if (controller.sessionId !== sessionId) continue;
				updateRunStatus(sessionId, runId, 'canceling');
				if (
					options.serverMacroClient !== undefined &&
					controller.serverTarget !== undefined
				) {
					void options.serverMacroClient.cancel(runId, controller.serverTarget);
					continue;
				}
				controller.abortController.abort();
			}
		},
		[options.serverMacroClient, updateRunStatus],
	);

	const executeMacro = useCallback(
		async (
			macro: MacroDefinition,
			values: Record<string, MacroFieldValue>,
		) => {
			const sessionId = options.getActiveSessionId();
			if (!sessionId) {
				options.setErrorText('No active terminal is available to receive the macro.');
				return;
			}
			options.setErrorText(null);
			if (
				options.serverMacroClient !== undefined &&
				options.serverTargetForSession !== undefined
			) {
				try {
					const target = options.serverTargetForSession(sessionId);
					const snapshot = await options.serverMacroClient.run(
						macro.id,
						target,
						values,
					);
					const abortController = new AbortController();
					registerRun(sessionId, {
						id: snapshot.runId,
						startedAt: snapshot.startedAt,
						status: snapshot.status,
						steps: macro.steps.map((step, index) => ({
							id: step.id,
							status: index === snapshot.stepIndex ? 'running' : 'pending',
							title: describeStep(step),
						})),
						title: macro.title,
					}, abortController);
					controllersRef.current.set(snapshot.runId, {
						abortController,
						sessionId,
						serverTarget: target,
					});
					applyServerSnapshot(snapshot);
					window.requestAnimationFrame(options.focusActiveTerminal);
				} catch (error) {
					options.setErrorText(error instanceof Error ? error.message : String(error));
				}
				return;
			}
			const runId = `${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const abortController = new AbortController();
			const run: TerminalTabMacroRun = {
				id: runId,
				startedAt: Date.now(),
				status: 'running',
				steps: macro.steps.map((step) => ({
					id: step.id,
					status: 'pending',
					title: describeStep(step),
				})),
				title: macro.title,
			};
			registerRun(sessionId, run, abortController);
			try {
				for (const step of macro.steps) {
					throwIfAborted(abortController.signal);
					updateRunStepStatus(sessionId, runId, step.id, 'running');
					switch (step.type) {
						case 'type':
							options.sendInput(
								sessionId,
								formatTypedText(renderMacroTemplate(step.content, values)),
							);
							break;
						case 'key': {
							const input = inputForKey(step.key);
							if (input !== null) options.sendInput(sessionId, input);
							break;
						}
						case 'secret':
							try {
								const secret = await options.getDecryptedSecret(step.secretId);
								throwIfAborted(abortController.signal);
								options.sendInput(sessionId, secret);
							} catch (error) {
								if (error instanceof Error && error.name === 'AbortError') throw error;
							}
							break;
						case 'wait_time':
							await waitForDelay(
								renderMacroDurationMs(step.durationSeconds, values),
								abortController.signal,
							);
							break;
						case 'wait_inactivity':
							await options.waitForInactivity(
								sessionId,
								renderMacroDurationMs(step.durationSeconds, values),
								abortController.signal,
							);
							break;
						case 'paste':
							try {
								const text = await navigator.clipboard.readText();
								throwIfAborted(abortController.signal);
								options.sendInput(sessionId, text);
							} catch (error) {
								if (error instanceof Error && error.name === 'AbortError') throw error;
							}
							break;
						case 'select_line':
							break;
					}
					updateRunStepStatus(sessionId, runId, step.id, 'completed');
				}
				updateRunStatus(sessionId, runId, 'completed');
				window.requestAnimationFrame(options.focusActiveTerminal);
			} catch (error) {
				const aborted = error instanceof Error && error.name === 'AbortError';
				updateRunStatus(sessionId, runId, aborted ? 'canceled' : 'failed');
				updateRun(sessionId, runId, (current) => ({
					...current,
					steps: current.steps.map((step) =>
						step.status === 'running'
							? { ...step, status: aborted ? 'canceled' : 'failed' }
							: step,
					),
				}));
				if (!aborted) {
					options.setErrorText(error instanceof Error ? error.message : String(error));
				}
			} finally {
				finishRun(runId);
			}
		},
		[applyServerSnapshot, finishRun, options, registerRun, updateRun, updateRunStatus, updateRunStepStatus],
	);

	return {
		cancelRun,
		cancelSessionRuns,
		clearFinishedSessionRuns,
		clearRun,
		clearSessionRuns,
		finishRun,
		executeMacro,
		registerRun,
		replaceSessionRuns,
		runningMacroRunsBySession,
		updateRun,
		updateRunStatus,
		updateRunStepStatus,
	};
}
