import { randomUUID } from 'node:crypto';
import type { JsonValue } from '@terminay/protocol';
import {
	isAutomationSpace,
	WORKSPACE_OPERATIONS,
	type WorkspaceCommand,
	type WorkspaceProject,
	type WorkspaceState,
	type WorkspaceViewRelay,
	type WorkspaceViewTarget,
} from '@terminay/server-core';
import type { AppControlAdapter } from './appControlTools.js';
import {
	ControlEndpointError,
	type ControlRequestContext,
} from './controlEndpoint.js';
import {
	type ProjectHandleCodec,
	reachOf,
	type WindowHandleCodec,
} from './workspaceReach.js';
import { requestAgentView } from './workspaceViewAdapter.js';

/**
 * Binds the project and window tools (ADR-0072) to the server's workspace
 * operations. Every change is the same server command a user's own change is,
 * issued as the MCP principal; nothing here writes the workspace directly or
 * asks a client to decide anything. Projects and windows are named only by
 * opaque handles, resolved here against the caller's reach on every request.
 */

export interface AppControlAdapterOptions {
	readonly state: () => WorkspaceState | Promise<WorkspaceState>;
	/**
	 * Run one server operation as the MCP principal and resolve with its
	 * result. A refusal is thrown as the operation's own protocol error.
	 */
	readonly command: (
		operation: string,
		payload: JsonValue,
		signal: AbortSignal,
	) => Promise<unknown>;
	readonly projectHandles: ProjectHandleCodec;
	readonly windowHandles: WindowHandleCodec;
	/**
	 * A root as the start chooser's Open a folder choice resolves it: `~`
	 * expanded to the server account's home, canonical, and an existing
	 * directory now. Throws the chooser's typed refusal. Lists nothing.
	 */
	readonly canonicalFolder: (root: string) => Promise<string>;
	/** Launch a project's first terminal through the normal launch resolver. */
	readonly openFirstTerminal: (
		projectId: string,
		context: ControlRequestContext,
	) => Promise<string>;
	/**
	 * A fresh foreground sample of a project's terminals: how many run a
	 * program other than their shell. Throws when the sample cannot complete.
	 */
	readonly busyTerminals: (
		projectId: string,
		signal: AbortSignal,
	) => Promise<number>;
	/** Live terminals in a project, counted busy when a sample fails. */
	readonly liveTerminals: (projectId: string) => number;
	/** The agent's client; without it nothing is shown or presented. */
	readonly view?: {
		readonly relay: Pick<WorkspaceViewRelay, 'request'>;
		readonly targetFor: (caller: {
			readonly terminalSessionId: string;
			readonly projectId: string;
			readonly chatId?: string;
		}) => WorkspaceViewTarget | undefined;
	};
}

/** Projects one listing returns; the rest are reported as truncated. */
export const MAX_LISTED_PROJECTS = 256;
/** Workspace windows one listing returns. */
export const MAX_LISTED_WINDOWS = 64;

const AUTOMATION_SPACE_REFUSAL =
	'The automation space is part of Home; it cannot be renamed, edited, moved, or closed.';

export function createAppControlAdapter(
	options: AppControlAdapterOptions,
): AppControlAdapter {
	const { projectHandles, windowHandles } = options;

	/** A project handle the caller named, as a project it reaches. */
	const resolveProject = (
		context: ControlRequestContext,
		state: WorkspaceState,
		handle: string | undefined,
	): WorkspaceProject => {
		const projectId =
			handle === undefined
				? reachOf(context) === 'workspace'
					? undefined
					: context.projectId
				: projectHandles.resolve(handle, state);
		const project =
			projectId === undefined ? undefined : state.projects[projectId];
		if (
			project === undefined ||
			(reachOf(context) !== 'workspace' && project.id !== context.projectId)
		)
			throw new ControlEndpointError(
				handle === undefined ? 'bad_request' : 'not_found',
				handle === undefined
					? 'project must be a project handle from list_projects'
					: 'The requested project is unavailable.',
			);
		return project;
	};

	/** A project the caller may change: never the automation space. */
	const changeableProject = (
		context: ControlRequestContext,
		state: WorkspaceState,
		handle: string | undefined,
	): WorkspaceProject => {
		const project = resolveProject(context, state, handle);
		if (isAutomationSpace(project))
			throw new ControlEndpointError('bad_request', AUTOMATION_SPACE_REFUSAL);
		return project;
	};

	const resolveWindow = (state: WorkspaceState, handle: string): string => {
		const viewId = windowHandles.resolve(handle, state);
		if (viewId === undefined || state.views[viewId] === undefined)
			throw new ControlEndpointError(
				'not_found',
				'The requested window is unavailable.',
			);
		return viewId;
	};

	const run = async (
		operation: string,
		payload: JsonValue,
		signal: AbortSignal,
	): Promise<unknown> => {
		try {
			return await options.command(operation, payload, signal);
		} catch (error) {
			throw serverError(error);
		}
	};

	const apply = (command: WorkspaceCommand, signal: AbortSignal) =>
		run(
			WORKSPACE_OPERATIONS.command,
			{ command } as unknown as JsonValue,
			signal,
		);

	/** Ask the agent's client; undefined when there is none to ask. */
	const askClient = async (
		context: ControlRequestContext,
		op: 'layout' | 'showProject' | 'presentView',
		params: Record<string, JsonValue | undefined>,
		projectId: string | undefined,
		signal: AbortSignal,
	): Promise<Record<string, unknown>> => {
		if (options.view === undefined)
			throw new ControlEndpointError(
				'renderer_unavailable',
				'This host cannot show anything in a Terminay window.',
			);
		return requestAgentView(
			options.view,
			context,
			op,
			params,
			projectId,
			signal,
		);
	};

	/** The window the agent's client shows, or the server's first window. */
	const shownWindow = async (
		context: ControlRequestContext,
		state: WorkspaceState,
		signal: AbortSignal,
	): Promise<string> => {
		const first = state.viewOrder[0];
		try {
			const reply = await askClient(context, 'layout', {}, undefined, signal);
			const layout = isRecord(reply.layout) ? reply.layout : {};
			const shown =
				typeof layout.projectId === 'string'
					? state.projects[layout.projectId]
					: undefined;
			if (
				shown !== undefined &&
				!isAutomationSpace(shown) &&
				state.views[shown.viewId] !== undefined
			)
				return shown.viewId;
		} catch {
			// No client, or one with no project in front: the first window.
		}
		if (first === undefined)
			throw new ControlEndpointError(
				'internal',
				'This server has no workspace window.',
			);
		return first;
	};

	const describeProject = (
		state: WorkspaceState,
		project: WorkspaceProject,
	): Record<string, unknown> => {
		const automation = isAutomationSpace(project);
		const view = automation ? undefined : state.views[project.viewId];
		const rooted = project.rootOrigin !== 'none' && project.root.length > 0;
		return {
			project: projectHandles.handleFor(project.id),
			name: project.name,
			...(project.icon === undefined ? {} : { icon: project.icon }),
			...(project.color === undefined ? {} : { color: project.color }),
			...(automation
				? { automation_space: true }
				: {
						root: rooted ? project.root : null,
						root_folder: rooted,
					}),
			...(project.defaultShellProfileId === undefined
				? {}
				: { default_shell_profile: project.defaultShellProfileId }),
			...(view === undefined
				? {}
				: {
						window: windowHandles.handleFor(view.id),
						position: view.projectIds.indexOf(project.id),
					}),
		};
	};

	return {
		listProjects: async (_params, context) => {
			const state = await options.state();
			const workspace = reachOf(context) === 'workspace';
			const inReach: WorkspaceProject[] = [];
			if (workspace) {
				// Window order, then position: the order a user sees them in.
				for (const viewId of state.viewOrder)
					for (const projectId of state.views[viewId]?.projectIds ?? []) {
						const project = state.projects[projectId];
						if (project !== undefined && !isAutomationSpace(project))
							inReach.push(project);
					}
				for (const project of Object.values(state.projects))
					if (isAutomationSpace(project)) inReach.push(project);
			} else {
				const own = state.projects[context.projectId];
				if (own !== undefined) inReach.push(own);
			}
			const listed = inReach.slice(0, MAX_LISTED_PROJECTS);
			return {
				projects: listed.map((project) => describeProject(state, project)),
				...(listed.length < inReach.length ? { truncated: true } : {}),
			};
		},
		createProject: async (params, context, signal) => {
			requireWorkspaceReach(context);
			const state = await options.state();
			const viewId =
				params.window === undefined
					? await shownWindow(context, state, signal)
					: resolveWindow(state, params.window);
			// The folder is validated before anything exists, so a root that
			// fails creates nothing. `~` alone is the home directory choice.
			const folder =
				params.root === '~'
					? undefined
					: await options.canonicalFolder(params.root).catch((error) => {
							throw serverError(error);
						});
			const projectId = `project-${randomUUID()}`;
			await apply(
				{
					type: 'project.create',
					projectId,
					viewId,
					root: '',
					...(params.name === undefined ? {} : { name: params.name }),
					...(params.icon === undefined ? {} : { icon: params.icon }),
					...(params.color === undefined ? {} : { color: params.color }),
				} as WorkspaceCommand,
				signal,
			);
			try {
				await startProject(projectId, folder, signal);
			} catch (error) {
				// A project that could not start is not left waiting for a choice.
				await apply({ type: 'project.close', projectId }, signal).catch(
					() => undefined,
				);
				throw error;
			}
			let terminal: string | undefined;
			let terminalFailure: string | undefined;
			try {
				terminal = await options.openFirstTerminal(projectId, context);
			} catch (error) {
				terminalFailure = reasonOf(error);
			}
			let shown = false;
			let reason: string | undefined;
			try {
				await askClient(
					context,
					'showProject',
					{ projectId },
					projectId,
					signal,
				);
				shown = true;
			} catch (error) {
				reason = reasonOf(error);
			}
			const after = await options.state();
			const created = after.projects[projectId];
			return {
				...(created === undefined
					? { project: projectHandles.handleFor(projectId) }
					: describeProject(after, created)),
				...(terminal === undefined
					? { terminal_reason: terminalFailure }
					: { terminal }),
				shown,
				...(reason === undefined ? {} : { reason }),
			};
		},
		updateProject: async (params, context, signal) => {
			const state = await options.state();
			const project = changeableProject(context, state, params.project);
			if (
				reachOf(context) !== 'workspace' &&
				(params.root !== undefined || params.shellProfile !== undefined)
			)
				// The dispatcher refuses these fields first; this never widens it.
				throw new ControlEndpointError(
					'out_of_scope',
					'Only the name, icon, and colour of your own project can be changed from a project terminal.',
				);
			// A new root is validated before anything changes.
			const root =
				params.root === undefined
					? undefined
					: await options.canonicalFolder(params.root).catch((error) => {
							throw serverError(error);
						});
			// As the project editor saves: the root first, which rebinds the
			// project's file services, then its name, icon and colour.
			const rebound =
				root !== undefined && (await rebindRoot(project.id, root, signal));
			if (
				params.name !== undefined ||
				params.icon !== undefined ||
				params.color !== undefined ||
				(root !== undefined && !rebound)
			) {
				const current = (await options.state()).projects[project.id] ?? project;
				await apply(
					{
						type: 'project.update',
						projectId: project.id,
						name: params.name ?? current.name,
						root: rebound ? current.root : (root ?? current.root),
						...(params.icon === undefined ? {} : { icon: params.icon }),
						...(params.color === undefined ? {} : { color: params.color }),
					},
					signal,
				);
			}
			if (params.shellProfile !== undefined)
				await run(
					params.shellProfile === null
						? WORKSPACE_OPERATIONS.projectShellProfileClear
						: WORKSPACE_OPERATIONS.projectShellProfileSet,
					params.shellProfile === null
						? { projectId: project.id }
						: { projectId: project.id, profileId: params.shellProfile },
					signal,
				);
			const after = await options.state();
			const updated = after.projects[project.id];
			return updated === undefined
				? { project: projectHandles.handleFor(project.id) }
				: { ...describeProject(after, updated), updated: true };
		},
		moveProject: async (params, context, signal) => {
			requireWorkspaceReach(context);
			const state = await options.state();
			const project = changeableProject(context, state, params.project);
			const targetViewId =
				params.window === undefined
					? project.viewId
					: resolveWindow(state, params.window);
			await run(
				WORKSPACE_OPERATIONS.projectMove,
				{
					projectId: project.id,
					targetViewId,
					...(params.position === undefined ? {} : { index: params.position }),
				},
				signal,
			);
			const after = await options.state();
			const moved = after.projects[project.id];
			return moved === undefined
				? { project: params.project }
				: { ...describeProject(after, moved), moved: true };
		},
		closeProject: async (params, context, signal) => {
			requireWorkspaceReach(context);
			const state = await options.state();
			const project = changeableProject(context, state, params.project);
			if (!params.force) {
				// A sample that cannot complete counts every live terminal busy:
				// an unattended caller errs towards keeping work.
				const busy = await options
					.busyTerminals(project.id, signal)
					.catch(() => options.liveTerminals(project.id));
				if (busy > 0)
					throw new ControlEndpointError(
						'busy',
						`${busy} ${busy === 1 ? 'terminal' : 'terminals'} in this project ${busy === 1 ? 'is' : 'are'} running a program. Pass force: true to close it anyway.`,
					);
			}
			await apply({ type: 'project.close', projectId: project.id }, signal);
			return { project: params.project, closed: true };
		},
		listWorkspaceWindows: async (_params, context) => {
			requireWorkspaceReach(context);
			const state = await options.state();
			const windows = state.viewOrder.flatMap((viewId) => {
				const view = state.views[viewId];
				return view === undefined ? [] : [view];
			});
			const listed = windows.slice(0, MAX_LISTED_WINDOWS);
			return {
				windows: listed.map((view) => ({
					window: windowHandles.handleFor(view.id),
					name: view.name,
					projects: view.projectIds
						.filter(
							(projectId) => !isAutomationSpace(state.projects[projectId]),
						)
						.slice(0, MAX_LISTED_PROJECTS)
						.map((projectId) => projectHandles.handleFor(projectId)),
				})),
				...(listed.length < windows.length ? { truncated: true } : {}),
			};
		},
		openWorkspaceWindow: async (params, context, signal) => {
			requireWorkspaceReach(context);
			const state = await options.state();
			// Every project is resolved before the window exists, so a bad
			// handle creates nothing.
			const projects = params.projects.map((handle) =>
				changeableProject(context, state, handle),
			);
			const viewId = `view-${randomUUID()}`;
			await apply(
				{
					type: 'view.create',
					viewId,
					name: params.name ?? projects[0]?.name ?? 'Window',
				},
				signal,
			);
			for (const project of projects)
				await run(
					WORKSPACE_OPERATIONS.projectMove,
					{ projectId: project.id, targetViewId: viewId },
					signal,
				);
			let presented = false;
			let reason: string | undefined;
			try {
				await askClient(context, 'presentView', { viewId }, undefined, signal);
				presented = true;
			} catch (error) {
				reason = reasonOf(error);
			}
			return {
				window: windowHandles.handleFor(viewId),
				projects: params.projects,
				presented,
				...(reason === undefined ? {} : { reason }),
			};
		},
		renameWorkspaceWindow: async (params, context, signal) => {
			requireWorkspaceReach(context);
			const viewId = resolveWindow(await options.state(), params.window);
			await apply({ type: 'view.rename', viewId, name: params.name }, signal);
			return { window: params.window, name: params.name, renamed: true };
		},
		closeWorkspaceWindow: async (params, context, signal) => {
			requireWorkspaceReach(context);
			const state = await options.state();
			const viewId = resolveWindow(state, params.window);
			const held = (state.views[viewId]?.projectIds ?? []).filter(
				(projectId) => !isAutomationSpace(state.projects[projectId]),
			).length;
			if (held > 0)
				throw new ControlEndpointError(
					'conflict',
					`This window still holds ${held} ${held === 1 ? 'project' : 'projects'}. Move them with move_project or close them with close_project first.`,
				);
			if (state.viewOrder.length <= 1)
				throw new ControlEndpointError(
					'conflict',
					'This is the last window on this server, so it cannot be closed.',
				);
			await apply({ type: 'view.close', viewId }, signal);
			return { window: params.window, closed: true };
		},
	};

	/**
	 * Start a just-created project the way the start chooser does: the home
	 * directory choice, or a folder. A server without the chooser created it
	 * started already, and a folder then becomes its root.
	 */
	async function startProject(
		projectId: string,
		folder: string | undefined,
		signal: AbortSignal,
	): Promise<void> {
		const awaiting =
			(await options.state()).projects[projectId]?.start !== undefined;
		if (awaiting) {
			await run(
				WORKSPACE_OPERATIONS.projectStart,
				{
					projectId,
					choice:
						folder === undefined
							? { kind: 'home' }
							: { kind: 'folder', path: folder },
				},
				signal,
			);
			return;
		}
		const project = (await options.state()).projects[projectId];
		if (
			folder !== undefined &&
			project !== undefined &&
			!(await rebindRoot(projectId, folder, signal))
		)
			await apply(
				{ type: 'project.update', projectId, name: project.name, root: folder },
				signal,
			);
	}

	/**
	 * Give a project a canonical root through the server's root update, which
	 * rebinds its file services. False when this server has no such update,
	 * so the root goes with the project's own update instead.
	 */
	async function rebindRoot(
		projectId: string,
		root: string,
		signal: AbortSignal,
	): Promise<boolean> {
		try {
			await run(
				WORKSPACE_OPERATIONS.projectRootUpdate,
				{ projectId, root },
				signal,
			);
			return true;
		} catch (error) {
			if (
				error instanceof ControlEndpointError &&
				error.code === 'unsupported_op'
			)
				return false;
			throw error;
		}
	}
}

/** App-level tools need workspace reach; the dispatcher checks it first. */
function requireWorkspaceReach(context: ControlRequestContext): void {
	if (reachOf(context) !== 'workspace')
		throw new ControlEndpointError(
			'out_of_scope',
			'This tool needs workspace reach; an agent in a project terminal acts only on its own project.',
		);
}

/** A server operation's refusal, as a bounded public control error. */
function serverError(error: unknown): ControlEndpointError {
	if (error instanceof ControlEndpointError) return error;
	const record = isRecord(error) ? error : undefined;
	const code =
		(error as { code?: unknown } | null)?.code ?? record?.code ?? undefined;
	const message =
		typeof (error as { message?: unknown } | null)?.message === 'string'
			? (error as { message: string }).message || 'The server refused that.'
			: 'The server refused that.';
	const reason =
		(error as { reason?: unknown } | null)?.reason ??
		(isRecord(record?.details) ? record.details.reason : undefined);
	const detail = typeof reason === 'string' ? ` (${reason})`.slice(0, 64) : '';
	const bounded = `${message}${detail}`.slice(0, 512);
	// A protocol refusal carries a code; the start chooser's folder refusal
	// carries only its reason.
	switch (typeof code === 'string' ? code : reason) {
		case 'validation':
		case 'invalid_path':
		case 'not_directory':
			return new ControlEndpointError('bad_request', bounded);
		case 'not_found':
		case 'path_missing':
			return new ControlEndpointError('not_found', bounded);
		case 'forbidden':
		case 'unreadable':
			return new ControlEndpointError('forbidden', bounded);
		case 'conflict':
			return new ControlEndpointError('conflict', bounded);
		case 'unavailable':
			return new ControlEndpointError('unsupported_op', bounded);
		default:
			return new ControlEndpointError('internal', bounded);
	}
}

function reasonOf(error: unknown): string {
	const message =
		error instanceof ControlEndpointError
			? `${error.code}: ${error.message}`
			: error instanceof Error
				? error.message
				: 'It could not be shown.';
	return message.slice(0, 512);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
