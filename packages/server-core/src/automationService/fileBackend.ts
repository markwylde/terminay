import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
	loadCanonicalState,
	type StateStoreName,
	writeFileDurably,
} from '../durableFile.js';
import type {
	AutomationBackend,
	AutomationRunLogBackend,
	AutomationRunLogState,
	AutomationState,
} from './types.js';

export const AUTOMATION_DEFINITIONS_FILE = 'automations.v1.json';
export const AUTOMATION_RUNS_FILE = 'automation-runs.v1.json';

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored JSON object whose `field`, when present, has the right shape.
 * Entries inside it are normalised (and bad ones dropped) by the owner. */
export function jsonObjectWith(
	field: string,
	shape: 'array' | 'object',
): (value: unknown) => unknown | undefined {
	return (value) => {
		if (!isPlainObject(value)) return undefined;
		const inner = value[field];
		if (inner === undefined) return value;
		const ok = shape === 'array' ? Array.isArray(inner) : isPlainObject(inner);
		return ok ? value : undefined;
	};
}

export interface JsonFileBackendOptions {
	/** The canonical store this file belongs to (ADR-0088). */
	readonly store?: StateStoreName;
	/** Returns undefined (or throws) when the parsed file is not this store. */
	readonly validate?: (value: unknown) => unknown | undefined;
}

/** A canonical JSON document, owner-only, replaced durably with a `.previous`
 * copy. A corrupt file loads that copy, or throws StateUnreadableError naming
 * the store when there is none (ADR-0088). */
export function createJsonFileBackend<T>(
	path: string,
	options: JsonFileBackendOptions = {},
): {
	load(): Promise<unknown | undefined>;
	commit(state: T): Promise<void>;
	backup(state: T): Promise<void>;
} {
	// Desktop's MCP connected-servers file was the first caller.
	const store = options.store ?? 'connected-servers';
	const validate =
		options.validate ??
		(store === 'connected-servers'
			? jsonObjectWith('servers', 'array')
			: jsonObjectWith('automations', 'array'));
	return {
		load: () => loadCanonicalState(path, store, { validate, mode: 0o600 }),
		commit: (state) => writeDurably(path, state),
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
			{
				store: 'automations',
				validate: jsonObjectWith('automations', 'array'),
			},
		),
		runs: createJsonFileBackend<AutomationRunLogState>(
			join(dataRoot, AUTOMATION_RUNS_FILE),
			{ store: 'automations', validate: jsonObjectWith('runs', 'object') },
		),
	};
}

async function writeDurably(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await writeFileDurably(path, JSON.stringify(value), {
		mode: 0o600,
		keepPrevious: true,
	});
}
