import {
	FEATURE_CAPABILITIES,
	type JsonValue,
	PROJECT_START_REFUSALS,
	protocolError,
} from '@terminay/protocol';
import { capabilityOf } from './capabilities.js';
import type { CommandHandler, QueryHandler } from './types.js';
import type { WorkspaceState } from './workspace.js';

/** The features that act on a project's root folder: files, Explorer
 * watches, Documentation, Git, and language sessions. */
const ROOTED_CAPABILITIES: ReadonlySet<string> = new Set([
	FEATURE_CAPABILITIES.files,
	FEATURE_CAPABILITIES.git,
	FEATURE_CAPABILITIES.language,
]);

/** Whether an operation acts on its project's root folder. */
export function isRootedProjectOperation(operation: string): boolean {
	const capability = capabilityOf(operation);
	return capability !== undefined && ROOTED_CAPABILITIES.has(capability);
}

/**
 * Refuse, before any filesystem or Git work, a rooted operation on a project
 * with no root folder. The renderer shows such a project's panes empty and
 * asks nothing; the server refuses anyway, because the authority is here.
 */
export function refuseRootlessProjectOperations<
	T extends {
		readonly queries: ReadonlyMap<string, QueryHandler>;
		readonly commands: ReadonlyMap<string, CommandHandler>;
	},
>(registries: T, state: () => WorkspaceState): T {
	const guard = (payload: JsonValue): void => {
		if (
			typeof payload !== 'object' ||
			payload === null ||
			Array.isArray(payload)
		)
			return;
		const projectId = (payload as Record<string, JsonValue>).projectId;
		if (typeof projectId !== 'string') return;
		if (state().projects[projectId]?.rootOrigin !== 'none') return;
		throw protocolError('conflict', 'The project has no root folder.', {
			retryable: false,
			details: { reason: PROJECT_START_REFUSALS.noProjectRoot, projectId },
		});
	};
	const queries = new Map(
		[...registries.queries].map(
			([operation, handler]): [string, QueryHandler] =>
				isRootedProjectOperation(operation)
					? [
							operation,
							(request) => {
								guard(request.envelope.payload);
								return handler(request);
							},
						]
					: [operation, handler],
		),
	);
	const commands = new Map(
		[...registries.commands].map(
			([operation, handler]): [string, CommandHandler] =>
				isRootedProjectOperation(operation)
					? [
							operation,
							(request) => {
								guard(request.envelope.payload);
								return handler(request);
							},
						]
					: [operation, handler],
		),
	);
	return { ...registries, queries, commands };
}
