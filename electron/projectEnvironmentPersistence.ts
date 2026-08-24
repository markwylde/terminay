import type { ProjectEnvironmentState } from '../packages/server-core/src/projectEnvironment/types';
import type { ProjectEnvironmentStateBackend } from '../packages/server-core/src/projectEnvironment/repository';

/** Apply a one-time embedded compatibility migration before the repository
 * validates its exact server boundary, and commit it atomically through the
 * underlying file backend. */
export class MigratingProjectEnvironmentStateBackend
	implements ProjectEnvironmentStateBackend
{
	constructor(
		private readonly backend: ProjectEnvironmentStateBackend,
		private readonly migrate: (state: unknown) => unknown,
	) {}

	async load(): Promise<unknown | undefined> {
		const state = await this.backend.load();
		if (state === undefined) return undefined;
		const migrated = this.migrate(state);
		if (migrated !== state)
			await this.backend.commit(migrated as ProjectEnvironmentState);
		return migrated;
	}

	commit(state: ProjectEnvironmentState): Promise<void> {
		return this.backend.commit(state);
	}

	async backup(state: ProjectEnvironmentState): Promise<void> {
		if (this.backend.backup !== undefined) await this.backend.backup(state);
	}
}
