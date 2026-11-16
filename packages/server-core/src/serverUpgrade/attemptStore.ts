import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadRebuildableState, writeFileDurably } from '../durableFile.js';
import type {
	PersistedServerUpgradeAttempt,
	ServerUpgradeAttemptStore,
} from './service.js';

/** The file in the data root that holds the server's last upgrade attempt. */
export const SERVER_UPGRADE_ATTEMPT_FILE = 'server-upgrade-attempt.v1.json';

/**
 * The server's last upgrade attempt, kept in its data root (ADR-0125).
 *
 * Replaced durably by rename, so a server stopped part-way through a save
 * finds the previous attempt or the new one, never half of either. Content
 * that is not JSON is set aside and reads as nothing; the service validates
 * the rest and ignores what is not an attempt. Nothing here reaches the
 * upgrader.
 */
export function createFileServerUpgradeAttemptStore(
	dataRoot: string,
): ServerUpgradeAttemptStore {
	const path = join(dataRoot, SERVER_UPGRADE_ATTEMPT_FILE);
	const save = (attempt: PersistedServerUpgradeAttempt) =>
		writeFileDurably(path, `${JSON.stringify(attempt, null, 2)}\n`, {
			mode: 0o600,
		});
	return {
		load: () => loadRebuildableState<unknown>(path, 'server upgrade attempt'),
		save,
		restore: (attempt) =>
			attempt === undefined ? rm(path, { force: true }) : save(attempt),
	};
}
