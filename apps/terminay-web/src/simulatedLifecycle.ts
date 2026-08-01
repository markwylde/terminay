import type {
	ConnectionProfile,
	ConnectionStatus,
} from '@terminay/client-core';

export type SimulatedBrowserSuspendEvent =
	| 'freeze'
	| 'pagehide'
	| 'visibility-hidden';

export interface SimulatedBrowserLifecycleHost {
	disconnect(profileId: string): ConnectionProfile;
	markStatus(profileId: string, status: ConnectionStatus): ConnectionProfile;
	retry(profileId: string): ConnectionProfile;
	revoke(profileId: string, confirmed: boolean): ConnectionProfile;
}

export interface SimulatedBrowserLifecycleEvent {
	readonly kind:
		| 'network-offline'
		| 'network-online'
		| 'reconnect-failed'
		| 'reconnected'
		| 'resume'
		| 'revoked'
		| SimulatedBrowserSuspendEvent;
}

/**
 * Deterministic local simulation of browser lifecycle signals. This exercises
 * connection-state policy only; it is not evidence from a physical mobile
 * browser, operating-system backgrounding, or a real interrupted network.
 */
export class SimulatedBrowserLifecycleHarness {
	readonly evidence: SimulatedBrowserLifecycleEvent[] = [];
	private networkOnline = true;
	private revoked = false;
	private suspended = false;

	constructor(
		private readonly host: SimulatedBrowserLifecycleHost,
		private readonly profileId: string,
		private readonly reconnect: () => Promise<boolean>,
	) {}

	suspend(kind: SimulatedBrowserSuspendEvent): void {
		this.suspended = true;
		this.evidence.push(Object.freeze({ kind }));
		this.host.disconnect(this.profileId);
	}

	setNetworkOnline(online: boolean): void {
		this.networkOnline = online;
		this.evidence.push(
			Object.freeze({ kind: online ? 'network-online' : 'network-offline' }),
		);
		if (!online) this.host.disconnect(this.profileId);
	}

	revoke(): void {
		this.revoked = true;
		this.evidence.push(Object.freeze({ kind: 'revoked' }));
		this.host.revoke(this.profileId, true);
	}

	async resume(): Promise<ConnectionProfile> {
		this.suspended = false;
		this.evidence.push(Object.freeze({ kind: 'resume' }));
		if (this.revoked) {
			return this.host.markStatus(this.profileId, 'revoked');
		}
		if (!this.networkOnline) {
			return this.host.markStatus(this.profileId, 'offline');
		}
		this.host.retry(this.profileId);
		const connected = await this.reconnect();
		this.evidence.push(
			Object.freeze({ kind: connected ? 'reconnected' : 'reconnect-failed' }),
		);
		return this.host.markStatus(
			this.profileId,
			connected ? 'connected' : 'unreachable',
		);
	}

	get isSuspended(): boolean {
		return this.suspended;
	}
}
