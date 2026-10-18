import {
	type ActivityEvent,
	type ActivitySnapshot,
	commandSubmissionInput,
	TerminalActivityService,
	type TerminalAuthorization,
	type TerminalEvent,
	type TerminalLaunchResolver,
	type TerminalPresentationRead,
	type TerminalPresentationReadOptions,
	type TerminalRetainedOutputRead,
	type TerminalRetainedOutputReadOptions,
	TerminalService,
	type TerminalSessionSnapshot,
	findAutomationSpace,
	type WorkspacePanel,
	WorkspaceRepository,
	type WorkspaceState,
	type WorkspaceRepository as WorkspaceRepositoryType,
} from '@terminay/server-core';
import {
	ControlEndpointError,
	type ControlRequestContext,
} from './controlEndpoint.js';
import type {
	OpenTerminalParams,
	ReadTerminalParams,
	RenameTerminalParams,
	RunCommandParams,
	SearchTerminalParams,
	SplitTerminalParams,
	TerminalControlAdapter,
	TerminalParams,
	WaitForIdleParams,
	WaitParams,
	WriteTerminalParams,
} from './dispatcher.js';
import {
	assertAutomationSpaceCapacity,
	canAddressSession,
	ProjectHandleCodec,
	reachOf,
	resolveOpenTerminalProject,
	workspaceProjectFields,
} from './workspaceReach.js';

export interface ServerTerminalControlAdapterOptions {
	readonly terminal: TerminalService;
	/** Canonical server-owned shell/profile/cwd launch authority. */
	readonly launchResolver: TerminalLaunchResolver;
	readonly activity?: TerminalActivityService;
	/** Canonical server-owned workspace/view authority for layout mutations. */
	readonly workspace?: WorkspaceRepositoryType;
	readonly maxReadBytes?: number;
	readonly maxWaitSeconds?: number;
	/** What schedules a wait's deadline. Defaults to the global timers. */
	readonly waitTimers?: Readonly<{
		setTimeout: (handler: () => void, ms: number) => unknown;
		clearTimeout: (handle: unknown) => void;
	}>;
	readonly renameTerminal?: (
		params: RenameTerminalParams,
		context: ControlRequestContext,
		signal: AbortSignal,
	) => unknown | Promise<unknown>;
	/** @internal Deterministic project-handle key for tests. */
	readonly projectHandleKey?: Uint8Array;
	/**
	 * Told when a workspace-reach caller (an automation terminal) opens a
	 * terminal, so the automation run that owns the caller records it and the
	 * Automations section groups it under that run. Typically the composed
	 * `automationExecutor.recordOpenedTerminal`. A failure never fails the
	 * open.
	 */
	readonly recordOpenedTerminal?: (
		callerSessionId: string,
		openedSessionId: string,
	) => unknown;
}

/** Adapter options with the per-adapter project-handle codec resolved. */
type AdapterOptions = ServerTerminalControlAdapterOptions & {
	readonly projectHandles: ProjectHandleCodec;
};

const DEFAULT_MAX_READ_BYTES = 256 * 1024;
const GLOBAL_WAIT_TIMERS: NonNullable<
	ServerTerminalControlAdapterOptions['waitTimers']
> = {
	setTimeout: (handler, ms) => setTimeout(handler, ms),
	clearTimeout: (handle) =>
		clearTimeout(handle as ReturnType<typeof setTimeout>),
};
const DEFAULT_MAX_WAIT_SECONDS = 15 * 60;

/**
 * Bind MCP operations to the server-owned terminal and activity authorities.
 * TerminalService deliberately owns PTYs, while WorkspaceRepository owns the
 * canonical view tree. Layout mutations use the repository when composed;
 * injected callbacks remain a compatibility seam for hosts that have not yet
 * composed workspace persistence.
 */
export function createServerTerminalControlAdapter(
	hostOptions: ServerTerminalControlAdapterOptions,
): TerminalControlAdapter {
	if (!(hostOptions.terminal instanceof TerminalService))
		throw new TypeError('terminal service is required');
	const options: AdapterOptions = {
		...hostOptions,
		projectHandles: new ProjectHandleCodec(
			hostOptions.terminal.serverId,
			...(hostOptions.projectHandleKey === undefined
				? []
				: [hostOptions.projectHandleKey]),
		),
	};
	const maxReadBytes = positive(
		options.maxReadBytes ?? DEFAULT_MAX_READ_BYTES,
		'maxReadBytes',
	);
	const maxWaitSeconds = positive(
		options.maxWaitSeconds ?? DEFAULT_MAX_WAIT_SECONDS,
		'maxWaitSeconds',
	);
	return {
		getMcpCapabilities: () => getMcpCapabilities(options),
		listTerminals: (context) => listTerminals(options, context),
		readTerminal: (params, context) =>
			readTerminal(options, params, context, maxReadBytes),
		searchTerminal: (params, context) =>
			searchTerminal(options, params, context, maxReadBytes),
		getTerminalStatus: (params, context) =>
			terminalStatus(options, params, context),
		openTerminal: (params, context) => openTerminal(options, params, context),
		writeTerminal: (params, context) => writeTerminal(options, params, context),
		runCommand: (params, context) => runCommand(options, params, context),
		closeTerminal: (params, context) => closeTerminal(options, params, context),
		// Showing a terminal is the agent's client's to do (ADR-0070): the host
		// only resolves it within scope.
		focusTerminal: (params, context) => ({
			terminal: targetSession(options, context, params.terminal).sessionId,
		}),
		renameTerminal: (params, context, signal) => {
			const session = targetSession(options, context, params.terminal);
			return options.workspace === undefined
				? options.renameTerminal === undefined
					? unsupported('rename_terminal')
					: options.renameTerminal(params, context, signal)
				: applyWorkspaceViewCommand(
						options.workspace,
						'rename_terminal',
						session.sessionId,
						session.projectId,
						context,
						signal,
						params.name,
					);
		},
		// One new terminal in the target's project and folder; the agent's
		// client places it (ADR-0070).
		splitTerminal: (params, context) => splitTerminal(options, params, context),
		waitForIdle: (params, context, signal) =>
			waitForIdle(options, params, context, signal, maxWaitSeconds),
		waitForCommand: (params, context, signal) =>
			waitForCommand(options, params, context, signal, maxWaitSeconds),
		waitForAttention: (params, context, signal) =>
			waitForAttention(options, params, context, signal, maxWaitSeconds),
	};
}

const AUTOMATION_TOOLS: readonly string[] = [
	'list_automations',
	'get_automation',
	'list_automation_runs',
	'create_automation',
	'update_automation',
	'delete_automation',
	'set_automation_enabled',
	'run_automation',
	'stop_automation_run',
];

const WINDOW_TOOLS: readonly string[] = [
	'show_window',
	'close_window',
	'list_windows',
];

const NOTIFICATION_TOOLS: readonly string[] = [
	'send_notification',
	'dismiss_notification',
];

function getMcpCapabilities(options: AdapterOptions): unknown {
	const activityAvailable = options.activity !== undefined;
	const workspaceAvailable = options.workspace !== undefined;
	return {
		tools: [
			'get_mcp_capabilities',
			'list_terminals',
			'read_terminal',
			'search_terminal',
			'get_terminal_status',
			'open_terminal',
			'write_terminal',
			'run_command',
			'close_terminal',
			'focus_terminal',
			'rename_terminal',
			'split_terminal',
			'get_layout',
			'focus_tab',
			'move_tab',
			'resize_pane',
			'arrange_tabs',
			'focus_project',
			'select_folder',
			'create_folder',
			'rename_folder',
			'move_tab_to_folder',
			'open_file',
			'close_tab',
			'wait_for_idle',
			'wait_for_command',
			'wait_for_attention',
			...AUTOMATION_TOOLS,
			...WINDOW_TOOLS,
			...NOTIFICATION_TOOLS,
		].map((tool) => ({
			tool,
			available:
				// This adapter binds terminals only; a host that serves
				// automations, app windows, or notifications binds them separately.
				AUTOMATION_TOOLS.includes(tool) ||
				WINDOW_TOOLS.includes(tool) ||
				NOTIFICATION_TOOLS.includes(tool)
					? false
					: tool === 'wait_for_idle' ||
				tool === 'wait_for_command' ||
				tool === 'wait_for_attention'
					? activityAvailable
					: tool === 'rename_terminal'
						? workspaceAvailable || options.renameTerminal !== undefined
						: true,
		})),
	};
}

async function listTerminals(
	options: AdapterOptions,
	context: ControlRequestContext,
): Promise<unknown> {
	const workspaceReach = reachOf(context) === 'workspace';
	const state =
		options.workspace === undefined
			? undefined
			: await options.workspace.load();
	const terminals = options.terminal
		.listSessions()
		.filter((session) =>
			canAddressSession(context, options.terminal.serverId, session, state),
		)
		.map((session) => {
			const activity = activitySnapshot(options.activity, session);
			return {
				terminal: session.sessionId,
				status: session.status,
				output_position: session.outputPosition,
				replay_from: session.replayFrom,
				...(activity === undefined ? {} : { activity }),
				...(workspaceReach
					? workspaceProjectFields(
							options.projectHandles,
							state,
							session.projectId,
						)
					: {}),
			};
		});
	return { terminals };
}

async function readTerminal(
	options: AdapterOptions,
	params: ReadTerminalParams,
	context: ControlRequestContext,
	maxReadBytes: number,
): Promise<unknown> {
	const session = targetSession(options, context, params.terminal);
	const terminal = outputReader(options.terminal);
	const readAuthorization = authorization(
		session,
		options.terminal.serverId,
		'read',
	);
	const responseBudget = Math.min(params.maxBytes, maxReadBytes);
	if (params.format === 'raw') {
		// Base64 expands every complete triple of PTY bytes into four response
		// bytes. Never return a partial Base64 quantum just to use the final one
		// to three requested bytes of budget.
		const rawBudget = Math.floor(responseBudget / 4) * 3;
		const retained = terminal.readRetainedOutput(session, {
			authorization: readAuthorization,
			...(params.after === undefined ? {} : { fromPosition: params.after }),
			maxBytes: Math.max(1, rawBudget),
		});
		const bytes = rawBudget === 0 ? new Uint8Array() : retained.bytes;
		return {
			terminal: session.sessionId,
			format: 'raw',
			encoding: 'base64',
			output: Buffer.from(bytes).toString('base64'),
			from: retained.fromPosition,
			next: retained.fromPosition + bytes.byteLength,
			replay_from: retained.replayFrom,
			output_position: retained.outputPosition,
			history_lost: retained.historyLost,
			truncated_tail:
				retained.fromPosition + bytes.byteLength < retained.outputPosition,
		};
	}
	const presentation = await terminal.readPresentation(session, {
		authorization: readAuthorization,
		format: params.format,
		maxBytes: responseBudget,
		...(params.format === 'text' && params.lines !== undefined
			? { maxRows: params.lines }
			: {}),
	});
	return {
		terminal: session.sessionId,
		format: presentation.format,
		output_position: presentation.outputPosition,
		dimensions: presentation.dimensions,
		presentation_truncated: presentation.truncated,
		dropped_bytes: presentation.droppedBytes,
		dropped_rows: presentation.droppedRows,
		...(presentation.format === 'text'
			? { output: (presentation.rows ?? []).join('\n') }
			: { output: presentation.ansi ?? '' }),
	};
}

async function searchTerminal(
	options: AdapterOptions,
	params: SearchTerminalParams,
	context: ControlRequestContext,
	maxReadBytes: number,
): Promise<unknown> {
	const session = targetSession(options, context, params.terminal);
	const terminal = outputReader(options.terminal);
	// Search is snapshot-only. Obtain a bounded text presentation large enough
	// to search useful scrollback, then independently bound the result object.
	const presentation = await terminal.readPresentation(session, {
		authorization: authorization(session, options.terminal.serverId, 'read'),
		format: 'text',
		maxBytes: Math.max(params.maxBytes, Math.min(maxReadBytes, 64 * 1024)),
	});
	const rows = presentation.rows ?? [];
	const fold = params.caseSensitive
		? (value: string) => value
		: (value: string) => value.toLocaleLowerCase('und');
	const query = fold(params.query);
	const matchingIndexes: number[] = [];
	for (let index = 0; index < rows.length; index += 1) {
		if (fold(rows[index]!).includes(query)) matchingIndexes.push(index);
	}

	const matches: Array<Record<string, unknown>> = [];
	let matchesTruncated = false;
	for (
		let matchOffset = 0;
		matchOffset < matchingIndexes.length;
		matchOffset += 1
	) {
		if (matches.length >= params.maxMatches) {
			matchesTruncated = true;
			break;
		}
		const index = matchingIndexes[matchOffset]!;
		let accepted: Record<string, unknown> | undefined;
		// Prefer the requested surrounding context, then progressively shorten it
		// before omitting a later match. Row indexes identify this snapshot only.
		for (
			let contextLines = params.contextLines;
			contextLines >= 0;
			contextLines -= 1
		) {
			const candidate = {
				row: index,
				text: rows[index]!,
				before: rows.slice(Math.max(0, index - contextLines), index),
				after: rows.slice(
					index + 1,
					Math.min(rows.length, index + contextLines + 1),
				),
			};
			const result = searchResult(
				session.sessionId,
				presentation.dimensions,
				presentation.outputPosition,
				matches.concat(candidate),
				false,
				presentation.truncated,
			);
			if (
				Buffer.byteLength(JSON.stringify(result), 'utf8') <= params.maxBytes
			) {
				accepted = candidate;
				break;
			}
		}
		if (accepted === undefined) {
			matchesTruncated = true;
			break;
		}
		matches.push(accepted);
	}
	if (matches.length < matchingIndexes.length) matchesTruncated = true;
	return searchResult(
		session.sessionId,
		presentation.dimensions,
		presentation.outputPosition,
		matches,
		matchesTruncated,
		presentation.truncated,
	);
}

function searchResult(
	terminal: string,
	dimensions: { readonly cols: number; readonly rows: number },
	outputPosition: number,
	matches: readonly Record<string, unknown>[],
	matchesTruncated: boolean,
	presentationTruncated: boolean,
): Record<string, unknown> {
	return {
		terminal,
		output_position: outputPosition,
		dimensions,
		matches,
		matches_truncated: matchesTruncated,
		presentation_truncated: presentationTruncated,
	};
}

/**
 * The output-read APIs were added to TerminalService after the long-lived
 * server adapter surface. Keep their small structural boundary explicit so
 * an older generated declaration cannot accidentally make this host fall
 * back to subscription/replay behaviour at runtime.
 */
function outputReader(service: TerminalService): TerminalOutputReader {
	return service as TerminalOutputReader;
}

interface TerminalOutputReader {
	readRetainedOutput(
		session: string | TerminalSessionSnapshot,
		options: TerminalRetainedOutputReadOptions,
	): TerminalRetainedOutputRead;
	readPresentation(
		session: string | TerminalSessionSnapshot,
		options: TerminalPresentationReadOptions,
	): Promise<TerminalPresentationRead>;
}

function terminalStatus(
	options: AdapterOptions,
	params: TerminalParams,
	context: ControlRequestContext,
): unknown {
	const session = targetSession(options, context, params.terminal);
	const activity = activitySnapshot(options.activity, session);
	return {
		terminal: session.sessionId,
		status: session.status,
		output_position: session.outputPosition,
		replay_from: session.replayFrom,
		...(session.exit === undefined ? {} : { exit: session.exit }),
		...(activity === undefined ? {} : { activity }),
	};
}

async function openTerminal(
	options: AdapterOptions,
	params: OpenTerminalParams,
	context: ControlRequestContext,
): Promise<unknown> {
	const workspaceReach = reachOf(context) === 'workspace';
	const state =
		workspaceReach && options.workspace !== undefined
			? await options.workspace.load()
			: undefined;
	const projectId = resolveOpenTerminalProject({
		context,
		codec: options.projectHandles,
		state,
		project: params.project,
		liveTerminals: (target) =>
			options.terminal
				.listSessions()
				.filter(
					(session) =>
						session.serverId === options.terminal.serverId &&
						session.projectId === target &&
						session.status === 'running',
				).length,
	});
	// The caller's panel anchors cwd inheritance and the folder only inside its
	// own project. A terminal opened in another project, which only workspace
	// reach allows, goes to that project's General folder. The folder is never
	// an input: it is where the calling terminal already is.
	const caller =
		projectId === context.projectId
			? await callerPanel(options.workspace, context)
			: undefined;
	return createTerminal(options, context, {
		projectId,
		anchor: caller,
		state,
		...(params.name === undefined ? {} : { name: params.name }),
		...(params.cwd === undefined ? {} : { cwd: params.cwd }),
	});
}

/**
 * One new terminal in the target's project and folder, starting where the
 * target's folder starts. Where it appears on screen is the agent's client's
 * to decide (ADR-0070).
 */
async function splitTerminal(
	options: AdapterOptions,
	params: SplitTerminalParams,
	context: ControlRequestContext,
): Promise<unknown> {
	const target = targetSession(options, context, params.terminal);
	const state =
		options.workspace === undefined ? undefined : await options.workspace.load();
	const projectId = target.projectId;
	assertAutomationSpaceCapacity(
		state === undefined
			? projectId === context.projectId && reachOf(context) === 'workspace'
			: findAutomationSpace(state)?.id === projectId,
		options.terminal
			.listSessions()
			.filter(
				(session) =>
					session.serverId === options.terminal.serverId &&
					session.projectId === projectId &&
					session.status === 'running',
			).length,
	);
	const anchor =
		state === undefined
			? undefined
			: Object.values(state.panels).find(
					(
						panel,
					): panel is Extract<WorkspacePanel, { type: 'terminal' }> =>
						panel.type === 'terminal' &&
						panel.projectId === projectId &&
						panel.sessionId === target.sessionId,
				);
	return createTerminal(options, context, {
		projectId,
		anchor,
		state: reachOf(context) === 'workspace' ? state : undefined,
		...(params.name === undefined ? {} : { name: params.name }),
	});
}

async function createTerminal(
	options: AdapterOptions,
	context: ControlRequestContext,
	request: {
		readonly projectId: string;
		readonly anchor: Extract<WorkspacePanel, { type: 'terminal' }> | undefined;
		readonly state: WorkspaceState | undefined;
		readonly name?: string;
		readonly cwd?: string;
	},
): Promise<unknown> {
	const workspaceReach = reachOf(context) === 'workspace';
	const { projectId, anchor } = request;
	// The launch resolver reads the target project's canonical kind, so the
	// new terminal's MCP reach follows where it opens (ADR-0030).
	const launch = await options.launchResolver.resolve({
		identity: options.terminal.allocateIdentity(projectId),
		cols: 80,
		rows: 24,
		...(request.cwd === undefined ? {} : { explicitCwd: request.cwd }),
		...(anchor === undefined
			? {}
			: { activePanelId: anchor.id, folderId: anchor.folderId }),
	});
	const handle = await options.terminal.createResolvedSession(launch);
	// Record the opener before the panel appears, so the terminal is shown
	// under the run that opened it from its first projection.
	if (workspaceReach)
		await recordOpener(options, context.terminalSessionId, handle.sessionId);
	try {
		await reconcileOpenedTerminal(
			options.workspace,
			handle.snapshot(),
			request.name,
			context,
			anchor?.folderId,
		);
	} catch (error) {
		await options.terminal.kill(handle.snapshot()).catch(() => undefined);
		throw error;
	}
	if (workspaceReach)
		return {
			terminal: handle.sessionId,
			...workspaceProjectFields(
				options.projectHandles,
				request.state,
				handle.projectId,
			),
			status: handle.status,
		};
	return {
		terminal: handle.sessionId,
		projectId: handle.projectId,
		status: handle.status,
	};
}

async function recordOpener(
	options: AdapterOptions,
	callerSessionId: string,
	openedSessionId: string,
): Promise<void> {
	try {
		await options.recordOpenedTerminal?.(callerSessionId, openedSessionId);
	} catch {
		// Grouping is presentation; the terminal is open either way.
	}
}

async function callerPanel(
	workspace: WorkspaceRepositoryType | undefined,
	context: ControlRequestContext,
): Promise<Extract<WorkspacePanel, { type: 'terminal' }> | undefined> {
	if (workspace === undefined) return undefined;
	const state = await workspace.load();
	return Object.values(state.panels).find(
		(panel): panel is Extract<WorkspacePanel, { type: 'terminal' }> =>
			panel.type === 'terminal' &&
			panel.projectId === context.projectId &&
			panel.sessionId === context.terminalSessionId,
	);
}

async function reconcileOpenedTerminal(
	workspace: WorkspaceRepositoryType | undefined,
	session: TerminalSessionSnapshot,
	requestedName: string | undefined,
	context: ControlRequestContext,
	folderId: string | undefined,
): Promise<void> {
	if (workspace === undefined) return;
	const state = await workspace.load();
	const panelCount = Object.values(state.panels).filter(
		(panel) =>
			panel.projectId === session.projectId && panel.type === 'terminal',
	).length;
	const result = await workspace.apply({
		commandId: `${context.requestId}.open`.slice(0, 128),
		command: {
			type: 'terminal.createPanel',
			sessionId: session.sessionId,
			projectId: session.projectId,
			...(folderId === undefined ? {} : { folderId }),
			panelId: `p:${session.sessionId}`.slice(0, 128),
			title: requestedName ?? `Terminal ${panelCount + 1}`,
			cwd: session.cwd,
			createdAt: session.createdAt,
		},
	});
	if (!result.ok) {
		throw new ControlEndpointError(
			'internal',
			`The workspace rejected open_terminal at revision ${result.conflict.currentRevision}.`,
		);
	}
}

async function writeTerminal(
	options: AdapterOptions,
	params: WriteTerminalParams,
	context: ControlRequestContext,
): Promise<unknown> {
	const session = targetSession(options, context, params.terminal);
	const text = params.submit === true ? `${params.text}\r` : params.text;
	await options.terminal.write(
		session,
		text,
		authorization(session, options.terminal.serverId, 'write'),
	);
	return {
		terminal: session.sessionId,
		bytes: new TextEncoder().encode(text).byteLength,
		submitted: params.submit === true,
	};
}

async function runCommand(
	options: AdapterOptions,
	params: RunCommandParams,
	context: ControlRequestContext,
): Promise<unknown> {
	const session = targetSession(options, context, params.terminal);
	const auth = authorization(session, options.terminal.serverId, 'write');
	const bracketed = await options.terminal.bracketedPasteMode(session, auth);
	const from =
		options.terminal.getSession(session)?.outputPosition ??
		session.outputPosition;
	const text = commandSubmissionInput(params.command, bracketed);
	await options.terminal.write(session, text, auth);
	return {
		terminal: session.sessionId,
		command_id: context.requestId,
		from,
		submitted_bytes: new TextEncoder().encode(text).byteLength,
		submitted: true,
		bracketed,
	};
}

async function closeTerminal(
	options: AdapterOptions,
	params: TerminalParams,
	context: ControlRequestContext,
): Promise<unknown> {
	const session = targetSession(options, context, params.terminal);
	await options.terminal.kill(
		session,
		authorization(session, options.terminal.serverId, 'write'),
	);
	return { terminal: session.sessionId, closed: true };
}

function waitForIdle(
	options: AdapterOptions,
	params: WaitForIdleParams,
	context: ControlRequestContext,
	signal: AbortSignal,
	maxWaitSeconds: number,
): Promise<unknown> {
	return waitForActivity(
		options,
		params.terminal,
		context,
		signal,
		params.timeout ?? maxWaitSeconds,
		(snapshot) => snapshot.status === 'idle',
		{ terminal: params.terminal, idle: true },
		{ terminal: params.terminal, idle: false },
	);
}

function waitForCommand(
	options: AdapterOptions,
	params: WaitParams,
	context: ControlRequestContext,
	signal: AbortSignal,
	maxWaitSeconds: number,
): Promise<unknown> {
	return waitForActivity(
		options,
		params.terminal,
		context,
		signal,
		params.timeout ?? maxWaitSeconds,
		(snapshot, event) =>
			event !== undefined &&
			snapshot.status === 'idle' &&
			snapshot.exitCode !== undefined &&
			snapshot.source.includes('command'),
		{ terminal: params.terminal, completed: true },
		{ terminal: params.terminal, completed: false },
	);
}

function waitForAttention(
	options: AdapterOptions,
	params: WaitParams,
	context: ControlRequestContext,
	signal: AbortSignal,
	maxWaitSeconds: number,
): Promise<unknown> {
	return waitForActivity(
		options,
		params.terminal,
		context,
		signal,
		params.timeout ?? maxWaitSeconds,
		(snapshot, event) => event !== undefined && snapshot.attention,
		{ terminal: params.terminal, attention: true },
		{ terminal: params.terminal, attention: false },
	);
}

function waitForActivity(
	options: AdapterOptions,
	terminal: string,
	context: ControlRequestContext,
	signal: AbortSignal,
	timeoutSeconds: number,
	predicate: (
		snapshot: NonNullable<ReturnType<TerminalActivityService['get']>>,
		event?: ActivityEvent,
	) => boolean,
	success: Record<string, unknown>,
	timedOut: Record<string, unknown>,
): Promise<unknown> {
	const activity = options.activity;
	if (activity === undefined)
		return Promise.reject(
			new ControlEndpointError(
				'unsupported_op',
				'canonical terminal activity is unavailable',
			),
		);
	const session = targetSession(options, context, terminal);
	const identity = {
		serverId: options.terminal.serverId,
		projectId: session.projectId,
		sessionId: session.sessionId,
	};
	const timers = options.waitTimers ?? GLOBAL_WAIT_TIMERS;
	const initial = activity.get(identity);
	if (initial !== undefined && predicate(initial))
		return Promise.resolve({
			...success,
			terminal: terminal,
			timedOut: false,
			...(initial.exitCode === undefined ? {} : { exitCode: initial.exitCode }),
		});
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void): void => {
			if (settled) return;
			settled = true;
			unsubscribe();
			removeExitSubscription();
			timers.clearTimeout(timer);
			signal.removeEventListener('abort', onAbort);
			callback();
		};
		const onAbort = (): void =>
			finish(() =>
				reject(
					new ControlEndpointError(
						'cancelled',
						'The control operation was cancelled.',
					),
				),
			);
		const removeExit = (event: TerminalEvent): void => {
			if (event.type === 'exit' && event.sessionId === session.sessionId)
				finish(() =>
					reject(
						new ControlEndpointError(
							'terminal_not_found',
							'The requested terminal is unavailable.',
						),
					),
				);
		};
		const unsubscribe = activity.subscribe(
			(_event, snapshot: ActivitySnapshot) => {
				const current = snapshot.sessions[session.sessionId];
				if (current !== undefined && predicate(current, _event))
					finish(() =>
						resolve({
							...success,
							terminal,
							timedOut: false,
							...(current.exitCode === undefined
								? {}
								: { exitCode: current.exitCode }),
						}),
					);
			},
		);
		const removeExitSubscription = options.terminal.onEvent(removeExit);
		const timer = timers.setTimeout(
			() => finish(() => resolve({ ...timedOut, timedOut: true })),
			Math.min(timeoutSeconds, maxSafeWaitSeconds(options)) * 1_000,
		);
		signal.addEventListener('abort', onAbort, { once: true });
	});
}

function targetSession(
	options: AdapterOptions,
	context: ControlRequestContext,
	terminal: string,
): TerminalSessionSnapshot {
	const service = options.terminal;
	const session = service.getSession(terminal);
	if (
		session === undefined ||
		!canAddressSession(
			context,
			service.serverId,
			session,
			options.workspace?.state,
		)
	)
		throw new ControlEndpointError(
			'terminal_not_found',
			'The requested terminal is unavailable.',
		);
	return session;
}

async function applyWorkspaceViewCommand(
	workspace: WorkspaceRepository,
	operation: 'rename_terminal',
	sessionId: string,
	projectId: string,
	context: ControlRequestContext,
	signal: AbortSignal,
	value?: string,
): Promise<unknown> {
	throwIfAborted(signal);
	const state = await workspace.load();
	throwIfAborted(signal);
	const panel = Object.values(state.panels).find(
		(candidate): candidate is Extract<WorkspacePanel, { type: 'terminal' }> =>
			candidate.type === 'terminal' &&
			candidate.sessionId === sessionId &&
			candidate.projectId === projectId,
	);
	if (panel === undefined) {
		throw new ControlEndpointError(
			'terminal_not_found',
			'The requested terminal has no canonical workspace panel.',
		);
	}
	const result = await workspace.apply({
		commandId: `${context.requestId}.${operation}`.slice(0, 128),
		command: {
			type: 'panel.update' as const,
			panelId: panel.id,
			patch: { title: value ?? '' },
		},
	});
	throwIfAborted(signal);
	if (!result.ok) {
		throw new ControlEndpointError(
			'internal',
			`The workspace rejected ${operation} at revision ${result.conflict.currentRevision}.`,
		);
	}
	return { terminal: sessionId, renamed: true, name: value };
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted)
		throw new ControlEndpointError(
			'cancelled',
			'The control operation was cancelled.',
		);
}

function activitySnapshot(
	activity: TerminalActivityService | undefined,
	session: Pick<TerminalSessionSnapshot, 'projectId' | 'sessionId'>,
): ReturnType<TerminalActivityService['get']> | undefined {
	if (activity === undefined) return undefined;
	try {
		return activity.get({
			serverId: activity.serverId,
			projectId: session.projectId,
			sessionId: session.sessionId,
		});
	} catch {
		return undefined;
	}
}

function authorization(
	session: Pick<TerminalSessionSnapshot, 'projectId'>,
	serverId: string,
	scope: 'read' | 'write',
): TerminalAuthorization {
	// Target sessions are authorized by their own project identity, not by
	// the calling session id. `targetSession` has already confirmed the
	// capability reaches that project (its own, or any for workspace reach).
	return { serverId, projectId: session.projectId, scope };
}

function unsupported(operation: string): never {
	throw new ControlEndpointError(
		'unsupported_op',
		`control operation ${operation} is unavailable`,
	);
}
function positive(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new RangeError(`${name} must be positive`);
	return value;
}
function maxSafeWaitSeconds(options: AdapterOptions): number {
	return options.maxWaitSeconds ?? DEFAULT_MAX_WAIT_SECONDS;
}
