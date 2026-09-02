/** Exact Desktop status authority injected into remote-access consumers. */
export type RemoteAccessStatusClient = Pick<
	{
		closeConnection(connectionId: string): Promise<import('../types/terminay').RemoteAccessStatus>;
		getStatus(): Promise<import('../types/terminay').RemoteAccessStatus>;
		revokeDevice(deviceId: string): Promise<import('../types/terminay').RemoteAccessStatus>;
		subscribe(listener: (status: import('../types/terminay').RemoteAccessStatus) => void): () => void;
		toggleServer(): Promise<import('../types/terminay').RemoteAccessStatus>;
		createPairingLink(): Promise<import('../types/terminay').RemoteAccessStatus>;
		approveDevice(approvalId: string): Promise<import('../types/terminay').RemoteAccessStatus>;
		denyDevice(approvalId: string): Promise<import('../types/terminay').RemoteAccessStatus>;
		resetIdentity(): Promise<import('../types/terminay').RemoteAccessStatus>;
	},
	| 'approveDevice'
	| 'closeConnection'
	| 'createPairingLink'
	| 'denyDevice'
	| 'getStatus'
	| 'resetIdentity'
	| 'revokeDevice'
	| 'subscribe'
	| 'toggleServer'
>;
