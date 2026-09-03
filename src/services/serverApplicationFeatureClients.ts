import type { JsonValue } from '@terminay/protocol';
import { TerminayClientFacade } from '@terminay/client-core';
import type { TerminayClient } from '@terminay/client-core';
import type {
	McpAgentId,
	McpInstallActionResult,
	McpInstallStatus,
	RemoteAccessStatus,
} from '../types/terminay';
import type { RemoteAccessStatusClient } from './remoteAccessStatusClient';

const REMOTE_EVENT = 'remote-access.changed';

export function createServerRemoteAccessClients(client: TerminayClient): {
	status: RemoteAccessStatusClient;
} {
	const transport = new TerminayClientFacade(client);
	const status = {
		getStatus: () => transport.query('remote-access.status') as Promise<RemoteAccessStatus>,
		toggleServer: () => transport.command('remote-access.toggle-server') as Promise<RemoteAccessStatus>,
		createPairingLink: () => transport.command('remote-access.create-pairing-link') as Promise<RemoteAccessStatus>,
		revokeDevice: (deviceId: string) => transport.command('remote-access.revoke-device', { deviceId }) as Promise<RemoteAccessStatus>,
		closeConnection: (connectionId: string) => transport.command('remote-access.close-connection', { connectionId }) as Promise<RemoteAccessStatus>,
		approveDevice: (approvalId: string) => transport.command('remote-access.approve-device', { approvalId }) as Promise<RemoteAccessStatus>,
		denyDevice: (approvalId: string) => transport.command('remote-access.deny-device', { approvalId }) as Promise<RemoteAccessStatus>,
		resetIdentity: () => transport.command('remote-access.reset-identity') as Promise<RemoteAccessStatus>,
		subscribe(listener: (value: RemoteAccessStatus) => void) {
			let disposed = false;
			let stop: (() => void) | undefined;
			let unsubscribe: (() => Promise<void>) | undefined;
			void client.subscribe<JsonValue>(REMOTE_EVENT).then((subscription) => {
				if (disposed) return void subscription.unsubscribe();
				unsubscribe = subscription.unsubscribe;
				stop = subscription.onEvent(() => void status.getStatus().then(listener));
			});
			return () => { disposed = true; stop?.(); void unsubscribe?.(); };
		},
	} satisfies RemoteAccessStatusClient;
	return { status };
}

export type McpInstallClient = Readonly<{
	getStatus(): Promise<McpInstallStatus>;
	install(agent: McpAgentId): Promise<McpInstallActionResult>;
	uninstall(agent: McpAgentId): Promise<McpInstallActionResult>;
}>;

/** Server application-protocol facade for the provider-registration UI. */
export function createServerMcpInstallClient(
	client: TerminayClient,
): McpInstallClient {
	const transport = new TerminayClientFacade(client);
	return {
		getStatus: () =>
			transport.query('mcp-install.status') as unknown as Promise<McpInstallStatus>,
		install: (agent) =>
			transport.command('mcp-install.install', {
				agent,
			}) as unknown as Promise<McpInstallActionResult>,
		uninstall: (agent) =>
			transport.command('mcp-install.uninstall', {
				agent,
			}) as unknown as Promise<McpInstallActionResult>,
	};
}
