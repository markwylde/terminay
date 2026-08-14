/** Exact Desktop status authority injected into remote-access consumers. */
export type RemoteAccessStatusClient = Pick<
	Window['terminayRemoteAccessStatusHost'],
	| 'closeConnection'
	| 'getStatus'
	| 'revokeDevice'
	| 'setPairingAddress'
	| 'subscribe'
	| 'toggleServer'
	| 'toggleDirectListener'
>;
