import type { JsonValue } from '@terminay/protocol';
import {
	isAutomationSpace,
	type WorkspaceCommand,
	type WorkspaceState,
	type WorkspaceViewOp,
	type WorkspaceViewRelay,
	type WorkspaceViewTarget,
} from '@terminay/server-core';
import {
	type ControlRequestContext,
	ControlEndpointError,
} from './controlEndpoint.js';
import { type ProjectHandleCodec, reachOf } from './workspaceReach.js';
import type {
	TabRef,
	WorkspaceViewControlAdapter,
} from './workspaceViewTools.js';

/**
 * Binds the view tools to the relay and the workspace (ADR-0070). Every
 * project, folder, tab, and terminal is resolved against the caller's scope
 * here, before the agent's client is asked anything; the client's answer is
 * then checked, cut down to that scope, and given project handles, before the
 * agent sees it. The client chooses nothing about authority.
 */

export interface WorkspaceViewAdapterOptions {
	readonly relay: Pick<WorkspaceViewRelay, 'request'>;
	/** The client the caller is talking from, if there is one. */
	readonly targetFor: (caller: {
		readonly terminalSessionId: string;
		readonly projectId: string;
		readonly chatId?: string;
	}) => WorkspaceViewTarget | undefined;
	readonly state: () => WorkspaceState | Promise<WorkspaceState>;
	/** Apply a workspace command for the caller; throws when it is refused. */
	readonly apply: (
		command: WorkspaceCommand,
		context: ControlRequestContext,
	) => void | Promise<void>;
	readonly projectHandles: ProjectHandleCodec;
}

/** A tab as the client is asked to find it. */
type WireTab = { readonly tab?: string; readonly sessionId?: string };

interface Resolved {
	readonly projectId?: string;
	readonly target: WireTab;
	readonly sessionId?: string;
}

/** Deepest split the client may describe, and most panes and tabs. */
const MAX_LAYOUT_DEPTH = 16;
const MAX_LAYOUT_PANES = 128;
const MAX_LAYOUT_TABS = 256;
const MAX_TITLE_CHARS = 256;
const TAB_KINDS = new Set(['terminal', 'file', 'folder', 'other']);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function createWorkspaceViewAdapter(
	options: WorkspaceViewAdapterOptions,
): WorkspaceViewControlAdapter {
	const { projectHandles } = options;

	/** Whether the caller reaches a project of this server. */
	const reaches = (
		context: ControlRequestContext,
		state: WorkspaceState,
		projectId: string,
	): boolean =>
		state.projects[projectId] !== undefined &&
		(reachOf(context) === 'workspace' || projectId === context.projectId);

	/** A project handle the caller named, as a project it reaches. */
	const namedProject = (
		context: ControlRequestContext,
		state: WorkspaceState,
		handle: string | undefined,
	): string | undefined => {
		if (handle === undefined)
			return reachOf(context) === 'workspace' ? undefined : context.projectId;
		if (reachOf(context) !== 'workspace')
			throw new ControlEndpointError(
				'bad_request',
				'project is available only to callers that reach every project',
			);
		const projectId = projectHandles.resolve(handle, state);
		if (projectId === undefined || !reaches(context, state, projectId))
			throw new ControlEndpointError(
				'not_found',
				'The requested project is unavailable.',
			);
		return projectId;
	};

	/**
	 * A tab reference: a terminal handle, a server panel id, or the client's
	 * own tab id. Terminals and server panels are checked against scope here;
	 * a client tab id is looked for only inside the projects the caller
	 * reaches, which the request's project bounds.
	 */
	const resolveTab = (
		context: ControlRequestContext,
		state: WorkspaceState,
		ref: TabRef,
	): Resolved => {
		const session = state.terminalSessions[ref];
		if (session !== undefined) {
			if (!reaches(context, state, session.projectId))
				throw tabNotFound();
			return {
				projectId: session.projectId,
				target: { sessionId: ref },
				sessionId: ref,
			};
		}
		const panel = state.panels[ref];
		if (panel !== undefined) {
			if (!reaches(context, state, panel.projectId)) throw tabNotFound();
			return {
				projectId: panel.projectId,
				target:
					panel.type === 'terminal'
						? { tab: ref, sessionId: panel.sessionId }
						: { tab: ref },
				...(panel.type === 'terminal' ? { sessionId: panel.sessionId } : {}),
			};
		}
		return {
			...(reachOf(context) === 'workspace'
				? {}
				: { projectId: context.projectId }),
			target: { tab: ref },
		};
	};

	const ask = (
		context: ControlRequestContext,
		op: WorkspaceViewOp,
		params: Record<string, JsonValue | undefined>,
		projectId: string | undefined,
		signal: AbortSignal,
	): Promise<Record<string, unknown>> =>
		requestAgentView(options, context, op, params, projectId, signal);

	/** The agent's description of a layout the client reported. */
	const describe = async (
		context: ControlRequestContext,
		reply: Record<string, unknown>,
	): Promise<Record<string, unknown>> => {
		const state = await options.state();
		return describeLayout(context, state, reply.layout, {
			reaches: (projectId) => reaches(context, state, projectId),
			handle: (projectId) => projectHandles.handleFor(projectId),
		});
	};

	/** Ask, then answer with what the client now shows. */
	const viewChange = async (
		context: ControlRequestContext,
		op: WorkspaceViewOp,
		params: Record<string, JsonValue | undefined>,
		projectId: string | undefined,
		signal: AbortSignal,
		extra: (reply: Record<string, unknown>) => Record<string, unknown> = () => ({}),
	): Promise<Record<string, unknown>> => {
		const reply = await ask(context, op, params, projectId, signal);
		return { ...extra(reply), layout: await describe(context, reply) };
	};

	const folderInScope = (
		context: ControlRequestContext,
		state: WorkspaceState,
		folderId: string,
	) => {
		const folder = state.folders[folderId];
		if (folder === undefined || !reaches(context, state, folder.projectId))
			throw new ControlEndpointError(
				'not_found',
				'The requested folder is unavailable.',
			);
		return folder;
	};

	return {
		getLayout: async (params, context, signal) => {
			const state = await options.state();
			const projectId = namedProject(context, state, params.project);
			const reply = await ask(context, 'layout', { projectId }, projectId, signal);
			return describe(context, reply);
		},
		focusTab: async (params, context, signal) => {
			const state = await options.state();
			const tab = resolveTab(context, state, params.tab);
			return viewChange(
				context,
				'focus',
				{ projectId: tab.projectId, tab: tab.target },
				tab.projectId,
				signal,
				() => ({ tab: params.tab, focused: true }),
			);
		},
		moveTab: async (params, context, signal) => {
			const state = await options.state();
			const tab = resolveTab(context, state, params.tab);
			const beside = resolveTab(context, state, params.beside);
			const projectId = tab.projectId ?? beside.projectId;
			if (
				tab.projectId !== undefined &&
				beside.projectId !== undefined &&
				tab.projectId !== beside.projectId
			)
				throw new ControlEndpointError(
					'bad_request',
					'Both tabs must be in the same project. Use move_tab_to_folder or open a terminal there instead.',
				);
			return viewChange(
				context,
				'place',
				{
					projectId,
					tab: tab.target,
					beside: beside.target,
					position: params.position,
					focus: false,
				},
				projectId,
				signal,
				() => ({ tab: params.tab, moved: true }),
			);
		},
		resizePane: async (params, context, signal) => {
			const state = await options.state();
			const tab = resolveTab(context, state, params.tab);
			return viewChange(
				context,
				'resize',
				{
					projectId: tab.projectId,
					tab: tab.target,
					width: params.width,
					height: params.height,
				},
				tab.projectId,
				signal,
				() => ({ tab: params.tab, resized: true }),
			);
		},
		arrangeTabs: async (params, context, signal) => {
			const state = await options.state();
			let projectId = namedProject(context, state, params.project);
			const tabs = params.tabs?.map((ref) => resolveTab(context, state, ref));
			for (const tab of tabs ?? []) {
				if (tab.projectId === undefined) continue;
				if (projectId !== undefined && projectId !== tab.projectId)
					throw new ControlEndpointError(
						'bad_request',
						'Every tab arranged together must be in the same project.',
					);
				projectId = tab.projectId;
			}
			return viewChange(
				context,
				'arrange',
				{
					projectId,
					arrangement: params.arrangement,
					tabs: tabs?.map((tab) => tab.target),
				},
				projectId,
				signal,
				() => ({ arranged: params.arrangement }),
			);
		},
		focusProject: async (params, context, signal) => {
			const state = await options.state();
			const projectId = namedProject(context, state, params.project);
			if (projectId === undefined) throw new Error('unreachable');
			if (isAutomationSpace(state.projects[projectId]))
				throw new ControlEndpointError(
					'bad_request',
					'The automation space is shown in the Automations section, not as a project tab.',
				);
			return viewChange(
				context,
				'showProject',
				{ projectId },
				projectId,
				signal,
				() => ({ project: params.project, focused: true }),
			);
		},
		selectFolder: async (params, context, signal) => {
			const state = await options.state();
			const folder = folderInScope(context, state, params.folder);
			return viewChange(
				context,
				'selectFolder',
				{ projectId: folder.projectId, folderId: folder.id },
				folder.projectId,
				signal,
				() => ({ folder: folder.id, selected: true }),
			);
		},
		createFolder: async (params, context) => {
			const state = await options.state();
			const projectId =
				namedProject(context, state, params.project) ?? context.projectId;
			if (!reaches(context, state, projectId))
				throw new ControlEndpointError(
					'not_found',
					'The requested project is unavailable.',
				);
			const before = new Set(Object.keys(state.folders));
			await applyOrRefuse(options, context, {
				type: 'folder.create',
				projectId,
				name: params.name,
			});
			const after = await options.state();
			const created = Object.values(after.folders).find(
				(folder) => folder.projectId === projectId && !before.has(folder.id),
			);
			if (created === undefined)
				throw new ControlEndpointError(
					'internal',
					'The folder was not created.',
				);
			return { folder: created.id, name: created.name, created: true };
		},
		renameFolder: async (params, context) => {
			const state = await options.state();
			const folder = folderInScope(context, state, params.folder);
			if (folder.kind !== 'plain')
				throw new ControlEndpointError(
					'bad_request',
					'Only a folder you made can be renamed.',
				);
			await applyOrRefuse(options, context, {
				type: 'folder.rename',
				folderId: folder.id,
				name: params.name,
			});
			return { folder: folder.id, name: params.name, renamed: true };
		},
		moveTabToFolder: async (params, context) => {
			const state = await options.state();
			const folder = folderInScope(context, state, params.folder);
			const tab = resolveTab(context, state, params.tab);
			const panel =
				tab.sessionId === undefined
					? state.panels[params.tab]
					: Object.values(state.panels).find(
							(candidate) =>
								candidate.type === 'terminal' &&
								candidate.sessionId === tab.sessionId,
						);
			if (panel === undefined)
				throw new ControlEndpointError(
					'not_found',
					'Only a terminal tab can be moved to a folder.',
				);
			if (panel.projectId !== folder.projectId)
				throw new ControlEndpointError(
					'bad_request',
					'A tab moves only between folders of its own project.',
				);
			await applyOrRefuse(options, context, {
				type: 'panel.moveToFolder',
				panelId: panel.id,
				folderId: folder.id,
			});
			return { tab: params.tab, folder: folder.id, moved: true };
		},
		openFile: async (params, context, signal) => {
			const state = await options.state();
			const projectId = namedProject(context, state, params.project);
			return viewChange(
				context,
				'openFile',
				{ projectId, path: params.path },
				projectId,
				signal,
				(reply) => ({
					...(typeof reply.tab === 'string' && ID_PATTERN.test(reply.tab)
						? { tab: reply.tab }
						: {}),
					opened: true,
				}),
			);
		},
		closeTab: async (params, context, signal) => {
			const state = await options.state();
			const tab = resolveTab(context, state, params.tab);
			return viewChange(
				context,
				'closeTab',
				{ projectId: tab.projectId, tab: tab.target },
				tab.projectId,
				signal,
				(reply) => ({ tab: params.tab, closed: reply.closed === true }),
			);
		},
		anchorFor: async (request, context, signal) => {
			const state = await options.state();
			const project = (projectId: string | undefined) =>
				request.project !== undefined ||
				projectId === undefined ||
				reachOf(context) !== 'workspace'
					? request.project
					: projectHandles.handleFor(projectId);
			if (request.beside !== undefined) {
				const beside = resolveTab(context, state, request.beside);
				return {
					beside: request.beside,
					...optional('project', project(beside.projectId)),
				};
			}
			if (!request.placing) return optional('project', request.project);
			// The calling terminal, when there is one and it is a tab.
			if (state.terminalSessions[context.terminalSessionId] !== undefined) {
				const caller = state.terminalSessions[context.terminalSessionId]!;
				return {
					beside: context.terminalSessionId,
					...optional('project', project(caller.projectId)),
				};
			}
			// A chat: whatever is in front on its client.
			const reply = await ask(context, 'layout', {}, undefined, signal);
			const layout = isRecord(reply.layout) ? reply.layout : {};
			const projectId =
				typeof layout.projectId === 'string' &&
				reaches(context, state, layout.projectId)
					? layout.projectId
					: undefined;
			const focused =
				projectId !== undefined &&
				typeof layout.focusedTab === 'string' &&
				ID_PATTERN.test(layout.focusedTab)
					? layout.focusedTab
					: undefined;
			return {
				...optional('beside', focused),
				...optional('project', project(projectId)),
			};
		},
		placeTerminal: async (params, context, signal) => {
			try {
				if (params.beside === undefined && !params.focus) return {};
				const state = await options.state();
				const terminal = resolveTab(context, state, params.terminal);
				if (params.beside === undefined)
					return await viewChange(
						context,
						'focus',
						{ projectId: terminal.projectId, tab: terminal.target },
						terminal.projectId,
						signal,
						() => ({ placed: true, focused: true }),
					);
				const beside = resolveTab(context, state, params.beside);
				await sameFolder(options, context, state, terminal, beside);
				return await viewChange(
					context,
					'place',
					{
						projectId: terminal.projectId,
						tab: terminal.target,
						beside: beside.target,
						position: params.position ?? 'right',
						focus: params.focus,
					},
					terminal.projectId,
					signal,
					() => ({
						placed: true,
						beside: params.beside,
						position: params.position ?? 'right',
						focused: params.focus,
					}),
				);
			} catch (error) {
				// The terminal is open whatever happened to its placement. Say
				// so, and why, rather than pretend or lose it.
				const reason =
					error instanceof ControlEndpointError
						? `${error.code}: ${error.message}`
						: error instanceof Error
							? error.message
							: 'The terminal could not be placed.';
				return { placed: false, reason: reason.slice(0, 512) };
			}
		},
	};
}

/**
 * Ask the agent's client to apply one view operation, and answer with its
 * reply. Fails with `renderer_unavailable` when the caller has no client.
 */
export async function requestAgentView(
	options: Pick<WorkspaceViewAdapterOptions, 'relay' | 'targetFor'>,
	context: ControlRequestContext,
	op: WorkspaceViewOp,
	params: Record<string, JsonValue | undefined>,
	projectId: string | undefined,
	signal: AbortSignal,
): Promise<Record<string, unknown>> {
	const target = options.targetFor({
		terminalSessionId: context.terminalSessionId,
		projectId: context.projectId,
		...(context.chat === undefined ? {} : { chatId: context.chat.chatId }),
	});
	if (target === undefined)
		throw new ControlEndpointError(
			'renderer_unavailable',
			context.chat === undefined
				? 'No Terminay window is showing your terminal, so there is no view to read or change.'
				: 'No Terminay window has sent this chat a message since it connected, so there is no view to read or change.',
		);
	let reply: JsonValue;
	try {
		reply = await options.relay.request(
			target,
			op,
			withoutUndefined(params),
			projectId,
			signal,
		);
	} catch (error) {
		throw viewError(error);
	}
	if (!isRecord(reply))
		throw new ControlEndpointError(
			'internal',
			'The Terminay window gave an invalid answer.',
		);
	return reply;
}

/**
 * A terminal placed beside another is first put in that terminal's folder, on
 * the server, because a folder's panes hold only that folder's tabs.
 */
async function sameFolder(
	options: WorkspaceViewAdapterOptions,
	context: ControlRequestContext,
	state: WorkspaceState,
	terminal: Resolved,
	beside: Resolved,
): Promise<void> {
	const panelOf = (resolved: Resolved) =>
		resolved.sessionId === undefined
			? resolved.target.tab === undefined
				? undefined
				: state.panels[resolved.target.tab]
			: Object.values(state.panels).find(
					(panel) =>
						panel.type === 'terminal' && panel.sessionId === resolved.sessionId,
				);
	const moving = panelOf(terminal);
	const anchor = panelOf(beside);
	if (moving === undefined || anchor === undefined) return;
	if (moving.projectId !== anchor.projectId)
		throw new ControlEndpointError(
			'bad_request',
			'A terminal can be placed only beside a tab of its own project.',
		);
	if (moving.folderId === anchor.folderId) return;
	await applyOrRefuse(options, context, {
		type: 'panel.moveToFolder',
		panelId: moving.id,
		folderId: anchor.folderId,
	});
}

async function applyOrRefuse(
	options: WorkspaceViewAdapterOptions,
	context: ControlRequestContext,
	command: WorkspaceCommand,
): Promise<void> {
	try {
		await options.apply(command, context);
	} catch (error) {
		if (error instanceof ControlEndpointError) throw error;
		throw new ControlEndpointError(
			'bad_request',
			error instanceof Error
				? `The workspace refused that: ${error.message}`.slice(0, 512)
				: 'The workspace refused that.',
		);
	}
}

/**
 * Turn the client's layout into the agent's, keeping only what the caller
 * reaches. Throws when the client's answer is not a layout.
 */
export function describeLayout(
	context: Pick<ControlRequestContext, 'reach'>,
	state: WorkspaceState,
	raw: unknown,
	scope: {
		readonly reaches: (projectId: string) => boolean;
		readonly handle: (projectId: string) => string;
	},
): Record<string, unknown> {
	if (!isRecord(raw) || typeof raw.projectId !== 'string')
		throw invalidLayout();
	const projectId = raw.projectId;
	if (!scope.reaches(projectId)) throw invalidLayout();
	const workspaceReach = reachOf(context) === 'workspace';
	const project = state.projects[projectId]!;
	const shownFolder =
		typeof raw.folderId === 'string' &&
		state.folders[raw.folderId]?.projectId === projectId
			? raw.folderId
			: undefined;
	const budget = { panes: 0, tabs: 0 };
	const inScopeSession = (sessionId: string): boolean => {
		const session = state.terminalSessions[sessionId];
		return session !== undefined && session.projectId === projectId;
	};
	const node = (value: unknown, depth: number): Record<string, unknown> => {
		if (!isRecord(value) || depth > MAX_LAYOUT_DEPTH) throw invalidLayout();
		if (value.split === 'row' || value.split === 'column') {
			if (!Array.isArray(value.children) || value.children.length === 0)
				throw invalidLayout();
			const children = value.children.map((child) => {
				if (!isRecord(child)) throw invalidLayout();
				const size =
					typeof child.size === 'number' &&
					Number.isFinite(child.size) &&
					child.size >= 0 &&
					child.size <= 1
						? Math.round(child.size * 1000) / 1000
						: undefined;
				return { ...(size === undefined ? {} : { size }), ...node(child, depth + 1) };
			});
			return { split: value.split, children };
		}
		if (typeof value.pane !== 'string' || !Array.isArray(value.tabs))
			throw invalidLayout();
		budget.panes += 1;
		if (budget.panes > MAX_LAYOUT_PANES) throw invalidLayout();
		const tabs = value.tabs.flatMap((tab) => {
			if (!isRecord(tab) || typeof tab.tab !== 'string' || !ID_PATTERN.test(tab.tab))
				return [];
			budget.tabs += 1;
			if (budget.tabs > MAX_LAYOUT_TABS) throw invalidLayout();
			const sessionId = typeof tab.sessionId === 'string' ? tab.sessionId : undefined;
			// A terminal outside the caller's project is not the caller's to see.
			if (sessionId !== undefined && !inScopeSession(sessionId)) return [];
			const kind =
				typeof tab.kind === 'string' && TAB_KINDS.has(tab.kind) ? tab.kind : 'other';
			if (kind === 'terminal' && sessionId === undefined) return [];
			return [
				{
					tab: tab.tab,
					...(sessionId === undefined ? {} : { terminal: sessionId }),
					kind,
					title:
						typeof tab.title === 'string'
							? tab.title.slice(0, MAX_TITLE_CHARS)
							: '',
					active: tab.active === true,
				},
			];
		});
		return {
			pane: ID_PATTERN.test(value.pane) ? value.pane : `pane-${budget.panes}`,
			tabs,
		};
	};
	const root = raw.root === undefined || raw.root === null ? undefined : node(raw.root, 0);
	const tabIds = new Set<string>();
	const collect = (value: Record<string, unknown> | undefined): void => {
		if (value === undefined) return;
		if (Array.isArray(value.children))
			for (const child of value.children as Record<string, unknown>[]) collect(child);
		if (Array.isArray(value.tabs))
			for (const tab of value.tabs as { tab: string }[]) tabIds.add(tab.tab);
	};
	collect(root);
	const folders = Object.values(state.folders)
		.filter((folder) => folder.projectId === projectId)
		.map((folder) => ({
			folder: folder.id,
			name: folder.name,
			kind: folder.kind,
			selected: folder.id === shownFolder,
		}));
	const shownProjectId =
		typeof raw.shownProjectId === 'string' ? raw.shownProjectId : undefined;
	return {
		...(workspaceReach
			? { project: scope.handle(projectId), project_title: project.name }
			: {}),
		visible: shownProjectId === projectId,
		...(workspaceReach
			? {
					projects: Object.values(state.projects)
						.filter((candidate) => !isAutomationSpace(candidate))
						.map((candidate) => ({
							project: scope.handle(candidate.id),
							title: candidate.name,
							visible: candidate.id === shownProjectId,
						})),
				}
			: {}),
		...(shownFolder === undefined ? {} : { folder: shownFolder }),
		folders,
		...(root === undefined ? {} : { root }),
		...(typeof raw.focusedTab === 'string' && tabIds.has(raw.focusedTab)
			? { focused_tab: raw.focusedTab }
			: {}),
	};
}

function viewError(error: unknown): ControlEndpointError {
	if (error instanceof ControlEndpointError) return error;
	const code = (error as { code?: unknown } | null)?.code;
	const reason = (error as { reason?: unknown } | null)?.reason;
	const message =
		error instanceof Error ? error.message : 'The view request failed.';
	if (code === 'cancelled') return new ControlEndpointError('cancelled', message);
	if (code === 'unavailable')
		return new ControlEndpointError('renderer_unavailable', message);
	if (code === 'refused')
		return new ControlEndpointError(
			reason === 'not_found'
				? 'not_found'
				: reason === 'bad_request'
					? 'bad_request'
					: reason === 'unavailable'
						? 'renderer_unavailable'
						: 'conflict',
			message,
		);
	return new ControlEndpointError('internal', message);
}

function tabNotFound(): ControlEndpointError {
	return new ControlEndpointError(
		'not_found',
		'The requested tab is unavailable.',
	);
}

function invalidLayout(): ControlEndpointError {
	return new ControlEndpointError(
		'internal',
		'The Terminay window described an invalid layout.',
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optional<K extends string, V>(
	key: K,
	value: V | undefined,
): { [P in K]?: V } {
	return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

function withoutUndefined(
	params: Record<string, JsonValue | undefined>,
): Record<string, JsonValue> {
	const result: Record<string, JsonValue> = {};
	for (const [key, value] of Object.entries(params))
		if (value !== undefined) result[key] = value;
	return result;
}
