import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
	AutomationBackend,
	AutomationRunLogBackend,
	AutomationRunLogState,
	AutomationState,
} from './types.js';

export const AUTOMATION_DEFINITIONS_FILE = 'automations.v1.json';
export const AUTOMATION_RUNS_FILE = 'automation-runs.v1.json';

/** A JSON document committed atomically (temporary file + rename), owner-only. */
export function createJsonFileBackend<T>(path: string): {
	load(): Promise<unknown | undefined>;
	commit(state: T): Promise<void>;
	backup(state: T): Promise<void>;
} {
	return {
		load: async () => {
			try {
				return JSON.parse(await readFile(path, 'utf8')) as unknown;
			} catch (error) {
				if ((error as { code?: string }).code === 'ENOENT') return undefined;
				throw error;
			}
		},
		commit: (state) => writeAtomically(path, state),
		// Keep the source that failed normalisation before it is replaced.
		backup: async () => {
			let source: string;
			try {
				source = await readFile(path, 'utf8');
			} catch (error) {
				if ((error as { code?: string }).code === 'ENOENT') return;
				throw error;
			}
			await mkdir(dirname(path), { recursive: true, mode: 0o700 });
			await writeFile(`${path}.${Date.now()}.backup.json`, source, {
				encoding: 'utf8',
				mode: 0o600,
				flag: 'wx',
			}).catch((error: { code?: string }) => {
				if (error.code !== 'EEXIST') throw error;
			});
		},
	};
}

/** File backends for automation definitions and the run log in a server's
 * data root. */
export function createAutomationFileBackends(dataRoot: string): {
	readonly definitions: AutomationBackend;
	readonly runs: AutomationRunLogBackend;
} {
	return {
		definitions: createJsonFileBackend<AutomationState>(
			join(dataRoot, AUTOMATION_DEFINITIONS_FILE),
		),
		runs: createJsonFileBackend<AutomationRunLogState>(
			join(dataRoot, AUTOMATION_RUNS_FILE),
		),
	};
}

async function writeAtomically(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
	try {
		await writeFile(temporary, JSON.stringify(value), {
			encoding: 'utf8',
			mode: 0o600,
			flag: 'wx',
		});
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true }).catch(() => undefined);
	}
}
