/**
 * The Desktop renderer needs this temporary frame bridge only while its
 * MessagePort transport is supplied by preload. Keep the compatibility
 * hand-off narrow: importing the client transport must never acquire the
 * application-wide preload object.
 */
type LegacyServerFrameApi = LegacyServerFrameCapability;

export type LegacyServerFrameCapability = Readonly<{
	closeServerConnection: (connectionId: string) => void;
	sendServerFrame: (connectionId: string, frame: Uint8Array) => void;
	onServerFrame: (
		connectionId: string,
		listener: (frame: Uint8Array | null) => void,
	) => () => void;
}>;

/** Snapshot only the fixed-server frame operations, never the broad preload. */
export function captureLegacyServerFrameCapability(
	api: LegacyServerFrameApi,
): LegacyServerFrameCapability {
	const { closeServerConnection, sendServerFrame, onServerFrame } = api;
	for (const [name, value] of Object.entries({
		closeServerConnection,
		sendServerFrame,
		onServerFrame,
	})) {
		if (typeof value !== 'function') {
			throw new TypeError(
				`legacy server-frame capability ${name} is unavailable`,
			);
		}
	}

	return Object.freeze({
		closeServerConnection: (connectionId) =>
			closeServerConnection(connectionId),
		sendServerFrame: (connectionId, frame) =>
			sendServerFrame(connectionId, frame),
		onServerFrame: (connectionId, listener) =>
			onServerFrame(connectionId, listener),
	});
}
