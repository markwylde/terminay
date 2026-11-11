import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadRebuildableState, writeFileDurably } from '../durableFile.js';
import type { ForgeExtensionSettings, ForgeSettingsStore } from './service.js';

/** Forge settings per extension, one small server-scoped JSON file. */
export function fileForgeSettings(path: string): ForgeSettingsStore {
	return Object.freeze({
		async load() {
			// Rebuildable (ADR-0088): a corrupt file is set aside and defaults apply.
			try {
				const value = await loadRebuildableState(path, 'forge-settings', {
					validate: (parsed) => {
						const extensions =
							typeof parsed === 'object' && parsed !== null
								? (parsed as { extensions?: unknown }).extensions
								: undefined;
						return typeof extensions === 'object' &&
							extensions !== null &&
							!Array.isArray(extensions)
							? (extensions as Record<string, ForgeExtensionSettings>)
							: undefined;
					},
				});
				return value ?? {};
			} catch {
				return {};
			}
		},
		async save(settings: Readonly<Record<string, ForgeExtensionSettings>>) {
			await mkdir(dirname(path), { recursive: true });
			await writeFileDurably(
				path,
				`${JSON.stringify({ version: 1, extensions: settings }, null, 2)}\n`,
				{ mode: 0o600 },
			);
		},
	});
}

/** Settings kept in memory, for tests and hosts without a data root. */
export function memoryForgeSettings(
	initial: Record<string, ForgeExtensionSettings> = {},
): ForgeSettingsStore & { readonly saved: Record<string, ForgeExtensionSettings> } {
	const saved = { ...initial };
	return {
		saved,
		async load() {
			return { ...saved };
		},
		async save(settings) {
			for (const key of Object.keys(saved)) delete saved[key];
			Object.assign(saved, settings);
		},
	};
}
