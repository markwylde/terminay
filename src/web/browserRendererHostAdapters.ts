import {
	MacroClient,
	TerminayClientFacade,
	type TerminayClient,
} from '@terminay/client-core';
import type { JsonValue } from '@terminay/protocol';
import type { TerminalSettingsClient } from '../hooks/useTerminalSettings';
import type { LegacyMacroSettingsCapability } from '../services/macros/legacyMacroSettingsCapability';
import { defaultTerminalSettings, normalizeTerminalSettings } from '../terminalSettings';
import type { MacroDefinition } from '../types/macros';

const BROWSER_TERMINAL_SETTINGS_KEY = 'terminay.browser.terminal-settings.v1';

function readBrowserTerminalSettings(): JsonValue {
	try {
		const stored = window.localStorage.getItem(BROWSER_TERMINAL_SETTINGS_KEY);
		return normalizeTerminalSettings(
			stored === null ? defaultTerminalSettings : JSON.parse(stored),
		) as unknown as JsonValue;
	} catch {
		return defaultTerminalSettings as unknown as JsonValue;
	}
}

/** Browser-owned device settings. This is intentionally a Web Storage adapter,
 * not an Electron preload-shaped compatibility object. */
export function createBrowserTerminalSettingsClient(): TerminalSettingsClient {
	const listeners = new Set<(settings: JsonValue) => void>();
	const publish = (settings: JsonValue) => {
		for (const listener of listeners) listener(settings);
	};
	const save = (candidate: JsonValue): JsonValue => {
		const settings = normalizeTerminalSettings(candidate) as unknown as JsonValue;
		window.localStorage.setItem(
			BROWSER_TERMINAL_SETTINGS_KEY,
			JSON.stringify(settings),
		);
		publish(settings);
		return settings;
	};
	return Object.freeze({
		get: async <T = JsonValue>() => readBrowserTerminalSettings() as T,
		update: async <T = JsonValue>(settings: JsonValue) => save(settings) as T,
		reset: async <T = JsonValue>() => {
			window.localStorage.removeItem(BROWSER_TERMINAL_SETTINGS_KEY);
			const settings = readBrowserTerminalSettings();
			publish(settings);
			return settings as T;
		},
		onChanged(listener: (settings: JsonValue) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	});
}

/** Macro definitions remain server-owned in a connected browser. Native secret
 * storage is capability-gated: the browser exposes no secret mutation surface. */
export function createBrowserMacroSettingsCapability(
	client: TerminayClient,
): LegacyMacroSettingsCapability {
	const macros = new MacroClient(new TerminayClientFacade(client));
	return Object.freeze({
		async getMacros() {
			return [...(await macros.get()).macros] as MacroDefinition[];
		},
		async updateMacros(nextMacros) {
			return [...(await macros.replace(nextMacros)).macros] as MacroDefinition[];
		},
		async resetMacros() {
			return [...(await macros.reset()).macros] as MacroDefinition[];
		},
		onMacrosChanged(listener) {
			return macros.onChanged((state) =>
				listener({ macros: [...state.macros] as MacroDefinition[] }),
			);
		},
		async getSecrets() {
			return [];
		},
		async getDecryptedSecret() {
			throw new Error('Browser secret storage is unavailable');
		},
		async saveSecret() {
			throw new Error('Browser secret storage is unavailable');
		},
		async deleteSecret() {
			throw new Error('Browser secret storage is unavailable');
		},
	});
}
