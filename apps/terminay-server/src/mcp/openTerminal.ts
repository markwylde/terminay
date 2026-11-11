import type {
	ServerCoreComposition,
	WorkspaceStore,
} from '@terminay/server-core';
import type { McpHostTerminal, McpOpenTerminal } from './host.js';

/**
 * How a server without host-side terminal bookkeeping opens a terminal for
 * MCP (`open_terminal`, `split_terminal`, `create_project`): the canonical
 * launch resolver decides the shell, cwd and profile, the terminal service
 * spawns it, and the workspace gets its panel. This is the path a client's
 * `terminal.create` takes, so an agent's terminal is like any other.
 */
export function createCompositionTerminalOpener(options: {
	readonly composition: () => ServerCoreComposition;
	readonly workspace: WorkspaceStore;
	readonly cols?: number;
	readonly rows?: number;
}): McpOpenTerminal {
	return async (
		projectId,
		cwd,
		_projectRootOrigin,
		activePanelId,
		folderId,
		profileId,
	) => {
		const composition = options.composition();
		const resolver = composition.terminalLaunchResolver;
		if (resolver === undefined)
			throw new Error('canonical terminal launch resolution is unavailable');
		const workspace = options.workspace;
		if (workspace.state.projects[projectId] === undefined)
			throw new Error('workspace project is unavailable');
		const terminal = composition.terminal;
		let identity = terminal.allocateIdentity(projectId);
		while (workspace.state.terminalSessions[identity.sessionId] !== undefined)
			identity = terminal.allocateIdentity(projectId);
		const launch = await resolver.resolve({
			identity,
			...(profileId === undefined ? {} : { explicitProfileId: profileId }),
			...(cwd === undefined ? {} : { explicitCwd: cwd }),
			...(activePanelId === undefined ? {} : { activePanelId }),
			...(folderId === undefined ? {} : { folderId }),
			cols: options.cols ?? 80,
			rows: options.rows ?? 24,
		});
		const handle = await terminal.createResolvedSession(launch);
		const snapshot = handle.snapshot();
		if (workspace.state.terminalSessions[handle.sessionId] === undefined) {
			// A folder deleted while the terminal was spawning falls back to
			// General instead of failing the creation.
			const folder =
				folderId !== undefined &&
				workspace.state.folders[folderId]?.projectId === handle.projectId
					? folderId
					: undefined;
			const count = Object.values(workspace.state.panels).filter(
				(panel) =>
					panel.projectId === handle.projectId && panel.type === 'terminal',
			).length;
			try {
				const registered = composition.workspaceOperations?.applyHostCommand(
					`mcp-host:terminal:${handle.sessionId}`.slice(0, 128),
					{
						type: 'terminal.createPanel',
						sessionId: handle.sessionId,
						projectId: handle.projectId,
						...(folder === undefined ? {} : { folderId: folder }),
						panelId: `p:${handle.sessionId}`.slice(0, 128),
						title: `Terminal ${count + 1}`,
						cwd: snapshot.cwd,
						createdAt: snapshot.createdAt,
						...(snapshot.launch === undefined
							? {}
							: { launch: snapshot.launch }),
					},
					workspace.state.revision,
				);
				if (registered === undefined)
					throw new Error('workspace operation registry is unavailable');
				if (!registered.ok) throw new Error(registered.conflict.message);
			} catch (error) {
				await terminal.kill(snapshot).catch(() => undefined);
				throw error;
			}
		}
		const opened: McpHostTerminal = {
			id: handle.sessionId,
			serverId: snapshot.serverId,
			projectId: snapshot.projectId,
			cwd: snapshot.cwd,
			pid: snapshot.pid,
			status: snapshot.status,
		};
		return opened;
	};
}
