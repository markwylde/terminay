import { createHmac, randomBytes } from 'node:crypto';
import {
	AUTOMATION_SPACE_TERMINAL_LIMIT,
	findAutomationSpace,
	type WorkspaceState,
} from '@terminay/server-core';
import {
	type ControlCapabilityScope,
	ControlEndpointError,
	type ControlReach,
} from './controlEndpoint.js';
import { PROJECT_HANDLE_PATTERN } from './dispatcher.js';

/**
 * Workspace reach (ADR-0028) for MCP adapters. A capability's reach is fixed
 * when it is minted; nothing here reads a caller-supplied value to decide it.
 * These helpers are shared by every host adapter so project reach keeps its
 * exact contract and workspace reach widens only which terminals are
 * addressable on the same server.
 */

export function reachOf(
	context: Pick<ControlCapabilityScope, 'reach'>,
): ControlReach {
	return context.reach === 'workspace' ? 'workspace' : 'project';
}

/** Whether a capability may address a session. Never crosses servers. */
export function canAddressSession(
	context: Pick<ControlCapabilityScope, 'projectId' | 'reach'>,
	serverId: string,
	session: { readonly serverId: string; readonly projectId: string },
): boolean {
	if (session.serverId !== serverId) return false;
	return reachOf(context) === 'workspace'
		? true
		: session.projectId === context.projectId;
}

export function isProjectHandle(value: unknown): value is string {
	return typeof value === 'string' && PROJECT_HANDLE_PATTERN.test(value);
}

/**
 * Opaque project handles for workspace-reach listings. A handle is a keyed
 * digest of the server and project identity, so it names a project without
 * disclosing its id, and a handle minted by another adapter instance (another
 * server, or a previous run) resolves to nothing.
 */
export class ProjectHandleCodec {
	private readonly key: Buffer;

	constructor(
		private readonly serverId: string,
		key: Uint8Array = randomBytes(32),
	) {
		this.key = Buffer.from(key);
	}

	handleFor(projectId: string): string {
		const digest = createHmac('sha256', this.key)
			.update(this.serverId, 'utf8')
			.update('\0')
			.update(projectId, 'utf8')
			.digest('base64url');
		return `prj_${digest.slice(0, 22)}`;
	}

	/** The project on this server a handle names, or undefined. */
	resolve(handle: string, state: WorkspaceState): string | undefined {
		if (!isProjectHandle(handle) || state.serverId !== this.serverId)
			return undefined;
		for (const project of Object.values(state.projects))
			if (
				project.serverId === this.serverId &&
				this.handleFor(project.id) === handle
			)
				return project.id;
		return undefined;
	}
}

/** Per-row project identity added to a workspace-reach listing. */
export function workspaceProjectFields(
	codec: ProjectHandleCodec,
	state: WorkspaceState | undefined,
	projectId: string,
): { readonly project: string; readonly project_title?: string } {
	const title = state?.projects[projectId]?.name;
	return {
		project: codec.handleFor(projectId),
		...(title === undefined ? {} : { project_title: title }),
	};
}

/**
 * The project an `open_terminal` creates its terminal in. Project reach always
 * opens in the caller's project and refuses a project handle. Workspace reach
 * opens in the automation space unless a handle from a listing names a project,
 * and respects the automation-space terminal cap with a bounded error.
 */
export function resolveOpenTerminalProject(options: {
	readonly context: Pick<ControlCapabilityScope, 'projectId' | 'reach'>;
	readonly codec: ProjectHandleCodec;
	readonly state: WorkspaceState | undefined;
	readonly project: string | undefined;
	/** Live (running) terminals currently in a project. */
	readonly liveTerminals: (projectId: string) => number;
}): string {
	const { context, codec, state, project } = options;
	if (reachOf(context) === 'project') {
		if (project !== undefined)
			throw new ControlEndpointError(
				'bad_request',
				'project is available only to automation terminals',
			);
		return context.projectId;
	}
	let target: string | undefined;
	if (project !== undefined) {
		target = state === undefined ? undefined : codec.resolve(project, state);
		if (target === undefined)
			throw new ControlEndpointError(
				'not_found',
				'The requested project is unavailable.',
			);
	} else {
		// The caller is itself in the automation space; the canonical space is
		// preferred so a stale context can never pick an ordinary project.
		target =
			(state === undefined ? undefined : findAutomationSpace(state)?.id) ??
			context.projectId;
	}
	assertAutomationSpaceCapacity(
		state === undefined
			? target === context.projectId
			: findAutomationSpace(state)?.id === target,
		options.liveTerminals(target),
	);
	return target;
}

/** Bounded refusal once the automation space holds its live-terminal cap. */
export function assertAutomationSpaceCapacity(
	isAutomationSpace: boolean,
	liveTerminals: number,
): void {
	if (isAutomationSpace && liveTerminals >= AUTOMATION_SPACE_TERMINAL_LIMIT)
		throw new ControlEndpointError(
			'limit_exceeded',
			`The automation space has reached its limit of ${AUTOMATION_SPACE_TERMINAL_LIMIT} live terminals.`,
		);
}
