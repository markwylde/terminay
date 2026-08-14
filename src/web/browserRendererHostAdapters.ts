import {
	MacroClient,
	TerminayClientFacade,
	type TerminayClient,
} from '@terminay/client-core';
import {
	MacroSettingsUnavailableError,
	type MacroSettingsClient,
} from '../hooks/useMacroSettings';
import type { MacroDefinition } from '../types/macros';

/** Macro definitions remain server-owned in a connected browser. Native secret
 * storage is capability-gated: the browser exposes no secret mutation surface. */
export function createBrowserMacroSettingsClient(
	client: TerminayClient,
): MacroSettingsClient {
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
			throw new MacroSettingsUnavailableError(
				'Secret storage is unavailable on the selected server.',
			);
		},
		async saveSecret() {
			throw new MacroSettingsUnavailableError(
				'Secret storage is unavailable on the selected server.',
			);
		},
		async deleteSecret() {
			throw new MacroSettingsUnavailableError(
				'Secret storage is unavailable on the selected server.',
			);
		},
	});
}
