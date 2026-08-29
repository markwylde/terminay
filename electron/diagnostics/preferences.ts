import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(diagnosticsPreferencesPath(userDataDirectory), 'utf8'),
		);
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			!Array.isArray(parsed) &&
			(parsed as { performanceLogging?: unknown }).performanceLogging === true
		) {
			return { schemaVersion: SCHEMA_VERSION, performanceLogging: true };
		}
	} catch {
		// Missing or unreadable preferences keep the documented default Off.
	}
	return DEFAULT_DIAGNOSTICS_PREFERENCES;
}

export function writeDiagnosticsPreferences(
	userDataDirectory: string,
	preferences: DiagnosticsPreferences,
): void {
	mkdirSync(userDataDirectory, { mode: 0o700, recursive: true });
	const target = diagnosticsPreferencesPath(userDataDirectory);
	const temporary = `${target}.${process.pid}.tmp`;
	const body = `${JSON.stringify({
		schemaVersion: SCHEMA_VERSION,
		performanceLogging: preferences.performanceLogging === true,
	})}\n`;
	writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600 });
	renameSync(temporary, target);
}
