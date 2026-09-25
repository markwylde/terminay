import {
	type JsonValue,
	parseWorkspaceDeltaDto,
	parseWorkspaceSnapshotDto,
	protocolError,
	WORKSPACE_DELTA_VERSION,
	type WorkspaceDeltaDto,
} from '@terminay/protocol';
import type {
	AuthenticatedClient,
	CommandRequest,
	OperationRegistries,
	OrderedEvent,
	OrderedEventJournalLike,
	QueryRequest,
} from './types.js';
import { TerminalServiceError } from './terminalService/errors.js';
import {
	AUTOMATION_SPACE_TERMINAL_LIMIT,
	automationSpaceRefusal,
	canSeeAutomationSpace,
	isAutomationSpace,
	type WorkspaceCommand,
	type WorkspaceState,
	WorkspaceStore,
	withholdAutomationSpace,
} from './workspace.js';

/** Protocol operation names for the server-owned workspace boundary. */
export const WORKSPACE_OPERATIONS = Object.freeze({
	snapshot: 'workspace.snapshot',
	delta: 'workspace.delta',
	command: 'workspace.command',
	projectMove: 'project.move',
	projectRootUpdate: 'project.root.update',
	projectShellProfileSet: 'project.shell-profile.set',
	projectShellProfileClear: 'project.shell-profile.clear',
	projectShellProfileReplace: 'project.shell-profile.replace',
} as const);
export const WORKSPACE_EVENT = 'workspace.changed';
/** Typed project lifecycle facts, emitted once per `project.create` /
 * `project.close` command that actually opens or closes a project. The
 * automation space is never reported. */
export const PROJECT_OPENED_EVENT = 'project.opened';
export const PROJECT_CLOSED_EVENT = 'project.closed';

export interface ProjectLifecycleEventPayload {
	readonly serverId: string;
	readonly projectId: string;
	readonly name: string;
	readonly revision: number;
}

export interface PreparedProjectRootUpdate {
	readonly canonicalRoot: string;
	/** Commit runs only after the workspace revision accepts the canonical root,
	 * so dependent services observe the same project root as the workspace. */
	readonly commit: () => Promise<void> | void;
}

export interface WorkspaceOperationRegistryOptions {
	readonly prepareProjectRootUpdate?: (
		projectId: string,
		root: string,
	) => Promise<PreparedProjectRootUpdate>;
	readonly closeTerminalSessions?: (
		sessionIds: readonly string[],
	) => Promise<void> | void;
	readonly closeProjectTerminalSessions?: (
		sessionIds: readonly string[],
	) => Promise<void> | void;
	/**
	 * Runs after `project.close` is applied, whether or not the project had
	 * terminals, so every server-held resource keyed by the project is released
	 * with it. A project move is not a close and does not call this.
	 */
	readonly releaseProject?: (projectId: string) => Promise<void> | void;
	readonly eventJournal?: OrderedEventJournalLike;
	readonly shellProfileExists?: (
		profileId: string,
	) => boolean | Promise<boolean>;
}

export interface WorkspaceOperationRegistry {
	readonly workspace: WorkspaceStore;
	readonly operations: OperationRegistries;
	readonly applyHostCommand: (
		commandId: string,
		command: WorkspaceCommand,
		expectedRevision?: number,
	) => ReturnType<WorkspaceStore['apply']>;
	/** Server-internal: the automation terminal space's project id, created and
	 * published on first use. Never reachable as a client operation. */
	readonly ensureAutomationSpace: (root: string) => string;
}

/**
 * Expose the canonical workspace reducer through the authenticated server
 * dispatcher. The legacy renderer may still carry its project/tab payload for
 * the drag animation and PTY reattachment, but project ownership changes are
 * committed here first and are never authorized by that payload.
 */
export function createWorkspaceOperationRegistry(
	workspace: WorkspaceStore,
	options: WorkspaceOperationRegistryOptions = {},
): WorkspaceOperationRegistry {
	const queries = {
		[WORKSPACE_OPERATIONS.snapshot]: (request: QueryRequest) =>
			parseWorkspaceSnapshotDto(
				projectScopedState(
					connectionVisibleState(workspace.state, request),
					projectClaim(request),
				),
			) as unknown as JsonValue,
		[WORKSPACE_OPERATIONS.delta]: (request: QueryRequest) => {
			const payload = objectPayload(request.envelope.payload);
			const revision = uint(payload.revision, 'revision');
			const cursor = stringField(payload.cursor, 'cursor');
			if (cursor !== String(revision))
				throw protocolError(
					'validation',
					'workspace cursor does not match revision',
				);
			const delta = projectScopedDelta(
				connectionVisibleDelta(workspace.delta(revision), request),
				projectClaim(request),
			);
			const response: WorkspaceDeltaDto = {
				deltaVersion: WORKSPACE_DELTA_VERSION,
				serverId: delta.state.serverId,
				fromRevision: revision,
				fromCursor: cursor,
				revision: delta.state.revision,
				cursor: delta.state.cursor,
				state: delta.state as unknown as WorkspaceDeltaDto['state'],
				events: delta.events,
			};
			return parseWorkspaceDeltaDto(response, {
				serverId: delta.state.serverId,
				revision,
				cursor,
			}) as unknown as JsonValue;
		},
	};

	const commands = {
		[WORKSPACE_OPERATIONS.command]: (request: CommandRequest) =>
			applyCommand(
				workspace,
				options,
				request,
				commandPayload(request.envelope.payload),
			),
		[WORKSPACE_OPERATIONS.projectMove]: (request: CommandRequest) =>
			applyCommand(workspace, options, request, {
				type: 'project.move',
				projectId: stringField(
					objectPayload(request.envelope.payload).projectId,
					'projectId',
				),
				targetViewId: stringField(
					objectPayload(request.envelope.payload).targetViewId,
					'targetViewId',
				),
				...(optionalUInt(objectPayload(request.envelope.payload).index) ===
				undefined
					? {}
					: {
							index: optionalUInt(
								objectPayload(request.envelope.payload).index,
							),
						}),
			}),
		[WORKSPACE_OPERATIONS.projectRootUpdate]: (request: CommandRequest) =>
			updateProjectRoot(workspace, options, request),
		[WORKSPACE_OPERATIONS.projectShellProfileSet]: (request: CommandRequest) =>
			updateProjectShellProfile(workspace, options, request, 'set'),
		[WORKSPACE_OPERATIONS.projectShellProfileClear]: (
			request: CommandRequest,
		) => updateProjectShellProfile(workspace, options, request, 'clear'),
		[WORKSPACE_OPERATIONS.projectShellProfileReplace]: (
			request: CommandRequest,
		) => replaceProjectShellProfiles(workspace, options, request),
	};

	const policies = {
		[WORKSPACE_OPERATIONS.snapshot]: { scope: 'read' as const },
		[WORKSPACE_OPERATIONS.delta]: { scope: 'read' as const },
		[WORKSPACE_OPERATIONS.command]: { scope: 'write' as const },
		[WORKSPACE_OPERATIONS.projectMove]: { scope: 'write' as const },
		[WORKSPACE_OPERATIONS.projectRootUpdate]: { scope: 'write' as const },
		[WORKSPACE_OPERATIONS.projectShellProfileSet]: { scope: 'write' as const },
		[WORKSPACE_OPERATIONS.projectShellProfileClear]: {
			scope: 'write' as const,
		},
		[WORKSPACE_OPERATIONS.projectShellProfileReplace]: {
			scope: 'write' as const,
		},
	};

	return {
		workspace,
		operations: { queries, commands, policies },
		applyHostCommand: (commandId, command, expectedRevision) => {
			const lifecycle = observeProjectLifecycle(workspace, command);
			const applied = workspace.apply({
				commandId,
				command,
				...(expectedRevision === undefined ? {} : { expectedRevision }),
			});
			if (applied.ok) {
				publishWorkspaceChange(
					options.eventJournal,
					workspace,
					commandProjectId(command),
				);
				lifecycle.publish(options.eventJournal);
			}
			return applied;
		},
		ensureAutomationSpace: (root) => {
			const before = workspace.state.revision;
			const projectId = workspace.ensureAutomationSpace({ root });
			if (workspace.state.revision !== before)
				publishWorkspaceChange(options.eventJournal, workspace, projectId);
			return projectId;
		},
	};
}

/** Terminal-creation guard for the automation space, checked before any PTY
 * is spawned: a connection that cannot see the space cannot target it, and the
 * space refuses a terminal beyond its live-terminal limit. */
export function automationSpaceSessionGuard(
	workspace: WorkspaceStore,
): (request: CommandRequest, projectId: string) => void {
	return (request, projectId) => {
		const state = workspace.state;
		if (!isAutomationSpace(state.projects[projectId])) return;
		if (!canSeeAutomationSpace(request.context.clientCapabilities))
			throw new TerminalServiceError('forbidden', 'project not found');
		const refusal = automationSpaceRefusal(state, {
			type: 'terminal.create',
			sessionId: 'automation-space-guard',
			projectId,
		});
		if (refusal !== undefined)
			throw new TerminalServiceError('session_limit', refusal, {
				projectId,
				max: AUTOMATION_SPACE_TERMINAL_LIMIT,
			});
	};
}

/** Whether an exited session is still retained for viewing: a terminal in
 * the automation space whose panel is still open (a kept run terminal, or one
 * a run opened through MCP). It stays viewable, read-only, until a person
 * closes it. Sessions in ordinary projects are never retained this way. */
export function automationSpaceRetainsExitedSession(
	workspace: WorkspaceStore,
): (identity: {
	readonly projectId: string;
	readonly sessionId: string;
}) => boolean {
	return (identity) => {
		const state = workspace.state;
		if (!isAutomationSpace(state.projects[identity.projectId])) return false;
		return Object.values(state.panels).some(
			(panel) =>
				panel.type === 'terminal' &&
				panel.projectId === identity.projectId &&
				panel.sessionId === identity.sessionId,
		);
	};
}

/** A connection that did not negotiate `automations.v1` never learns of the
 * automation space, its panels, or its terminals (ADR-0029). */
function connectionVisibleState(
	state: WorkspaceState,
	request: QueryRequest | CommandRequest,
): WorkspaceState {
	return canSeeAutomationSpace(request.context.clientCapabilities)
		? state
		: withholdAutomationSpace(state);
}

function connectionVisibleDelta(
	delta: ReturnType<WorkspaceStore['delta']>,
	request: QueryRequest,
): ReturnType<WorkspaceStore['delta']> {
	if (canSeeAutomationSpace(request.context.clientCapabilities)) return delta;
	const hiddenIds = automationSpaceIds(delta.state);
	if (hiddenIds.size === 0) return delta;
	return {
		state: withholdAutomationSpace(delta.state),
		events: delta.events.filter(
			(event) => !event.changedIds.some((id) => hiddenIds.has(id)),
		),
	};
}

function automationSpaceIds(state: WorkspaceState): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const project of Object.values(state.projects))
		if (isAutomationSpace(project)) ids.add(project.id);
	for (const panel of Object.values(state.panels))
		if (ids.has(panel.projectId)) ids.add(panel.id);
	for (const session of Object.values(state.terminalSessions))
		if (ids.has(session.projectId)) ids.add(session.id);
	return ids;
}

/** Refuse, with a bounded non-retryable error, a command the automation space
 * never accepts, and hide the space from a connection that cannot see it. */
function enforceAutomationSpace(
	state: WorkspaceState,
	request: CommandRequest,
	command: WorkspaceCommand,
): void {
	if (
		!canSeeAutomationSpace(request.context.clientCapabilities) &&
		commandProjectIds(state, command).some((projectId) =>
			isAutomationSpace(state.projects[projectId]),
		)
	)
		throw protocolError('conflict', 'project not found');
	const refusal = automationSpaceRefusal(state, command);
	if (refusal !== undefined) throw protocolError('forbidden', refusal);
}

async function updateProjectShellProfile(
	workspace: WorkspaceStore,
	options: WorkspaceOperationRegistryOptions,
	request: CommandRequest,
	action: 'set' | 'clear',
): Promise<{ readonly result: JsonValue; readonly revision: number }> {
	const payload = objectPayload(request.envelope.payload);
	const projectId = stringField(payload.projectId, 'projectId');
	const claim = projectClaim(request);
	if (claim !== undefined && claim !== projectId)
		throw protocolError(
			'forbidden',
			'project shell profile update is outside the authenticated project scope',
		);
	let command: WorkspaceCommand;
	if (action === 'set') {
		const profileId = stringField(payload.profileId, 'profileId');
		if (
			options.shellProfileExists === undefined ||
			!(await options.shellProfileExists(profileId))
		) {
			throw protocolError(
				'validation',
				'shell profile does not exist on this server',
			);
		}
		command = { type: 'project.shellProfile.set', projectId, profileId };
	} else command = { type: 'project.shellProfile.clear', projectId };
	return applyCommand(workspace, options, request, command);
}

async function replaceProjectShellProfiles(
	workspace: WorkspaceStore,
	options: WorkspaceOperationRegistryOptions,
	request: CommandRequest,
): Promise<{ readonly result: JsonValue; readonly revision: number }> {
	if (projectClaim(request) !== undefined)
		throw protocolError(
			'forbidden',
			'bulk profile replacement requires server scope',
		);
	const payload = objectPayload(request.envelope.payload);
	const fromProfileId = stringField(payload.fromProfileId, 'fromProfileId');
	const toProfileId =
		payload.toProfileId === null || payload.toProfileId === undefined
			? undefined
			: stringField(payload.toProfileId, 'toProfileId');
	if (
		toProfileId !== undefined &&
		(options.shellProfileExists === undefined ||
			!(await options.shellProfileExists(toProfileId)))
	) {
		throw protocolError(
			'validation',
			'replacement shell profile does not exist on this server',
		);
	}
	return applyCommand(workspace, options, request, {
		type: 'project.shellProfile.replace',
		fromProfileId,
		...(toProfileId === undefined ? {} : { toProfileId }),
	});
}

async function updateProjectRoot(
	workspace: WorkspaceStore,
	options: WorkspaceOperationRegistryOptions,
	request: CommandRequest,
): Promise<{ readonly result: JsonValue; readonly revision: number }> {
	if (options.prepareProjectRootUpdate === undefined)
		throw protocolError('unavailable', 'project root updates are unavailable');
	const payload = objectPayload(request.envelope.payload);
	const projectId = stringField(payload.projectId, 'projectId');
	const root = rootField(payload.root);
	const expectedRevision =
		payload.expectedRevision === undefined
			? request.envelope.expectedRevision
			: uint(payload.expectedRevision, 'expectedRevision');
	if (
		request.envelope.expectedRevision !== undefined &&
		expectedRevision !== request.envelope.expectedRevision
	) {
		throw protocolError(
			'validation',
			'project root expected revision is ambiguous',
		);
	}
	const claimedProjectId = projectClaim(request);
	if (claimedProjectId !== undefined && claimedProjectId !== projectId) {
		throw protocolError(
			'forbidden',
			'project root update is outside the authenticated project scope',
		);
	}
	if (workspace.state.projects[projectId] === undefined)
		throw protocolError('conflict', 'project not found');
	enforceAutomationSpace(workspace.state, request, {
		type: 'project.root.update',
		projectId,
		root,
	});
	if (
		expectedRevision !== undefined &&
		expectedRevision !== workspace.state.revision
	) {
		throw staleWorkspace(workspace);
	}
	let prepared: PreparedProjectRootUpdate;
	try {
		prepared = await options.prepareProjectRootUpdate(projectId, root);
	} catch {
		throw protocolError(
			'validation',
			'project root is not an accessible directory',
		);
	}
	if (
		typeof prepared.canonicalRoot !== 'string' ||
		prepared.canonicalRoot.length === 0 ||
		prepared.canonicalRoot.length > 4096 ||
		prepared.canonicalRoot.includes('\0') ||
		typeof prepared.commit !== 'function'
	) {
		throw protocolError(
			'internal',
			'project root preparation returned an invalid result',
		);
	}
	const applied = workspace.apply({
		commandId: request.envelope.commandId,
		...(expectedRevision === undefined ? {} : { expectedRevision }),
		command: {
			type: 'project.root.update',
			projectId,
			root: prepared.canonicalRoot,
		},
	});
	if (!applied.ok) throw staleWorkspace(workspace, applied.conflict.message);
	await prepared.commit();
	publishWorkspaceChange(options.eventJournal, workspace, projectId);
	return {
		result: {
			projectId,
			root: prepared.canonicalRoot,
			revision: applied.revision,
			cursor: applied.cursor,
		},
		revision: applied.revision,
	};
}

async function applyCommand(
	workspace: WorkspaceStore,
	options: WorkspaceOperationRegistryOptions,
	request: CommandRequest,
	command: WorkspaceCommand,
): Promise<{ readonly result: JsonValue; readonly revision: number }> {
	enforceProjectClaim(workspace.state, request, command);
	enforceAutomationSpace(workspace.state, request, command);
	if (
		command.type === 'project.create' &&
		options.prepareProjectRootUpdate !== undefined
	) {
		let prepared: PreparedProjectRootUpdate;
		try {
			prepared = await options.prepareProjectRootUpdate(
				command.projectId,
				command.root,
			);
		} catch {
			throw protocolError(
				'validation',
				'project root is not an accessible directory',
			);
		}
		if (
			typeof prepared.canonicalRoot !== 'string' ||
			prepared.canonicalRoot.length === 0 ||
			prepared.canonicalRoot.length > 4096 ||
			prepared.canonicalRoot.includes('\0') ||
			typeof prepared.commit !== 'function'
		) {
			throw protocolError(
				'internal',
				'project root preparation returned an invalid result',
			);
		}
		const lifecycle = observeProjectLifecycle(workspace, command);
		const applied = workspace.apply({
			commandId: request.envelope.commandId,
			expectedRevision: request.envelope.expectedRevision,
			command: { ...command, root: prepared.canonicalRoot },
		});
		if (!applied.ok)
			throw protocolError('conflict', applied.conflict.message, {
				retryable: true,
				details: {
					currentRevision: applied.conflict.currentRevision,
					currentCursor: applied.conflict.currentCursor,
				},
			});
		await prepared.commit();
		publishWorkspaceChange(options.eventJournal, workspace, command.projectId);
		lifecycle.publish(options.eventJournal);
		return {
			result: {
				revision: applied.revision,
				cursor: applied.cursor,
				projectId: command.projectId,
			},
			revision: applied.revision,
		};
	}
	const sessionIdsToClose = terminalSessionIdsClosedBy(
		workspace.state,
		command,
	);
	if (sessionIdsToClose.length > 0) {
		await options.closeTerminalSessions?.(sessionIdsToClose);
		if (command.type === 'project.close')
			await options.closeProjectTerminalSessions?.(sessionIdsToClose);
	}
	const lifecycle = observeProjectLifecycle(workspace, command);
	const applied = workspace.apply({
		commandId: request.envelope.commandId,
		expectedRevision: request.envelope.expectedRevision,
		command,
	});
	if (!applied.ok)
		throw protocolError('conflict', applied.conflict.message, {
			retryable: true,
			details: {
				currentRevision: applied.conflict.currentRevision,
				currentCursor: applied.conflict.currentCursor,
			},
		});
	if (command.type === 'project.close')
		await options.releaseProject?.(command.projectId);
	publishWorkspaceChange(
		options.eventJournal,
		workspace,
		commandProjectId(command),
	);
	lifecycle.publish(options.eventJournal);
	return {
		result: {
			revision: applied.revision,
			cursor: applied.cursor,
			projectId: command.type === 'project.move' ? command.projectId : null,
		},
		revision: applied.revision,
	};
}

function terminalSessionIdsClosedBy(
	state: WorkspaceState,
	command: WorkspaceCommand,
): readonly string[] {
	if (command.type === 'project.close') {
		return Object.values(state.terminalSessions)
			.filter((session) => session.projectId === command.projectId)
			.map((session) => session.id);
	}
	if (command.type === 'panel.close') {
		const panel = state.panels[command.panelId];
		return panel?.type === 'terminal' ? [panel.sessionId] : [];
	}
	return [];
}

function enforceProjectClaim(
	state: WorkspaceState,
	request: CommandRequest,
	command: WorkspaceCommand,
): void {
	const claimedProjectId = projectClaim(request);
	if (claimedProjectId === undefined) return;
	const projectIds = commandProjectIds(state, command);
	if (
		projectIds.length === 0 ||
		projectIds.some((projectId) => projectId !== claimedProjectId)
	) {
		throw protocolError(
			'forbidden',
			'project command is outside the authenticated project scope',
		);
	}
}

/** Resolve authorization from canonical objects, never merely from ids chosen
 * by the caller. Object-derived panel/session commands are security boundaries
 * because their wire payloads do not carry a source project id. */
function commandProjectIds(
	state: WorkspaceState,
	command: WorkspaceCommand,
): readonly string[] {
	switch (command.type) {
		case 'project.create':
		case 'project.activate':
		case 'project.rename':
		case 'project.update':
		case 'project.sidebar.update':
		case 'project.move':
		case 'project.close':
		case 'project.root.update':
		case 'project.shellProfile.set':
		case 'project.shellProfile.clear':
		case 'terminal.create':
		case 'terminal.createPanel':
		case 'panel.reorder':
		case 'panel.split':
		case 'panel.activate':
			return [command.projectId];
		case 'panel.create':
			return [command.panel.projectId];
		case 'panel.update':
		case 'panel.close': {
			const panel = state.panels[command.panelId];
			return panel === undefined ? [] : [panel.projectId];
		}
		case 'panel.move': {
			const panel = state.panels[command.panelId];
			return panel === undefined
				? []
				: [panel.projectId, command.targetProjectId];
		}
		case 'terminal.markInterrupted':
		case 'terminal.markExited': {
			const session = state.terminalSessions[command.sessionId];
			return session === undefined ? [] : [session.projectId];
		}
		case 'project.shellProfile.replace':
		case 'view.create':
		case 'view.rename':
		case 'view.close':
			return [];
	}
}

/** A project claim is a read boundary as well as a command boundary. Never
 * hand another project's paths, panel identifiers, or terminal identities to
 * a scoped client merely because the state reducer is shared. */
function projectScopedState(
	state: WorkspaceState,
	projectId: string | undefined,
): WorkspaceState {
	if (projectId === undefined) return state;
	const project = state.projects[projectId];
	if (project === undefined) {
		return {
			...state,
			viewOrder: [],
			views: {},
			projects: {},
			panels: {},
			terminalSessions: {},
		};
	}
	const view = state.views[project.viewId];
	if (view === undefined) throw new Error('workspace project view is missing');
	const panels = Object.fromEntries(
		project.panelIds
			.map((id) => [id, state.panels[id]])
			.filter(([, panel]) => panel !== undefined),
	);
	const terminalSessions = Object.fromEntries(
		Object.entries(state.terminalSessions).filter(
			([, session]) => session.projectId === projectId,
		),
	);
	return {
		...state,
		viewOrder: [view.id],
		views: {
			[view.id]: {
				...view,
				projectIds: [project.id],
				activeProjectId: project.id,
			},
		},
		projects: { [project.id]: project },
		panels,
		terminalSessions,
	};
}

function projectScopedDelta(
	delta: ReturnType<WorkspaceStore['delta']>,
	projectId: string | undefined,
): ReturnType<WorkspaceStore['delta']> {
	if (projectId === undefined) return delta;
	const state = projectScopedState(delta.state, projectId);
	const visibleIds = new Set([
		...Object.keys(state.views),
		...Object.keys(state.projects),
		...Object.keys(state.panels),
		...Object.keys(state.terminalSessions),
	]);
	const events = delta.events.flatMap((event) => {
		// Command ids and revisions are also metadata. Do not retain a mixed
		// event by stripping only its IDs: its command id can still name another
		// project. Scoped clients receive only wholly-owned change records.
		return event.changedIds.every((id) => visibleIds.has(id)) ? [event] : [];
	});
	return { state, events };
}

function projectClaim(
	request: QueryRequest | CommandRequest,
): string | undefined {
	const claims = request.context.claims;
	return claims !== undefined &&
		typeof claims === 'object' &&
		claims !== null &&
		!Array.isArray(claims) &&
		typeof claims.projectId === 'string'
		? claims.projectId
		: undefined;
}

function commandPayload(value: JsonValue): WorkspaceCommand {
	const payload = objectPayload(value);
	if (payload.command === undefined)
		throw protocolError('validation', 'workspace command is required');
	const command = objectPayload(payload.command);
	if (typeof command.type !== 'string')
		throw protocolError('validation', 'workspace command type is required');
	if (command.type === WORKSPACE_OPERATIONS.projectRootUpdate) {
		throw protocolError(
			'validation',
			'project root updates require the named operation',
		);
	}
	if (
		command.type === 'project.shellProfile.set' ||
		command.type === 'project.shellProfile.clear' ||
		command.type === 'project.shellProfile.replace'
	) {
		throw protocolError(
			'validation',
			'project shell profile defaults require the named operations',
		);
	}
	if (command.type === 'terminal.markExited') {
		throw protocolError('forbidden', 'terminal exit marks are host-owned');
	}
	return command as unknown as WorkspaceCommand;
}

function objectPayload(value: JsonValue): Record<string, JsonValue> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw protocolError('validation', 'workspace payload must be an object');
	return value as Record<string, JsonValue>;
}

function stringField(value: JsonValue | undefined, name: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 128)
		throw protocolError('validation', `${name} is invalid`);
	return value;
}

function rootField(value: JsonValue | undefined): string {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.length > 4096 ||
		value.includes('\0')
	) {
		throw protocolError('validation', 'project root is invalid');
	}
	return value;
}

function staleWorkspace(
	workspace: WorkspaceStore,
	message = 'workspace revision is stale',
) {
	return protocolError('conflict', message, {
		retryable: true,
		details: {
			currentRevision: workspace.state.revision,
			currentCursor: workspace.state.cursor,
		},
	});
}

function uint(value: JsonValue | undefined, name: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 0)
		throw protocolError('validation', `${name} is invalid`);
	return value as number;
}

function optionalUInt(value: JsonValue | undefined): number | undefined {
	return value === undefined ? undefined : uint(value, 'index');
}

function commandProjectId(command: WorkspaceCommand): string | null {
	return 'projectId' in command && typeof command.projectId === 'string'
		? command.projectId
		: null;
}

/** A project-claimed client only learns of its own project's lifecycle. */
export function projectLifecycleEventProjector(
	event: OrderedEvent,
	client: AuthenticatedClient | undefined,
): OrderedEvent | undefined {
	if (event.event !== PROJECT_OPENED_EVENT && event.event !== PROJECT_CLOSED_EVENT)
		return event;
	const claims = client?.claims as unknown;
	const claimed =
		typeof claims === 'object' &&
		claims !== null &&
		!Array.isArray(claims) &&
		typeof (claims as Record<string, unknown>).projectId === 'string'
			? ((claims as Record<string, unknown>).projectId as string)
			: undefined;
	if (claimed === undefined) return event;
	const payload = event.payload;
	return typeof payload === 'object' &&
		payload !== null &&
		!Array.isArray(payload) &&
		payload.projectId === claimed
		? event
		: undefined;
}

/**
 * Capture a project's presence before a `project.create` / `project.close`
 * command so the typed lifecycle event is published only when the command
 * actually opened or closed it — never for an idempotent replay, a refused
 * command, or the reserved automation space.
 */
function observeProjectLifecycle(
	workspace: WorkspaceStore,
	command: WorkspaceCommand,
): { readonly publish: (journal: OrderedEventJournalLike | undefined) => void } {
	if (command.type !== 'project.create' && command.type !== 'project.close')
		return { publish: () => undefined };
	const before = workspace.state.projects[command.projectId];
	return {
		publish: (journal) => {
			if (journal === undefined) return;
			const state = workspace.state;
			const after = state.projects[command.projectId];
			const project =
				command.type === 'project.create'
					? before === undefined
						? after
						: undefined
					: after === undefined
						? before
						: undefined;
			if (project === undefined || isAutomationSpace(project)) return;
			const payload: ProjectLifecycleEventPayload = {
				serverId: state.serverId,
				projectId: project.id,
				name: project.name,
				revision: state.revision,
			};
			journal.append(
				command.type === 'project.create'
					? PROJECT_OPENED_EVENT
					: PROJECT_CLOSED_EVENT,
				payload as unknown as JsonValue,
			);
		},
	};
}

function publishWorkspaceChange(
	eventJournal: OrderedEventJournalLike | undefined,
	workspace: WorkspaceStore,
	projectId: string | null,
): void {
	if (eventJournal === undefined) return;
	eventJournal.append(WORKSPACE_EVENT, {
		serverId: workspace.state.serverId,
		revision: workspace.state.revision,
		cursor: workspace.state.cursor,
		projectId,
	});
}
