export type ServerUiHostContext = {
	hostKind: 'desktop';
	profile: {
		id: string;
		label: string;
	};
};

export type ServerUiHostAction =
	| { type: 'close-window' }
	| { type: 'manage-connections' }
	| { profileId: string; type: 'open-connection' };

export type ServerUiHostBridge = {
	getContext(): Promise<ServerUiHostContext>;
	requestAction(action: ServerUiHostAction): Promise<void>;
};
