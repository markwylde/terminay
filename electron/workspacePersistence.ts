import path from 'node:path';
import type { WorkspaceState } from '../packages/server-core/src/workspace';
import {
	FileWorkspaceStateBackend,
	WorkspacePersistenceError,
	type WorkspaceStateBackend,
} from '../packages/server-core/src/workspaceRepository';

export { WorkspacePersistenceError };

export type EmbeddedWorkspacePersistenceFault =
	| 'unreadable'
	| 'invalid'
	| 'uncommittable';

export function embeddedBuiltInExtensionArtifactRoot(
	options: Readonly<{
		appRoot: string;
		isPackaged: boolean;
		resourcesPath: string;
	}>,
): string {
	return options.isPackaged
		? path.join(options.resourcesPath, 'built-in-extensions')
		: path.join(options.appRoot, 'build', 'built-in-extensions');
}

export function isEmbeddedWorkspacePersistenceError(
	error: unknown,
): error is WorkspacePersistenceError {
	return error instanceof WorkspacePersistenceError;
}

/** Resolve the deterministic E2E-only persistence fault. Merely setting the
 * fault variable in a production process has no effect. */
export function embeddedWorkspacePersistenceFault(
	environment: Readonly<Record<string, string | undefined>>,
): EmbeddedWorkspacePersistenceFault | undefined {
	if (environment.TERMINAY_TEST !== '1') return undefined;
	const value = environment.TERMINAY_TEST_WORKSPACE_PERSISTENCE_FAULT;
	return value === 'unreadable' ||
		value === 'invalid' ||
		value === 'uncommittable'
		? value
		: undefined;
}

/** Production returns the ordinary atomic file backend. Tests may inject one
 * closed failure phase without changing repository validation or recovery. */
export function createEmbeddedWorkspaceStateBackend(
	options: Readonly<{
		filePath: string;
		testFault?: EmbeddedWorkspacePersistenceFault;
	}>,
): WorkspaceStateBackend {
	const backend = new FileWorkspaceStateBackend(options.filePath);
	if (options.testFault === undefined) return backend;
	return new FaultingWorkspaceStateBackend(backend, options.testFault);
}

class FaultingWorkspaceStateBackend implements WorkspaceStateBackend {
	constructor(
		private readonly backend: WorkspaceStateBackend,
		private readonly fault: EmbeddedWorkspacePersistenceFault,
	) {}

	async load(): Promise<unknown | undefined> {
		if (this.fault === 'unreadable') throw new Error('injected read failure');
		if (this.fault === 'invalid') return { schemaVersion: 'invalid' };
		return this.backend.load();
	}

	async commit(state: WorkspaceState): Promise<void> {
		if (this.fault === 'uncommittable')
			throw new Error('injected commit failure');
		await this.backend.commit(state);
	}

	commitSync(state: WorkspaceState): void {
		if (this.fault === 'uncommittable')
			throw new Error('injected commit failure');
		if (this.backend.commitSync === undefined)
			throw new Error('embedded workspace backend lacks an atomic commit');
		this.backend.commitSync(state);
	}
}
