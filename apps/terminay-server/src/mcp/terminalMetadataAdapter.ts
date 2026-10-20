import {
	isAutomationSpace,
	type WorkspaceCommand,
	type WorkspaceState,
} from '@terminay/server-core';
import {
	ControlEndpointError,
	type ControlRequestContext,
} from './controlEndpoint.js';
import type { TerminalControlAdapter } from './dispatcher.js';
import { type ProjectHandleCodec, reachOf } from './workspaceReach.js';

/**
 * `update_terminal` and `move_terminal_to_project` (ADR-0072) over the
 * server's own workspace commands: the tab editor's `panel.update`, and the
 * server-committed `panel.move` a user's drag between projects makes, which
 * re-homes the terminal with its PTY and scrollback. Every terminal and
 * project is resolved against the caller's reach first.
 */

export interface TerminalMetadataAdapterOptions {
	readonly state: () => WorkspaceState | Promise<WorkspaceState>;
	/** Apply a workspace command for the caller; throws when it is refused. */
	readonly apply: (
		command: WorkspaceCommand,
		context: ControlRequestContext,
	) => void | Promise<void>;
	/** A terminal the caller can address; throws `terminal_not_found`. */
	readonly resolveTerminal: (
		context: ControlRequestContext,
		reference: string,
	) => { readonly sessionId: string; readonly projectId: string };
	readonly projectHandles: ProjectHandleCodec;
}

export function createTerminalMetadataAdapter(
	options: TerminalMetadataAdapterOptions,
): Required<
	Pick<TerminalControlAdapter, 'updateTerminal' | 'moveTerminalToProject'>
> {
	const panelOf = (state: WorkspaceState, sessionId: string) => {
		const panel = Object.values(state.panels).find(
			(candidate) =>
				candidate.type === 'terminal' && candidate.sessionId === sessionId,
		);
		if (panel === undefined)
			throw new ControlEndpointError(
				'terminal_not_found',
				'The requested terminal is unavailable.',
			);
		return panel;
	};
	const apply = async (
		command: WorkspaceCommand,
		context: ControlRequestContext,
	) => {
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
	};

	return {
		updateTerminal: async (params, context) => {
			const target = options.resolveTerminal(context, params.terminal);
			const state = await options.state();
			const panel = panelOf(state, target.sessionId);
			const project = state.projects[panel.projectId];
			// As the tab editor saves: an empty colour follows the project's.
			const patch: Record<string, string | boolean | null> = {
				...(params.icon === undefined ? {} : { emoji: params.icon.trim() }),
				...(params.color === undefined
					? {}
					: params.color === ''
						? { color: project?.color ?? '', inheritsProjectColor: true }
						: { color: params.color, inheritsProjectColor: false }),
				...(params.note === undefined ? {} : { note: params.note }),
				...(params.activityTracking === undefined
					? {}
					: { activityIndicatorsEnabled: params.activityTracking }),
			};
			await apply(
				{ type: 'panel.update', panelId: panel.id, patch },
				context,
			);
			const after = (await options.state()).panels[panel.id];
			return {
				terminal: target.sessionId,
				updated: true,
				...(after?.emoji === undefined ? {} : { icon: after.emoji }),
				...(after?.color === undefined ? {} : { color: after.color }),
				...(after?.type === 'terminal' && after.note !== undefined
					? { note: after.note }
					: {}),
				activity_tracking: after?.activityIndicatorsEnabled !== false,
			};
		},
		moveTerminalToProject: async (params, context) => {
			if (reachOf(context) !== 'workspace')
				// The dispatcher refuses this first; this never widens it.
				throw new ControlEndpointError(
					'out_of_scope',
					'move_terminal_to_project needs workspace reach.',
				);
			const target = options.resolveTerminal(context, params.terminal);
			const state = await options.state();
			const panel = panelOf(state, target.sessionId);
			const projectId = options.projectHandles.resolve(params.project, state);
			const to = projectId === undefined ? undefined : state.projects[projectId];
			if (to === undefined)
				throw new ControlEndpointError(
					'not_found',
					'The requested project is unavailable.',
				);
			if (
				isAutomationSpace(to) ||
				isAutomationSpace(state.projects[panel.projectId])
			)
				throw new ControlEndpointError(
					'bad_request',
					'A terminal never moves into or out of the automation space.',
				);
			if (to.id === panel.projectId)
				throw new ControlEndpointError(
					'bad_request',
					'The terminal is already in that project. Use move_tab_to_folder or move_tab to move it within it.',
				);
			await apply(
				{
					type: 'panel.move',
					panelId: panel.id,
					targetProjectId: to.id,
					...(params.position === undefined ? {} : { index: params.position }),
				},
				context,
			);
			return {
				// The server keeps the session through the move; only its
				// project, and so the identity other callers address, changes.
				terminal: target.sessionId,
				project: params.project,
				moved: true,
			};
		},
	};
}
