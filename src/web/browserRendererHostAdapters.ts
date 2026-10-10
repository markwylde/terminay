import {
	MacroClient,
	TerminayClientFacade,
	type TerminayClient,
} from '@terminay/client-core';
import {
	createServerMacroSettingsClient,
	type MacroSettingsClient,
} from '../hooks/useMacroSettings';

/** Macro definitions and categories remain server-owned in a connected
 * browser, reached through the same client contract every host uses. */
export function createBrowserMacroSettingsClient(
	client: TerminayClient,
): MacroSettingsClient {
	return Object.freeze(
		createServerMacroSettingsClient(
			new MacroClient(new TerminayClientFacade(client)),
		),
	);
}
