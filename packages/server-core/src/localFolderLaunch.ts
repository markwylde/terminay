import { randomUUID } from 'node:crypto';
import type { WorkspaceCommand, WorkspaceState } from './workspace.js';

/** Native Desktop's local-only adapter. This is deliberately not a protocol
 * operation: renderer/device claims cannot manufacture native launch intent. */
export async function openLocalFolder(options: {
	readonly folder: string;
	readonly canonicalDirectory: (folder: string) => Promise<string>;
	readonly state: () => WorkspaceState;
	readonly apply: (command: WorkspaceCommand) => void;
	readonly defaultViewId: string;
	/** Native host waits for the selected local workspace to subscribe before mutation. */
	readonly beforeCreate?: (viewId: string) => Promise<void>;
	readonly createTerminal: (
		projectId: string,
		cwd: string,
	) => Promise<{ id: string }>;
}): Promise<{ projectId: string; viewId: string; sessionId: string }> {
	const root = await options.canonicalDirectory(options.folder);
	let project = Object.values(options.state().projects).find(
		(p) => p.root === root && p.rootOrigin !== 'none' && p.kind === undefined,
	);
	await options.beforeCreate?.(project?.viewId ?? options.defaultViewId);
	if (!project) {
		const projectId = randomUUID();
		options.apply({
			type: 'project.create',
			projectId,
			viewId: options.defaultViewId,
			root,
			rootOrigin: 'explicit',
		});
		project = options.state().projects[projectId];
		if (!project) throw new Error('The local project could not be created.');
	}
	const session = await options.createTerminal(project.id, root);
	return {
		projectId: project.id,
		viewId: project.viewId,
		sessionId: session.id,
	};
}
