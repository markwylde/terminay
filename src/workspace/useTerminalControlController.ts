import type { DockviewApi } from 'dockview';
import {
	type MutableRefObject,
	useCallback,
} from 'react';
import type { TerminalContextReader } from '../components/TerminalTab';
import { formatRunCommandInput } from '../terminalInput';
import type { AddTerminalOptions } from './useTerminalCreationController';

export type ControlHandlerResult =
	| { ok: true; result: unknown }
	| {
			ok: false;
			error: { code: string; message: string; candidates?: string[] };
	  };

type ControlActivity = {
	at: number;
	attention: boolean;
	exitCode: number | null;
	status: 'idle' | 'working';
};

export type TerminalControlState = {
	activity: Map<string, ControlActivity>;
	attentionWaiters: Map<string, Set<() => void>>;
	commandWaiters: Map<string, Set<(exitCode: number | null) => void>>;
	exits: Map<string, number>;
};

export function createTerminalControlState(): TerminalControlState {
	return {
		activity: new Map(),
		attentionWaiters: new Map(),
		commandWaiters: new Map(),
		exits: new Map(),
	};
}

export function clearTerminalControlActivity(
	state: TerminalControlState,
	sessionId: string,
): void {
	state.activity.delete(sessionId);
}

export function recordTerminalControlActivity(
	state: TerminalControlState,
	sessionId: string,
	activity: ControlActivity,
): void {
	const previous = state.activity.get(sessionId);
	state.activity.set(sessionId, activity);
	if (
		activity.exitCode !== null &&
		(previous?.status === 'working' || previous?.exitCode !== activity.exitCode)
	) {
		for (const waiter of state.commandWaiters.get(sessionId) ?? []) {
			waiter(activity.exitCode);
		}
	}
	if (activity.attention) {
		for (const waiter of state.attentionWaiters.get(sessionId) ?? []) waiter();
	}
}

export function recordTerminalControlExit(
	state: TerminalControlState,
	sessionId: string,
	exitCode: number,
): void {
	state.exits.set(sessionId, exitCode);
	for (const waiter of state.commandWaiters.get(sessionId) ?? []) {
		waiter(exitCode);
	}
}

type ControlTerminal = {
	panelId: string;
	sessionId: string;
	title: string;
};
type TerminalMatch =
	| { found: ControlTerminal }
	| {
			error: { code: string; message: string; candidates?: string[] };
	  };

type UseTerminalControlControllerOptions = {
	addTerminal: (
		options?: AddTerminalOptions,
	) => Promise<{ panelId: string; sessionId: string; title: string } | null>;
	apiRef: MutableRefObject<DockviewApi | null>;
	getTerminalCwd: (sessionId: string) => Promise<string | null>;
	projectId: string;
	sendInput: (sessionId: string, data: string) => void;
	setTerminalTitleRevision: (update: (revision: number) => number) => void;
	state: TerminalControlState;
	terminalContextReadersRef: MutableRefObject<
		Map<string, TerminalContextReader>
	>;
	waitForInactivity:
		| ((
				projectId: string,
				sessionId: string,
				idleMs: number,
		  ) => Promise<unknown>)
		| null;
};

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value)
		? value
		: undefined;
}

function asDirection(
	value: unknown,
): AddTerminalOptions['direction'] | undefined {
	if (value === 'right' || value === 'left') return 'right';
	if (value === 'below' || value === 'above') return 'below';
	return undefined;
}

function enumerateTerminals(api: DockviewApi | null): ControlTerminal[] {
	if (!api) return [];
	return api.groups.flatMap((group) =>
		group.panels.flatMap((panel) => {
			const sessionId = panel.params?.sessionId;
			if (!sessionId) return [];
			return [
				{
					panelId: panel.id,
					sessionId,
					title:
						typeof panel.title === 'string' && panel.title.trim().length > 0
							? panel.title
							: 'Terminal',
				},
			];
		}),
	);
}

function matchTerminal(
	terminals: ControlTerminal[],
	value: unknown,
): TerminalMatch {
	const ref = asString(value);
	if (!ref || ref.trim().length === 0) {
		return {
			error: {
				code: 'bad_request',
				message: 'A terminal name or id is required.',
			},
		};
	}
	const byId = terminals.find((terminal) => terminal.sessionId === ref);
	if (byId) return { found: byId };
	const tiers = [
		terminals.filter((terminal) => terminal.title === ref),
		terminals.filter(
			(terminal) => terminal.title.toLowerCase() === ref.toLowerCase(),
		),
		terminals.filter((terminal) =>
			terminal.title.toLowerCase().includes(ref.toLowerCase()),
		),
	];
	for (const tier of tiers) {
		const only = tier[0];
		if (tier.length === 1 && only) return { found: only };
		if (tier.length > 1) {
			return {
				error: {
					candidates: tier.map((terminal) => terminal.title),
					code: 'ambiguous_terminal',
					message: `More than one terminal matches "${ref}".`,
				},
			};
		}
	}
	return {
		error: {
			code: 'terminal_not_found',
			message: `No terminal matches "${ref}" in this window.`,
		},
	};
}

function waitOnce(
	register: (resolve: () => void) => () => void,
	timeoutSeconds: number | undefined,
): Promise<boolean> {
	return new Promise((resolve) => {
		let settled = false;
		let timer: number | undefined;
		const finish = (timedOut: boolean) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (timer !== undefined) window.clearTimeout(timer);
			resolve(timedOut);
		};
		const cleanup = register(() => finish(false));
		if (timeoutSeconds && timeoutSeconds > 0) {
			timer = window.setTimeout(() => finish(true), timeoutSeconds * 1000);
		}
	});
}

export function useTerminalControlController({
	addTerminal,
	apiRef,
	getTerminalCwd,
	projectId,
	sendInput,
	setTerminalTitleRevision,
	state,
	terminalContextReadersRef,
	waitForInactivity,
}: UseTerminalControlControllerOptions) {
	const ownsSession = useCallback(
		(sessionId: string) =>
			enumerateTerminals(apiRef.current).some(
				(terminal) => terminal.sessionId === sessionId,
			),
		[apiRef],
	);

	const handleRequest = useCallback(
		async (
			op: string,
			params: unknown,
			scopeSessionId: string,
		): Promise<ControlHandlerResult> => {
			const api = apiRef.current;
			const p = (params ?? {}) as Record<string, unknown>;
			const enumerate = () => enumerateTerminals(api);
			const resolveTerminal = (value: unknown) =>
				matchTerminal(enumerate(), value);
			const buildInfo = async (terminal: ControlTerminal) => {
				const activity = state.activity.get(terminal.sessionId);
				const exited = state.exits.get(terminal.sessionId);
				let cwd: string | null = null;
				try {
					cwd = await getTerminalCwd(terminal.sessionId);
				} catch {
					cwd = null;
				}
				return {
					attention: activity?.attention ?? false,
					busy: activity?.status === 'working',
					cwd,
					exitCode: exited ?? activity?.exitCode ?? null,
					id: terminal.sessionId,
					isSelf: terminal.sessionId === scopeSessionId,
					lastActivityAgoMs: activity
						? Math.max(0, Date.now() - activity.at)
						: null,
					name: terminal.title,
				};
			};

			try {
				switch (op) {
					case 'list_terminals':
						return {
							ok: true,
							result: {
								terminals: await Promise.all(enumerate().map(buildInfo)),
							},
						};
					case 'read_terminal': {
						const match = resolveTerminal(p.terminal);
						if ('error' in match) return { ok: false, error: match.error };
						const reader = terminalContextReadersRef.current.get(
							match.found.sessionId,
						);
						let output = reader ? reader().recentOutput : '';
						const lines = asNumber(p.lines);
						if (lines && lines > 0) {
							output = output.split('\n').slice(-lines).join('\n');
						}
						return {
							ok: true,
							result: {
								id: match.found.sessionId,
								name: match.found.title,
								output,
							},
						};
					}
					case 'get_terminal_status': {
						const match = resolveTerminal(p.terminal);
						if ('error' in match) return { ok: false, error: match.error };
						const activity = state.activity.get(match.found.sessionId);
						const exited = state.exits.get(match.found.sessionId);
						return {
							ok: true,
							result: {
								attention: activity?.attention ?? false,
								exitCode: exited ?? activity?.exitCode ?? null,
								id: match.found.sessionId,
								lastActivityAgoMs: activity
									? Math.max(0, Date.now() - activity.at)
									: null,
								name: match.found.title,
								status:
									exited !== undefined
										? 'exited'
										: activity?.status === 'working'
											? 'working'
											: 'idle',
							},
						};
					}
					case 'open_terminal': {
						const split = asDirection(p.split);
						if (split) {
							const caller = enumerate().find(
								(terminal) => terminal.sessionId === scopeSessionId,
							);
							if (caller) api?.getPanel(caller.panelId)?.api.setActive();
						}
						const created = await addTerminal({
							cwd: asString(p.cwd),
							direction: split,
							title: asString(p.name),
						});
						return created
							? {
									ok: true,
									result: { id: created.sessionId, name: created.title },
								}
							: {
									ok: false,
									error: {
										code: 'internal',
										message: 'Failed to open a new terminal.',
									},
								};
					}
					case 'write_terminal':
					case 'run_command': {
						const match = resolveTerminal(p.terminal);
						if ('error' in match) return { ok: false, error: match.error };
						const text =
							op === 'run_command'
								? formatRunCommandInput(asString(p.command) ?? '')
								: (asString(p.text) ?? '');
						sendInput(match.found.sessionId, text);
						if (op === 'run_command' || p.submit === true) {
							sendInput(match.found.sessionId, '\r');
						}
						return { ok: true, result: { ok: true } };
					}
					case 'close_terminal':
					case 'focus_terminal': {
						const match = resolveTerminal(p.terminal);
						if ('error' in match) return { ok: false, error: match.error };
						const panel = api?.getPanel(match.found.panelId);
						op === 'close_terminal'
							? panel?.api.close()
							: panel?.api.setActive();
						return { ok: true, result: { ok: true } };
					}
					case 'rename_terminal': {
						const match = resolveTerminal(p.terminal);
						if ('error' in match) return { ok: false, error: match.error };
						const name = asString(p.name);
						if (!name?.trim()) {
							return {
								ok: false,
								error: {
									code: 'bad_request',
									message: 'A new name is required.',
								},
							};
						}
						api?.getPanel(match.found.panelId)?.api.setTitle(name);
						setTerminalTitleRevision((revision) => revision + 1);
						return { ok: true, result: { ok: true } };
					}
					case 'split_terminal': {
						const match = resolveTerminal(p.terminal);
						if ('error' in match) return { ok: false, error: match.error };
						api?.getPanel(match.found.panelId)?.api.setActive();
						const created = await addTerminal({
							direction: asDirection(p.direction) ?? 'right',
						});
						return created
							? {
									ok: true,
									result: { id: created.sessionId, name: created.title },
								}
							: {
									ok: false,
									error: {
										code: 'internal',
										message: 'Failed to split the terminal.',
									},
								};
					}
					case 'wait_for_idle': {
						const match = resolveTerminal(p.terminal);
						if ('error' in match) return { ok: false, error: match.error };
						if (!waitForInactivity) {
							return {
								ok: false,
								error: {
									code: 'internal',
									message: 'The server terminal client is unavailable.',
								},
							};
						}
						const idle = waitForInactivity(
							projectId,
							match.found.sessionId,
							Math.max(0, (asNumber(p.seconds) ?? 0) * 1000),
						).then(() => false);
						const timeout = asNumber(p.timeout);
						const timedOut =
							timeout && timeout > 0
								? await Promise.race([
										idle,
										new Promise<true>((resolve) =>
											window.setTimeout(
												() => resolve(true),
												timeout * 1000,
											),
										),
									])
								: await idle;
						return { ok: true, result: { idle: true, timedOut } };
					}
					case 'wait_for_command':
					case 'wait_for_attention': {
						const match = resolveTerminal(p.terminal);
						if ('error' in match) return { ok: false, error: match.error };
						const sessionId = match.found.sessionId;
						let exitCode: number | null = null;
						const timedOut =
							op === 'wait_for_command'
								? await waitOnce((resolve) => {
										const waiter = (code: number | null) => {
											exitCode = code;
											resolve();
										};
										const waiters =
											state.commandWaiters.get(sessionId) ?? new Set();
										state.commandWaiters.set(sessionId, waiters);
										waiters.add(waiter);
										return () => waiters.delete(waiter);
									}, asNumber(p.timeout))
								: await waitOnce((resolve) => {
										const waiters =
											state.attentionWaiters.get(sessionId) ??
											new Set();
										state.attentionWaiters.set(sessionId, waiters);
										waiters.add(resolve);
										return () => waiters.delete(resolve);
									}, asNumber(p.timeout));
						return op === 'wait_for_command'
							? { ok: true, result: { exitCode, timedOut } }
							: { ok: true, result: { attention: true, timedOut } };
					}
					default:
						return {
							ok: false,
							error: {
								code: 'unsupported_op',
								message: `Unknown operation: ${op}`,
							},
						};
				}
			} catch (error) {
				return {
					ok: false,
					error: {
						code: 'internal',
						message: error instanceof Error ? error.message : String(error),
					},
				};
			}
		},
		[
			addTerminal,
			apiRef,
			getTerminalCwd,
			projectId,
			sendInput,
			setTerminalTitleRevision,
			state,
			terminalContextReadersRef,
			waitForInactivity,
		],
	);

	return {
		handleRequest,
		ownsSession,
	};
}
