import type { ExtensionHostManager } from '../extensions/manager.js';
import type { AgentChatProviderBridge } from './service.js';

/** The chat providers that running extensions registered, as the service sees them. */
export function agentChatProviderBridge(
	hosts: Pick<
		ExtensionHostManager,
		'chatProviderContributions' | 'chatAvailability' | 'openChatSession'
	>,
): AgentChatProviderBridge {
	return {
		providers: () =>
			hosts.chatProviderContributions().map(({ contribution }) => ({
				id: contribution.id,
				displayName: contribution.displayName,
			})),
		availability: (providerId, signal) =>
			hosts.chatAvailability(providerId, signal),
		openSession: (providerId, request, onEvent) =>
			hosts.openChatSession(providerId, request, onEvent),
	};
}
