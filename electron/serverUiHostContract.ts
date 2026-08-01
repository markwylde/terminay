export type ServerUiHostContext = {
	hostKind: 'desktop';
	capabilities: {
		connectionProfiles: boolean;
		serverExposure: boolean;
	};
	profile: {
		id: string;
		label: string;
	};
	profiles: readonly ServerUiConnectionProfile[];
};

export type ServerUiConnectionProfile = {
	id: string;
	serverId: string;
	label: string;
	origin: string;
	status: 'connected' | 'connecting' | 'offline' | 'revoked' | 'unreachable';
	isLocal?: boolean;
};

export type ServerUiHostAction =
	| { type: 'close-window' }
	| { type: 'manage-connections' }
	| { profileId: string; type: 'open-connection' }
	| { profileId: string; type: 'connection.select' }
	| { profile: ServerUiConnectionProfile; type: 'connection.remember' }
	| { profileId: string; label: string; type: 'connection.rename' }
	| { profileId: string; type: 'connection.forget' }
	| { profileId: string; type: 'connection.revoke' }
	| { profileId: string; type: 'connection.expose' }
	| { pairingUrl: string; type: 'connection.pair' };

export type ServerUiHostBridge = {
	getContext(): Promise<ServerUiHostContext>;
	requestAction(action: ServerUiHostAction): Promise<void>;
};
