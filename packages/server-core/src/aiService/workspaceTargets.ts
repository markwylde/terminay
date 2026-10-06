import type { ProtocolId } from '@terminay/protocol';
import type {
	WorkspaceApplyResult,
	WorkspaceCommand,
	WorkspaceState,
} from '../workspace.js';
import {
	type AiMetadataTarget,
	AiServiceError,
	type AiTargetAuthority,
	type TerminalTarget,
	type TerminalTargetState,
} from './types.js';

export interface WorkspaceAiTargetAuthorityOptions {
	readonly serverId: ProtocolId;
	/** The canonical workspace state at the time of the call. */
	readonly state: () => WorkspaceState;
	/** Apply and publish a host-originated workspace command. Returns undefined
	 * when the workspace is not available. */
	readonly applyHostCommand: (
		commandId: string,
		command: WorkspaceCommand,
	) => WorkspaceApplyResult | undefined;
	readonly getSession: (
		sessionId: ProtocolId,
	) => { readonly projectId: ProtocolId; readonly status: string } | undefined;
}

let applySequence = 0;

/** The one AI target authority over canonical workspace state, shared by the
 * embedded and standalone servers. A generated title or note is committed as
 * an ordinary `panel.update`, so it is persisted and published exactly as a
 * manual edit is. */
export function createWorkspaceAiTargetAuthority(
	options: WorkspaceAiTargetAuthorityOptions,
): Required<
	Pick<AiTargetAuthority, 'getTarget' | 'authorize' | 'applyMetadata'>
> {
	const getTarget = (
		target: TerminalTarget,
	): TerminalTargetState | undefined => {
		if (target.serverId !== options.serverId) return undefined;
		const panel = options.state().panels[target.panelId];
		const session = options.getSession(target.sessionId);
		if (
			panel?.type !== 'terminal' ||
			panel.projectId !== target.projectId ||
			panel.sessionId !== target.sessionId ||
			session?.projectId !== target.projectId
		)
			return undefined;
		return {
			serverId: target.serverId,
			projectId: target.projectId,
			panelId: target.panelId,
			sessionId: target.sessionId,
			live: session.status === 'running',
			metadataRevision: panel.metadataRevision ?? 0,
			title: panel.title ?? 'Terminal',
			note: panel.note ?? '',
		};
	};
	return {
		getTarget,
		authorize: (_clientId, target) => getTarget(target)?.live === true,
		// Synchronous from the revision check to the commit, so no manual edit
		// can land between them.
		applyMetadata: (
			target: TerminalTarget,
			targetType: AiMetadataTarget,
			value: string,
			expectedRevision: number,
		) => {
			const current = getTarget(target);
			if (current === undefined)
				throw new AiServiceError(
					'target_unavailable',
					'terminal target is unavailable.',
					true,
				);
			if (current.metadataRevision !== expectedRevision)
				throw new AiServiceError(
					'revision_conflict',
					'terminal metadata changed while AI was running.',
					true,
				);
			applySequence += 1;
			const applied = options.applyHostCommand(
				`ai-metadata:${Date.now().toString(36)}:${applySequence}`,
				{
					type: 'panel.update',
					panelId: target.panelId,
					patch: targetType === 'title' ? { title: value } : { note: value },
				},
			);
			if (applied === undefined)
				throw new AiServiceError(
					'target_unavailable',
					'terminal metadata mutation is unavailable.',
					true,
				);
			if (!applied.ok)
				throw new AiServiceError(
					'target_unavailable',
					'terminal metadata could not be applied.',
					true,
				);
			const panel = applied.state.panels[target.panelId];
			return {
				revision:
					panel?.type === 'terminal'
						? (panel.metadataRevision ?? 0)
						: expectedRevision,
			};
		},
	};
}
