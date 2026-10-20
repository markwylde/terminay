/**
 * Apply an MCP agent's view requests to this window (ADR-0070).
 *
 * The server sends a request only to the window the agent is talking from,
 * after checking everything it names against the agent's scope. This window
 * applies it to its own panes, with the moves the user's own hands make, and
 * answers with what it now shows. Nothing here reaches the server's
 * workspace: which tab is in front and how panes are split stay this
 * window's own.
 */

import {
	serveWorkspaceView,
	type TerminayClient,
	TerminayClientFacade,
	type WorkspaceViewRequest,
	WorkspaceViewRefusal,
} from '@terminay/client-core';
import { FEATURE_CAPABILITIES, type JsonValue } from '@terminay/protocol';
import type { DockviewApi, IDockviewPanel } from 'dockview';
import { type MutableRefObject, useCallback, useEffect, useRef } from 'react';
import {
	arrangeViewPanels,
	describeDockview,
	findViewPanel,
	placeViewPanel,
	resizeViewPanel,
	type TabArrangement,
	type ViewNode,
	type ViewPosition,
	ViewRefusal,
	type ViewTabTarget,
} from './workspaceView.ts';

export type WorkspaceViewWorkspace = {
	readonly viewApi: () => DockviewApi | null;
	readonly isReady: () => boolean;
	readonly activatePanel: (panelId: string) => void;
	readonly activateTerminal: (panelId: string, sessionId: string) => void;
	readonly openFileTab: (path: string) => Promise<string | undefined>;
	readonly requestClosePanel: (panelId: string) => Promise<void>;
};

export type WorkspaceViewWindow<Workspace extends WorkspaceViewWorkspace> = {
	/** The projects this window holds. */
	readonly projectIds: () => readonly string[];
	/** The project in front, or undefined while Home is. */
	readonly shownProjectId: () => string | undefined;
	/** The project commands act on, even while Home is in front. */
	readonly targetProjectId: () => string | undefined;
	/** The folder this window shows for a project. */
	readonly selectedFolderId: (projectId: string) => string | undefined;
	/** A project's folders, in the server's order. */
	readonly folderIds: (projectId: string) => readonly string[];
	readonly workspace: (projectId: string, folderId: string) => Workspace | undefined;
	readonly showProject: (projectId: string) => void;
	readonly selectFolder: (projectId: string, folderId: string) => void;
	/**
	 * Present a workspace window (ADR-0072): Desktop opens it as a native
	 * window, through the path a tear-off takes; a browser, which holds every
	 * window's projects, switches to it.
	 */
	readonly presentView: (viewId: string) => Promise<void>;
};

type Located<Workspace> = {
	readonly projectId: string;
	readonly folderId: string;
	readonly workspace: Workspace;
	readonly api: DockviewApi;
	readonly panel: IDockviewPanel;
};

/** How long a request waits for this window to render what it asked for. */
const RENDER_WAIT_MS = 5_000;

export type WorkspaceViewConnection = Readonly<{
	serverId: string;
	applicationClient?: TerminayClient;
	capabilities?: readonly string[];
}>;

/** Serve view requests on every connection this window holds. */
export function useWorkspaceViewController<Workspace extends WorkspaceViewWorkspace>(
	connections: readonly WorkspaceViewConnection[],
	windowRef: MutableRefObject<WorkspaceViewWindow<Workspace>>,
): void {
	const handle = useCallback(
		(request: WorkspaceViewRequest) => applyViewRequest(windowRef.current, request),
		[windowRef],
	);
	const handleRef = useRef(handle);
	handleRef.current = handle;
	useEffect(() => {
		const stops = connections.flatMap((connection) => {
			if (
				connection.applicationClient === undefined ||
				connection.capabilities?.includes(FEATURE_CAPABILITIES.workspaceView) !== true
			)
				return [];
			try {
				return [
					serveWorkspaceView(
						new TerminayClientFacade(connection.applicationClient),
						(request) => handleRef.current(request),
					),
				];
			} catch {
				// A transport without subscriptions cannot be asked anything.
				return [];
			}
		});
		return () => {
			for (const stop of stops) stop();
		};
	}, [connections]);
}

export async function applyViewRequest<Workspace extends WorkspaceViewWorkspace>(
	window: WorkspaceViewWindow<Workspace>,
	request: WorkspaceViewRequest,
): Promise<JsonValue> {
	try {
		return await apply(window, request);
	} catch (error) {
		if (error instanceof ViewRefusal) throw new WorkspaceViewRefusal(error.code, error.message);
		throw error;
	}
}

async function apply<Workspace extends WorkspaceViewWorkspace>(
	window: WorkspaceViewWindow<Workspace>,
	request: WorkspaceViewRequest,
): Promise<JsonValue> {
	const params = request.params;
	const projectParam = typeof params.projectId === 'string' ? params.projectId : undefined;
	switch (request.op) {
		case 'layout': {
			const projectId = projectParam ?? window.targetProjectId();
			if (projectId === undefined)
				throw new ViewRefusal('unavailable', 'This window has no project open.');
			requireHeld(window, projectId);
			return { layout: layoutOf(window, projectId) };
		}
		case 'focus': {
			const located = await locate(window, projectParam, tabTarget(params.tab));
			await show(window, located);
			return { layout: layoutOf(window, located.projectId) };
		}
		case 'place': {
			const moving = await locate(window, projectParam, tabTarget(params.tab));
			const beside = await locate(window, moving.projectId, tabTarget(params.beside));
			// Placed beside a tab of another folder, the tab has just been moved
			// there on the server; wait until this window shows it there.
			const together =
				beside.folderId === moving.folderId
					? moving
					: await waitFor(() => {
							const panel = findViewPanel(beside.api, tabTarget(params.tab));
							return panel === undefined ? undefined : { ...beside, panel };
						}, 'The tab did not arrive in its new folder.');
			const before = beside.api.activePanel;
			placeViewPanel(together.panel, beside.panel, position(params.position));
			if (params.focus === true) await show(window, { ...beside, panel: together.panel });
			else if (before !== undefined && beside.api.getPanel(before.id) !== undefined)
				before.api.setActive();
			return { layout: layoutOf(window, beside.projectId, beside.folderId) };
		}
		case 'resize': {
			const located = await locate(window, projectParam, tabTarget(params.tab));
			resizeViewPanel(located.api, located.panel, {
				...(typeof params.width === 'number' ? { width: params.width } : {}),
				...(typeof params.height === 'number' ? { height: params.height } : {}),
			});
			return { layout: layoutOf(window, located.projectId, located.folderId) };
		}
		case 'arrange': {
			const targets = Array.isArray(params.tabs) ? params.tabs.map(tabTarget) : undefined;
			let projectId = projectParam;
			let folderId: string | undefined;
			let panels: IDockviewPanel[];
			let api: DockviewApi;
			if (targets !== undefined && targets.length > 0) {
				const located: Located<Workspace>[] = [];
				for (const target of targets) located.push(await locate(window, projectId, target));
				const first = located[0]!;
				if (located.some((entry) => entry.folderId !== first.folderId))
					throw new ViewRefusal('bad_request', 'Every tab arranged together must be in the same folder.');
				projectId = first.projectId;
				folderId = first.folderId;
				api = first.api;
				panels = located.map((entry) => entry.panel);
			} else {
				projectId ??= window.targetProjectId();
				if (projectId === undefined)
					throw new ViewRefusal('unavailable', 'This window has no project open.');
				requireHeld(window, projectId);
				folderId = window.selectedFolderId(projectId);
				const workspace = folderId === undefined ? undefined : window.workspace(projectId, folderId);
				const held = workspace?.viewApi() ?? null;
				if (held === null)
					throw new ViewRefusal('unavailable', 'That folder is not open in this window.');
				api = held;
				panels = panelsInOrder(api);
			}
			const before = api.activePanel;
			arrangeViewPanels(api, panels, params.arrangement as TabArrangement);
			if (before !== undefined && api.getPanel(before.id) !== undefined) before.api.setActive();
			return { layout: layoutOf(window, projectId, folderId) };
		}
		case 'showProject': {
			const projectId = requireProject(projectParam);
			// A project the server has just created or moved here may not have
			// reached this window yet.
			await waitFor(
				() => (window.projectIds().includes(projectId) ? true : undefined),
				'That project is not open in this window. It may be the automation space, or open in another window.',
			);
			window.showProject(projectId);
			await waitFor(
				() => (window.shownProjectId() === projectId ? true : undefined),
				'The project did not come to the front.',
			);
			return { layout: layoutOf(window, projectId) };
		}
		case 'selectFolder': {
			const projectId = requireProject(projectParam);
			const folderId = typeof params.folderId === 'string' ? params.folderId : undefined;
			if (folderId === undefined) throw new ViewRefusal('bad_request', 'A folder is required.');
			requireHeld(window, projectId);
			window.showProject(projectId);
			window.selectFolder(projectId, folderId);
			await waitFor(
				() => (window.workspace(projectId, folderId)?.isReady() === true ? true : undefined),
				'The folder did not open.',
			);
			return { layout: layoutOf(window, projectId, folderId) };
		}
		case 'openFile': {
			const projectId = projectParam ?? window.targetProjectId();
			if (projectId === undefined)
				throw new ViewRefusal('unavailable', 'This window has no project open.');
			requireHeld(window, projectId);
			const folderId = window.selectedFolderId(projectId);
			const workspace = folderId === undefined ? undefined : window.workspace(projectId, folderId);
			if (workspace === undefined)
				throw new ViewRefusal('unavailable', 'That project is not open in this window.');
			const path = typeof params.path === 'string' ? params.path : '';
			const tab = await workspace.openFileTab(path);
			if (tab === undefined)
				throw new ViewRefusal('bad_request', "That path is not inside the project's folder.");
			return { tab, layout: layoutOf(window, projectId, folderId) };
		}
		case 'presentView': {
			const viewId = typeof params.viewId === 'string' ? params.viewId : undefined;
			if (viewId === undefined) throw new ViewRefusal('bad_request', 'A window is required.');
			await window.presentView(viewId);
			return { presented: true };
		}
		case 'closeTab': {
			const located = await locate(window, projectParam, tabTarget(params.tab));
			await located.workspace.requestClosePanel(located.panel.id);
			return {
				closed: located.api.getPanel(located.panel.id) === undefined,
				layout: layoutOf(window, located.projectId, located.folderId),
			};
		}
	}
}

/**
 * Find a tab in this window: in one project when the request names it, else
 * in any project this window holds. A terminal just opened may not have
 * reached this window yet, so a tab is waited for.
 */
async function locate<Workspace extends WorkspaceViewWorkspace>(
	window: WorkspaceViewWindow<Workspace>,
	projectId: string | undefined,
	target: ViewTabTarget,
): Promise<Located<Workspace>> {
	if (projectId !== undefined) requireHeld(window, projectId);
	const find = (): Located<Workspace> | undefined => {
		for (const candidate of projectId === undefined ? window.projectIds() : [projectId])
			for (const folderId of window.folderIds(candidate)) {
				const workspace = window.workspace(candidate, folderId);
				const api = workspace?.viewApi() ?? null;
				if (workspace === undefined || api === null) continue;
				const panel = findViewPanel(api, target);
				if (panel !== undefined) return { projectId: candidate, folderId, workspace, api, panel };
			}
		return undefined;
	};
	return find() ?? (await waitFor(find, 'No such tab is open in this window.', 'not_found'));
}

/** Bring a located tab to the front: its project, its folder, its pane. */
async function show<Workspace extends WorkspaceViewWorkspace>(
	window: WorkspaceViewWindow<Workspace>,
	located: Located<Workspace>,
): Promise<void> {
	window.showProject(located.projectId);
	window.selectFolder(located.projectId, located.folderId);
	const sessionId = (located.panel.params as { sessionId?: unknown } | undefined)?.sessionId;
	if (typeof sessionId === 'string') located.workspace.activateTerminal(located.panel.id, sessionId);
	else located.workspace.activatePanel(located.panel.id);
	await waitFor(
		() =>
			window.shownProjectId() === located.projectId &&
			window.selectedFolderId(located.projectId) === located.folderId &&
			located.api.activePanel?.id === located.panel.id
				? true
				: undefined,
		'The tab did not come to the front.',
	);
}

function layoutOf<Workspace extends WorkspaceViewWorkspace>(
	window: WorkspaceViewWindow<Workspace>,
	projectId: string,
	folderId: string | undefined = window.selectedFolderId(projectId),
): JsonValue {
	const api = folderId === undefined ? null : (window.workspace(projectId, folderId)?.viewApi() ?? null);
	const described = api === null ? {} : describeDockview(api);
	const shownProjectId = window.shownProjectId();
	return {
		projectId,
		...(folderId === undefined ? {} : { folderId }),
		...(shownProjectId === undefined ? {} : { shownProjectId }),
		...(described.root === undefined ? {} : { root: described.root as unknown as JsonValue }),
		...(described.focusedTab === undefined ? {} : { focusedTab: described.focusedTab }),
	};
}

/** A Dockview's tabs in the order the layout reads: pane by pane, tab by tab. */
function panelsInOrder(api: DockviewApi): IDockviewPanel[] {
	const ids: string[] = [];
	const visit = (node: ViewNode | undefined): void => {
		if (node === undefined) return;
		if ('split' in node) for (const child of node.children) visit(child);
		else for (const tab of node.tabs) ids.push(tab.tab);
	};
	visit(describeDockview(api).root);
	return ids.flatMap((id) => {
		const panel = api.getPanel(id);
		return panel === undefined ? [] : [panel];
	});
}

function requireHeld<Workspace extends WorkspaceViewWorkspace>(
	window: WorkspaceViewWindow<Workspace>,
	projectId: string,
): void {
	if (!window.projectIds().includes(projectId))
		throw new ViewRefusal(
			'unavailable',
			'That project is not open in this window. It may be the automation space, or open in another window.',
		);
}

function requireProject(projectId: string | undefined): string {
	if (projectId === undefined) throw new ViewRefusal('bad_request', 'A project is required.');
	return projectId;
}

function tabTarget(value: JsonValue | undefined): ViewTabTarget {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new ViewRefusal('bad_request', 'A tab is required.');
	const record = value as Record<string, JsonValue>;
	const target = {
		...(typeof record.tab === 'string' ? { tab: record.tab } : {}),
		...(typeof record.sessionId === 'string' ? { sessionId: record.sessionId } : {}),
	};
	if (target.tab === undefined && target.sessionId === undefined)
		throw new ViewRefusal('bad_request', 'A tab is required.');
	return target;
}

function position(value: JsonValue | undefined): ViewPosition {
	return value === 'left' || value === 'above' || value === 'below' || value === 'center'
		? value
		: 'right';
}

/** Wait, briefly and boundedly, for this window to render what a request asked of it. */
function waitFor<T>(
	check: () => T | undefined,
	message: string,
	code: 'not_found' | 'unavailable' = 'unavailable',
): Promise<T> {
	return new Promise((resolve, reject) => {
		const deadline = Date.now() + RENDER_WAIT_MS;
		const attempt = () => {
			let value: T | undefined;
			try {
				value = check();
			} catch (error) {
				reject(error);
				return;
			}
			if (value !== undefined) {
				resolve(value);
				return;
			}
			if (Date.now() >= deadline) {
				reject(new ViewRefusal(code, message));
				return;
			}
			// A timer, not a frame: a window in the background renders no frames
			// but still applies what it is asked.
			setTimeout(attempt, 16);
		};
		attempt();
	});
}
