import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
	loadRebuildableStateSync,
	writeFileDurablySync,
} from '../../packages/server-core/src/durableFile.ts';

const PREFERENCES_FILENAME = 'diagnostics-preferences.v1.json';
const SCHEMA_VERSION = 1 as const;

export interface DiagnosticsPreferences {
	readonly schemaVersion: typeof SCHEMA_VERSION;
	readonly performanceLogging: boolean;
}

export const DEFAULT_DIAGNOSTICS_PREFERENCES: DiagnosticsPreferences =
	Object.freeze({
		schemaVersion: SCHEMA_VERSION,
		performanceLogging: false,
	});

export function diagnosticsPreferencesPath(userDataDirectory: string): string {
	return path.join(userDataDirectory, PREFERENCES_FILENAME);
}

export function readDiagnosticsPreferences(
	userDataDirectory: string,
): DiagnosticsPreferences {
	// Rebuildable (ADR-0088): a corrupt file is set aside and reads as the
	// documented default Off.
	try {
		const performanceLogging = loadRebuildableStateSync(
			diagnosticsPreferencesPath(userDataDirectory),
			'diagnostics-preferences',
			{
				validate: (parsed) =>
					typeof parsed === 'object' &&
					parsed !== null &&
					!Array.isArray(parsed)
						? (parsed as { performanceLogging?: unknown })
								.performanceLogging === true
						: undefined,
			},
		);
		if (performanceLogging === true)
			return { schemaVersion: SCHEMA_VERSION, performanceLogging: true };
	} catch {
		// A file that cannot even be set aside keeps the default Off.
	}
	return DEFAULT_DIAGNOSTICS_PREFERENCES;
}

export function writeDiagnosticsPreferences(
	userDataDirectory: string,
	preferences: DiagnosticsPreferences,
): void {
	mkdirSync(userDataDirectory, { mode: 0o700, recursive: true });
	const body = `${JSON.stringify({
		schemaVersion: SCHEMA_VERSION,
		performanceLogging: preferences.performanceLogging === true,
	})}\n`;
	writeFileDurablySync(diagnosticsPreferencesPath(userDataDirectory), body, {
		mode: 0o600,
	});
}
